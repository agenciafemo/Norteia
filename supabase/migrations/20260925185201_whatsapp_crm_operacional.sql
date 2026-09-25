-- ============================================================================
-- CRM OPERACIONAL SOBRE O WHATSAPP
--
-- Evolui a caixa de mensagens existente sem duplicar contatos ou histórico.
-- Cada whatsapp_contact passa a ser também a conversa/oportunidade operacional
-- da agência: responsável, prioridade, etapa, etiquetas e próximo retorno.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.whatsapp_contacts') IS NULL
     OR to_regclass('public.whatsapp_messages') IS NULL
     OR to_regclass('public.organization_members') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_edit_org_content(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'WhatsApp CRM dependencies are missing';
  END IF;
END;
$$;

ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS crm_stage TEXT NOT NULL DEFAULT 'novo_contato',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_contacts'::regclass
      AND conname = 'whatsapp_contacts_conversation_status_valid'
  ) THEN
    ALTER TABLE public.whatsapp_contacts
      ADD CONSTRAINT whatsapp_contacts_conversation_status_valid
      CHECK (conversation_status IN ('novo', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'arquivado'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_contacts'::regclass
      AND conname = 'whatsapp_contacts_crm_stage_valid'
  ) THEN
    ALTER TABLE public.whatsapp_contacts
      ADD CONSTRAINT whatsapp_contacts_crm_stage_valid
      CHECK (crm_stage IN ('novo_contato', 'qualificacao', 'reuniao', 'proposta', 'cliente', 'perdido'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_contacts'::regclass
      AND conname = 'whatsapp_contacts_priority_valid'
  ) THEN
    ALTER TABLE public.whatsapp_contacts
      ADD CONSTRAINT whatsapp_contacts_priority_valid
      CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_contacts'::regclass
      AND conname = 'whatsapp_contacts_unread_count_valid'
  ) THEN
    ALTER TABLE public.whatsapp_contacts
      ADD CONSTRAINT whatsapp_contacts_unread_count_valid CHECK (unread_count >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS whatsapp_contacts_crm_queue_idx
  ON public.whatsapp_contacts (organization_id, conversation_status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_contacts_crm_stage_idx
  ON public.whatsapp_contacts (organization_id, crm_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_contacts_assigned_idx
  ON public.whatsapp_contacts (organization_id, assigned_to, last_message_at DESC)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_contacts_follow_up_idx
  ON public.whatsapp_contacts (organization_id, next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL AND conversation_status NOT IN ('resolvido', 'arquivado');

CREATE OR REPLACE FUNCTION public.validate_whatsapp_contact_crm()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = NEW.organization_id
      AND member.user_id = NEW.assigned_to
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'O responsável deve ser membro ativo da mesma agência';
  END IF;

  NEW.tags := ARRAY(
    SELECT DISTINCT left(btrim(tag), 40)
    FROM unnest(COALESCE(NEW.tags, ARRAY[]::TEXT[])) AS tag
    WHERE btrim(tag) <> ''
    ORDER BY 1
    LIMIT 20
  );

  IF NEW.conversation_status IN ('resolvido', 'arquivado') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS validate_whatsapp_contact_crm ON public.whatsapp_contacts;
CREATE TRIGGER validate_whatsapp_contact_crm
BEFORE INSERT OR UPDATE OF assigned_to, tags, conversation_status
ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_contact_crm();

-- A atualização é consequência da mensagem gravada pelo webhook. Mantê-la em
-- trigger também cobre mensagens enviadas quando a saída pela API for ligada.
CREATE OR REPLACE FUNCTION public.sync_whatsapp_conversation_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.whatsapp_contacts AS contact
  SET
    last_message_at = GREATEST(COALESCE(contact.last_message_at, NEW.sent_at), NEW.sent_at),
    last_inbound_at = CASE
      WHEN NEW.direction = 'recebida'
        THEN GREATEST(COALESCE(contact.last_inbound_at, NEW.sent_at), NEW.sent_at)
      ELSE contact.last_inbound_at
    END,
    unread_count = CASE
      WHEN NEW.direction = 'recebida' THEN contact.unread_count + 1
      ELSE contact.unread_count
    END,
    conversation_status = CASE
      WHEN NEW.direction = 'recebida' AND contact.conversation_status IN ('resolvido', 'arquivado')
        THEN 'novo'
      ELSE contact.conversation_status
    END,
    closed_at = CASE
      WHEN NEW.direction = 'recebida' THEN NULL
      ELSE contact.closed_at
    END,
    updated_at = now()
  WHERE contact.id = NEW.contact_id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_whatsapp_conversation_from_message ON public.whatsapp_messages;
CREATE TRIGGER sync_whatsapp_conversation_from_message
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_whatsapp_conversation_from_message();

-- Histórico anterior ganha a data da última mensagem, sem fingir que mensagens
-- antigas ainda estão não lidas.
UPDATE public.whatsapp_contacts AS contact
SET
  last_message_at = history.last_message_at,
  last_inbound_at = history.last_inbound_at
FROM (
  SELECT
    message.contact_id,
    max(message.sent_at) AS last_message_at,
    max(message.sent_at) FILTER (WHERE message.direction = 'recebida') AS last_inbound_at
  FROM public.whatsapp_messages AS message
  GROUP BY message.contact_id
) AS history
WHERE contact.id = history.contact_id
  AND contact.last_message_at IS NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  body TEXT NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_contact_notes_contact_idx
  ON public.whatsapp_contact_notes (contact_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_whatsapp_contact_note()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Autor da nota inválido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_contacts AS contact
    WHERE contact.id = NEW.contact_id
      AND contact.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'O contato deve pertencer à mesma agência';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS validate_whatsapp_contact_note ON public.whatsapp_contact_notes;
CREATE TRIGGER validate_whatsapp_contact_note
BEFORE INSERT OR UPDATE ON public.whatsapp_contact_notes
FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_contact_note();

ALTER TABLE public.whatsapp_contact_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_contact_notes_member_select ON public.whatsapp_contact_notes
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY whatsapp_contact_notes_member_insert ON public.whatsapp_contact_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
    AND author_id = auth.uid()
  );
CREATE POLICY whatsapp_contact_notes_author_update ON public.whatsapp_contact_notes
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()))
  WITH CHECK (author_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()));
CREATE POLICY whatsapp_contact_notes_author_delete ON public.whatsapp_contact_notes
  FOR DELETE TO authenticated
  USING (author_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.whatsapp_mark_conversation_read(_contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_organization_id UUID;
BEGIN
  SELECT contact.organization_id INTO v_organization_id
  FROM public.whatsapp_contacts AS contact
  WHERE contact.id = _contact_id;

  IF v_organization_id IS NULL
     OR NOT public.is_org_member(v_organization_id, auth.uid()) THEN
    RAISE EXCEPTION 'whatsapp_contact_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.whatsapp_contacts
  SET unread_count = 0, updated_at = now()
  WHERE id = _contact_id;
END;
$fn$;

-- O contato continua protegido por RLS. Só liberamos as colunas operacionais;
-- organization_id e wa_id permanecem imutáveis e fora do grant de UPDATE.
GRANT UPDATE (
  client_id, conversation_status, crm_stage, priority, assigned_to, tags,
  next_follow_up_at
) ON TABLE public.whatsapp_contacts TO authenticated;

REVOKE ALL ON TABLE public.whatsapp_contact_notes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_contact_notes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_contact_notes TO authenticated;

REVOKE ALL ON FUNCTION public.whatsapp_mark_conversation_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_mark_conversation_read(UUID) TO authenticated;

COMMENT ON COLUMN public.whatsapp_contacts.conversation_status IS
  'Estado operacional da conversa na caixa compartilhada.';
COMMENT ON COLUMN public.whatsapp_contacts.crm_stage IS
  'Etapa comercial do contato no funil do CRM.';
COMMENT ON COLUMN public.whatsapp_contacts.assigned_to IS
  'Membro ativo responsável pelo próximo movimento desta conversa.';
COMMENT ON TABLE public.whatsapp_contact_notes IS
  'Notas internas do CRM; nunca são enviadas ao contato pelo WhatsApp.';

COMMIT;
