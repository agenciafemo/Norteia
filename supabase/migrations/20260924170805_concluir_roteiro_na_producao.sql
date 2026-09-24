-- Roteiro salvo e roteiro concluído são estados diferentes.
-- O texto pode ser revisado várias vezes sem antecipar o check da Produção.

BEGIN;

ALTER TABLE public.video_scripts
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.video_scripts.completed_at IS
  'Momento em que a pessoa marcou explicitamente o roteiro como concluído.';
COMMENT ON COLUMN public.video_scripts.completed_by IS
  'Pessoa que concluiu o roteiro; o check sincroniza com Produção e Tarefas.';

CREATE OR REPLACE FUNCTION public.stamp_video_script_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.completed_at IS DISTINCT FROM NEW.completed_at) THEN
    -- Em chamadas autenticadas, o relógio e o autor vêm do servidor. Durante
    -- o backfill da própria migration auth.uid() é NULL e os valores históricos
    -- calculados abaixo são preservados.
    IF auth.uid() IS NOT NULL THEN
      NEW.completed_at := now();
      NEW.completed_by := auth.uid();
    END IF;
  ELSIF NEW.completed_at IS NULL THEN
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stamp_video_script_completion
  ON public.video_scripts;
CREATE TRIGGER stamp_video_script_completion
  BEFORE INSERT OR UPDATE OF completed_at
  ON public.video_scripts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_video_script_completion();

REVOKE ALL ON FUNCTION public.stamp_video_script_completion()
  FROM PUBLIC, anon, authenticated;

-- Preserva o estado dos roteiros que a regra anterior já havia marcado na
-- Produção. Não inventa conclusão para roteiros sem uma etapa concluída.
UPDATE public.video_scripts vs
   SET completed_at = COALESCE(vs.completed_at, s.done_at, vs.updated_at, now()),
       completed_by = COALESCE(vs.completed_by, s.done_by)
  FROM public.production_items i
  JOIN public.production_item_steps s
    ON s.item_id = i.id
   AND s.step_key = 'roteiro'
   AND s.done = true
 WHERE i.post_id = vs.post_id
   AND vs.completed_at IS NULL;

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
  v_script := EXISTS (
    SELECT 1
      FROM public.video_scripts vs
     WHERE vs.post_id = p.post_id
       AND vs.completed_at IS NOT NULL
       AND COALESCE(btrim(vs.spoken_text), '') <> ''
  );
  v_any := v_media OR v_video OR v_caption OR v_copy OR v_script;

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

DROP TRIGGER IF EXISTS sync_production_steps_from_video_script
  ON public.video_scripts;
CREATE TRIGGER sync_production_steps_from_video_script
  AFTER INSERT OR UPDATE OF post_id, spoken_text, completed_at OR DELETE
  ON public.video_scripts
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_steps_from_video_script();

COMMIT;
