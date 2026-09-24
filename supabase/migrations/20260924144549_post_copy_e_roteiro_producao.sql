-- Fase 1: copy dentro do post e roteiro ligado a uma peça específica.
--
-- A Produção já espelha mídia/legenda/status de posts. Esta migration acrescenta
-- as duas fontes que faltavam: o texto de Copy e o roteiro do Reel.

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS copy_text TEXT,
  ADD COLUMN IF NOT EXISTS carousel_copy JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.posts.copy_text IS
  'Copy interna da peça estática; diferente da legenda publicada.';
COMMENT ON COLUMN public.posts.carousel_copy IS
  'Array de textos de copy alinhado pela posição aos slides de media_urls.';

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'posts_carousel_copy_is_array'
       AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_carousel_copy_is_array
      CHECK (jsonb_typeof(carousel_copy) = 'array');
  END IF;
END;
$block$;

ALTER TABLE public.video_scripts
  ADD COLUMN IF NOT EXISTS post_id UUID
  REFERENCES public.posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS video_scripts_post_id_idx
  ON public.video_scripts(post_id)
  WHERE post_id IS NOT NULL;

COMMENT ON COLUMN public.video_scripts.post_id IS
  'Reel do planejamento ao qual o roteiro pertence; permite concluir a etapa Roteiro da peça correta.';

CREATE OR REPLACE FUNCTION public.sync_production_steps_for_item(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p          RECORD;
  v_media    BOOLEAN;
  v_video    BOOLEAN;
  v_caption  BOOLEAN;
  v_copy     BOOLEAN;
  v_script   BOOLEAN;
  v_any      BOOLEAN;
BEGIN
  SELECT po.id AS post_id, po.content_type, po.cover_image_url, po.media_urls,
         po.video_url, po.caption, po.status, po.copy_text, po.carousel_copy
    INTO p
    FROM public.production_items i
    JOIN public.posts po ON po.id = i.post_id
   WHERE i.id = p_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_media   := (COALESCE(btrim(p.cover_image_url), '') <> '')
               OR (COALESCE(p.media_urls::text, '') NOT IN ('', '[]', '{}', 'null'));
  v_video   := COALESCE(btrim(p.video_url), '') <> '';
  v_caption := COALESCE(btrim(p.caption), '') <> '';
  v_copy    := CASE
    WHEN p.content_type = 'carousel' THEN EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(COALESCE(p.carousel_copy, '[]'::jsonb)) AS value(text)
       WHERE btrim(value.text) <> ''
    )
    ELSE COALESCE(btrim(p.copy_text), '') <> ''
  END;
  v_script  := EXISTS (
    SELECT 1
      FROM public.video_scripts vs
     WHERE vs.post_id = p.post_id
       AND COALESCE(btrim(vs.spoken_text), '') <> ''
  );
  v_any := v_media OR v_video OR v_caption OR v_copy OR v_script;

  -- Assim como a sincronização anterior, só conclui automaticamente. Uma ação
  -- manual da equipe nunca é apagada quando alguém edita ou remove conteúdo.
  UPDATE public.production_item_steps s
     SET done    = true,
         done_at = COALESCE(s.done_at, now())
   WHERE s.item_id = p_item_id
     AND s.done = false
     AND (
          (s.step_key = 'design'                     AND v_media)
       OR (s.step_key = 'edicao'                     AND v_video)
       OR (s.step_key IN ('legenda', 'legenda_capa') AND v_caption)
       OR (s.step_key = 'copy'                       AND v_copy)
       OR (s.step_key = 'roteiro'                    AND v_script)
       OR (s.step_key = 'enviar_planejamento'        AND v_any)
       OR (s.step_key = 'revisao'                    AND p.status IN ('pending', 'approved'))
     );

  UPDATE public.production_item_steps s
     SET done    = (p.status = 'approved'),
         outcome = CASE WHEN p.status = 'approved' THEN 'aprovado' ELSE NULL END,
         done_at = CASE WHEN p.status = 'approved' THEN COALESCE(s.done_at, now()) ELSE NULL END
   WHERE s.item_id = p_item_id
     AND s.step_key = 'aprov_cliente';
END;
$fn$;

-- Um roteiro é salvo fora da tabela posts, portanto precisa acionar a mesma
-- sincronização da peça vinculada.
CREATE OR REPLACE FUNCTION public.sync_production_steps_from_video_script()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_post_id UUID;
  v_item_id UUID;
BEGIN
  v_post_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;

  IF v_post_id IS NOT NULL THEN
    FOR v_item_id IN
      SELECT id FROM public.production_items WHERE post_id = v_post_id
    LOOP
      PERFORM public.sync_production_steps_for_item(v_item_id);
    END LOOP;
  END IF;

  -- Se um roteiro foi movido entre Reels, sincroniza também a peça antiga.
  IF TG_OP = 'UPDATE'
     AND OLD.post_id IS DISTINCT FROM NEW.post_id
     AND OLD.post_id IS NOT NULL THEN
    FOR v_item_id IN
      SELECT id FROM public.production_items WHERE post_id = OLD.post_id
    LOOP
      PERFORM public.sync_production_steps_for_item(v_item_id);
    END LOOP;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_production_steps_from_video_script ON public.video_scripts;
CREATE TRIGGER sync_production_steps_from_video_script
  AFTER INSERT OR UPDATE OF post_id, spoken_text OR DELETE
  ON public.video_scripts
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_steps_from_video_script();

-- As funções existem para os triggers/RPCs do banco, não como endpoints
-- genéricos da Data API. O vínculo de peça continua passando pela RPC que
-- valida organização e usuário.
REVOKE ALL ON FUNCTION public.sync_production_steps_for_item(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_production_steps_from_video_script()
  FROM PUBLIC, anon, authenticated;

-- Conteúdo eventualmente preenchido antes do deploy já conclui a etapa quando
-- a migration entra, sem depender de uma nova edição manual do post.
DO $block$
DECLARE
  v_item_id UUID;
BEGIN
  FOR v_item_id IN
    SELECT id FROM public.production_items WHERE post_id IS NOT NULL
  LOOP
    PERFORM public.sync_production_steps_for_item(v_item_id);
  END LOOP;
END;
$block$;

COMMIT;
