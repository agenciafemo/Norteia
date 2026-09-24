-- Um post de planejamento deve sempre ter exatamente uma peça no quadro de
-- Produção. A regra fica no banco para cobrir criação normal, duplicação,
-- templates e posts acrescentados depois, sem depender da tela usada.

BEGIN;

-- A função histórica ainda não conhecia LinkedIn. Ela continua sendo a fonte
-- padrão para realinhamento e agora também serve ao gatilho de criação.
CREATE OR REPLACE FUNCTION public.production_pipeline()
RETURNS TABLE(content_type TEXT, step_key TEXT, label TEXT, kind TEXT, pos INT, role TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('reels',    'roteiro',             'Roteiro',                    'check', 0, 'writing'),
    ('reels',    'aprov_roteiro',       'Aprovação do roteiro',       'gate',  1, 'review'),
    ('reels',    'captacao',            'Captação',                   'data',  2, 'editing'),
    ('reels',    'edicao',              'Edição',                     'check', 3, 'editing'),
    ('reels',    'legenda_capa',        'Legenda e capa',             'check', 4, 'design'),
    ('reels',    'enviar_planejamento', 'Enviar para o planejamento', 'acao',  5, 'design'),
    ('reels',    'revisao',             'Revisão',                    'check', 6, 'review'),
    ('reels',    'aprov_cliente',       'Aprovação do cliente',       'gate',  7, 'review'),

    ('carousel', 'copy',                'Copy',                       'check', 0, 'design'),
    ('carousel', 'design',              'Design',                     'check', 1, 'design'),
    ('carousel', 'legenda',             'Legenda',                    'check', 2, 'design'),
    ('carousel', 'enviar_planejamento', 'Enviar para o planejamento', 'acao',  3, 'design'),
    ('carousel', 'revisao',             'Revisão',                    'check', 4, 'review'),
    ('carousel', 'aprov_cliente',       'Aprovação do cliente',       'gate',  5, 'review'),

    ('static',   'copy',                'Copy',                       'check', 0, 'design'),
    ('static',   'design',              'Design',                     'check', 1, 'design'),
    ('static',   'legenda',             'Legenda',                    'check', 2, 'design'),
    ('static',   'enviar_planejamento', 'Enviar para o planejamento', 'acao',  3, 'design'),
    ('static',   'revisao',             'Revisão',                    'check', 4, 'review'),
    ('static',   'aprov_cliente',       'Aprovação do cliente',       'gate',  5, 'review'),

    ('story',    'design',              'Arte do story',              'check', 0, 'design'),
    ('story',    'enviar_planejamento', 'Enviar para o planejamento', 'acao',  1, 'design'),
    ('story',    'revisao',             'Revisão',                    'check', 2, 'review'),
    ('story',    'aprov_cliente',       'Aprovação do cliente',       'gate',  3, 'review'),

    ('blog',     'texto',               'Texto',                      'check', 0, 'writing'),
    ('blog',     'revisao',             'Revisão',                    'check', 1, 'review'),
    ('blog',     'enviar_planejamento', 'Enviar para o planejamento', 'acao',  2, 'design'),
    ('blog',     'aprov_cliente',       'Aprovação do cliente',       'gate',  3, 'review'),

    ('linkedin', 'copy',                'Copy',                       'check', 0, 'writing'),
    ('linkedin', 'design',              'Arte',                       'check', 1, 'design'),
    ('linkedin', 'enviar_planejamento', 'Enviar para o planejamento', 'acao',  2, 'design'),
    ('linkedin', 'revisao',             'Revisão',                    'check', 3, 'review'),
    ('linkedin', 'aprov_cliente',       'Aprovação do cliente',       'gate',  4, 'review'),

    ('extra',    'concluir',            'Concluir',                   'check', 0, NULL)
  ) AS t(content_type, step_key, label, kind, pos, role);
$$;

