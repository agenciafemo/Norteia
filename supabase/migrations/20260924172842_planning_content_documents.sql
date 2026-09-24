-- Documentos de copy e roteiro que pertencem a um planejamento.
-- O vínculo com post_id é estrutural: o rótulo visual (#Reel 1, #Post 2) pode
-- mudar quando a grade é reordenada sem mandar o texto para a peça errada.

BEGIN;

CREATE TABLE public.planning_content_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  planning_id UUID NOT NULL REFERENCES public.plannings(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('copy', 'script')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  ai_content JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX planning_content_documents_planning_idx
  ON public.planning_content_documents (planning_id, updated_at DESC);
CREATE INDEX planning_content_documents_post_idx
  ON public.planning_content_documents (post_id)
  WHERE post_id IS NOT NULL;

COMMENT ON TABLE public.planning_content_documents IS
  'Área de trabalho editorial do planejamento; guarda rascunhos e a saída estruturada da IA antes de aplicar em posts ou roteiros.';
COMMENT ON COLUMN public.planning_content_documents.ai_content IS
  'Resposta estruturada e validada de generate-content. Continua editável e nunca é aplicada automaticamente.';

CREATE OR REPLACE FUNCTION public.sync_planning_content_document_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_organization_id UUID;
  v_client_id UUID;
BEGIN
  SELECT organization_id, client_id
    INTO v_organization_id, v_client_id
    FROM public.plannings
   WHERE id = NEW.planning_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'planning_not_found';
  END IF;

  IF NEW.post_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.posts
     WHERE id = NEW.post_id AND planning_id = NEW.planning_id
  ) THEN
    RAISE EXCEPTION 'post_outside_planning';
  END IF;

  NEW.organization_id := v_organization_id;
  NEW.client_id := v_client_id;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sync_planning_content_document_scope
  BEFORE INSERT OR UPDATE OF planning_id, post_id, title, body, ai_content, status
  ON public.planning_content_documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_planning_content_document_scope();

ALTER TABLE public.planning_content_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY planning_content_documents_select
  ON public.planning_content_documents
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY planning_content_documents_insert
  ON public.planning_content_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY planning_content_documents_update
  ON public.planning_content_documents
  FOR UPDATE TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY planning_content_documents_delete
  ON public.planning_content_documents
  FOR DELETE TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.planning_content_documents TO authenticated;

REVOKE ALL ON FUNCTION public.sync_planning_content_document_scope()
  FROM PUBLIC, anon, authenticated;

COMMIT;