CREATE OR REPLACE FUNCTION public.ensure_production_item_for_post(p_post_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_post RECORD;
  v_item_id UUID;
  v_piece_number INTEGER;
  v_first_step TEXT;
BEGIN
  SELECT po.id, po.planning_id, po.content_type, po.position,
         pl.organization_id, pl.client_id, pl.month, pl.year, pl.created_by
    INTO v_post
    FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
   WHERE po.id = p_post_id;

  IF NOT FOUND OR v_post.organization_id IS NULL OR v_post.client_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Número dentro do tipo e do planejamento, estável pela ordem do post.
  SELECT count(*)::INTEGER
    INTO v_piece_number
    FROM public.posts sibling
   WHERE sibling.planning_id = v_post.planning_id
     AND sibling.content_type = v_post.content_type
     AND (
       sibling.position < v_post.position
       OR (sibling.position = v_post.position AND sibling.id <= v_post.id)
     );

  SELECT effective.step_key
    INTO v_first_step
    FROM (
      SELECT t.step_key, t.position
        FROM public.production_step_templates t
       WHERE t.organization_id = v_post.organization_id
         AND t.content_type = v_post.content_type
      UNION ALL
      SELECT p.step_key, p.pos
        FROM public.production_pipeline() p
       WHERE p.content_type = v_post.content_type
         AND NOT EXISTS (
           SELECT 1
             FROM public.production_step_templates t
            WHERE t.organization_id = v_post.organization_id
              AND t.content_type = v_post.content_type
         )
    ) effective
   ORDER BY effective.position
   LIMIT 1;

  INSERT INTO public.production_items (
    organization_id, planning_id, client_id, post_id, content_type,
    piece_number, stage, position, mes_referencia, created_by
  ) VALUES (
    v_post.organization_id, v_post.planning_id, v_post.client_id, v_post.id,
    v_post.content_type, GREATEST(v_piece_number, 1), COALESCE(v_first_step, 'copy'),
    v_post.position, make_date(v_post.year, v_post.month, 1), v_post.created_by
  )
  ON CONFLICT (post_id) WHERE post_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_item_id;

  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id
      FROM public.production_items
     WHERE post_id = v_post.id;
  END IF;

  -- Modelo salvo pela organização vence o padrão. ON CONFLICT torna a função
  -- segura para retries e para bancos que já receberam peças pelo frontend.
  INSERT INTO public.production_item_steps (
    organization_id, item_id, step_key, label, kind, position, done, assignee_id
  )
  SELECT
    v_post.organization_id,
    v_item_id,
    effective.step_key,
    effective.label,
    effective.kind,
    effective.position,
    false,
    CASE effective.role
      WHEN 'design'  THEN roles.design_user_id
      WHEN 'writing' THEN roles.writing_user_id
      WHEN 'editing' THEN roles.editing_user_id
      WHEN 'review'  THEN roles.review_user_id
      ELSE NULL
    END
  FROM (
    SELECT t.step_key, t.label, t.kind, t.position, t.role
      FROM public.production_step_templates t
     WHERE t.organization_id = v_post.organization_id
       AND t.content_type = v_post.content_type
    UNION ALL
    SELECT p.step_key, p.label, p.kind, p.pos, p.role
      FROM public.production_pipeline() p
     WHERE p.content_type = v_post.content_type
       AND NOT EXISTS (
         SELECT 1
           FROM public.production_step_templates t
          WHERE t.organization_id = v_post.organization_id
            AND t.content_type = v_post.content_type
       )
  ) effective
  LEFT JOIN public.production_role_assignees roles
    ON roles.organization_id = v_post.organization_id
  ON CONFLICT (item_id, step_key) DO NOTHING;

  -- Um post copiado ou já preenchido pode nascer com conteúdo. Nesse caso as
  -- etapas correspondentes precisam chegar marcadas na mesma transação.
  PERFORM public.sync_production_steps_for_item(v_item_id);

  RETURN v_item_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ensure_production_item_for_post(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_production_item_from_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.ensure_production_item_for_post(NEW.id);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_production_item_from_post()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS create_production_item_from_post ON public.posts;
CREATE TRIGGER create_production_item_from_post
  AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.create_production_item_from_post();

-- Recupera planejamentos antigos ou criados por caminhos que não executavam a
-- sincronização (por exemplo, replicação de template).
DO $backfill$
DECLARE
  v_post_id UUID;
BEGIN
  FOR v_post_id IN
    SELECT po.id
      FROM public.posts po
      JOIN public.plannings pl ON pl.id = po.planning_id
      LEFT JOIN public.production_items item ON item.post_id = po.id
     WHERE item.id IS NULL
       AND pl.organization_id IS NOT NULL
       AND pl.client_id IS NOT NULL
       -- Não despeja anos de arquivo morto no quadro no primeiro deploy. O
       -- mês corrente e os planejamentos futuros entram; o histórico continua
       -- disponível no Planejamento sem virar trabalho pendente artificial.
       AND make_date(pl.year, pl.month, 1) >= date_trunc('month', CURRENT_DATE)::date
  LOOP
    PERFORM public.ensure_production_item_for_post(v_post_id);
  END LOOP;
END;
$backfill$;

COMMENT ON FUNCTION public.ensure_production_item_for_post(UUID) IS
  'Garante, de forma idempotente, a peça e as etapas de Produção de um post de planejamento.';

COMMIT;
