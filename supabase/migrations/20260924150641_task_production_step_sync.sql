-- ============================================================================
-- CHECK DA TAREFA <-> ETAPA DA PRODUCAO
--
-- Uma peca enviada ao Kanban ja criava uma subtarefa por etapa, mas as duas
-- listas nao sabiam qual linha correspondia a qual. Este vinculo faz o check
-- dado no card atualizar a etapa certa da Producao (e vice-versa).
-- ============================================================================

BEGIN;

ALTER TABLE public.task_subtasks
  ADD COLUMN IF NOT EXISTS production_step_id UUID
    REFERENCES public.production_item_steps(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.task_subtasks.production_step_id IS
  'Etapa da Producao representada por esta subtarefa. O estado done e sincronizado nos dois sentidos.';

CREATE UNIQUE INDEX IF NOT EXISTS task_subtasks_production_step_unique
  ON public.task_subtasks (production_step_id)
  WHERE production_step_id IS NOT NULL;

-- Recupera o vinculo das pecas que ja foram enviadas. O numero da ocorrencia
-- evita cruzar duas etapas de mesmo nome dentro da mesma peca.
WITH production_ranked AS (
  SELECT
    ps.id AS production_step_id,
    ps.assignee_id,
    pi.task_id,
    ps.label,
    row_number() OVER (
      PARTITION BY pi.task_id, ps.label
      ORDER BY ps.position, ps.id
    ) AS occurrence
  FROM public.production_item_steps ps
  JOIN public.production_items pi ON pi.id = ps.item_id
  WHERE pi.task_id IS NOT NULL
), task_ranked AS (
  SELECT
    st.id AS subtask_id,
    st.task_id,
    st.title,
    row_number() OVER (
      PARTITION BY st.task_id, st.title
      ORDER BY st.position, st.id
    ) AS occurrence
  FROM public.task_subtasks st
  WHERE st.production_step_id IS NULL
)
UPDATE public.task_subtasks st
SET production_step_id = pr.production_step_id,
    assignee_id = COALESCE(st.assignee_id, pr.assignee_id)
FROM production_ranked pr
JOIN task_ranked tr
  ON tr.task_id = pr.task_id
 AND tr.title = pr.label
 AND tr.occurrence = pr.occurrence
WHERE st.id = tr.subtask_id;

-- Impede vinculo cruzado: a etapa e a tarefa precisam pertencer a mesma
-- organizacao e a peca precisa estar ligada a esta tarefa.
CREATE OR REPLACE FUNCTION public.validate_task_subtask_production_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.production_step_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.production_item_steps ps
    JOIN public.production_items pi ON pi.id = ps.item_id
    JOIN public.tasks t ON t.id = NEW.task_id
    WHERE ps.id = NEW.production_step_id
      AND ps.organization_id = t.organization_id
      AND pi.organization_id = t.organization_id
      AND pi.task_id = NEW.task_id
  ) THEN
    RAISE EXCEPTION 'A etapa de producao nao pertence a tarefa informada';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_task_subtask_production_step
  ON public.task_subtasks;
CREATE TRIGGER validate_task_subtask_production_step
  BEFORE INSERT OR UPDATE OF task_id, production_step_id
  ON public.task_subtasks
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_task_subtask_production_step();

-- SECURITY DEFINER e necessario porque o responsavel operacional pode marcar
-- a propria subtarefa sem ter permissao geral de edicao em Producao. A funcao
-- nao recebe IDs do cliente: usa apenas a relacao validada gravada na linha.
CREATE OR REPLACE FUNCTION public.sync_production_step_from_task_subtask()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.production_step_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.production_item_steps ps
    JOIN public.production_items pi ON pi.id = ps.item_id
    WHERE ps.id = NEW.production_step_id
      AND pi.task_id = NEW.task_id
  ) THEN
    RAISE EXCEPTION 'Vinculo entre subtarefa e producao invalido';
  END IF;

  UPDATE public.production_item_steps
     SET done = NEW.done,
         done_at = CASE WHEN NEW.done THEN COALESCE(done_at, now()) ELSE NULL END,
         done_by = CASE WHEN NEW.done THEN auth.uid() ELSE NULL END
   WHERE id = NEW.production_step_id
     AND done IS DISTINCT FROM NEW.done;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_production_step_from_task_subtask
  ON public.task_subtasks;
CREATE TRIGGER sync_production_step_from_task_subtask
  AFTER INSERT OR UPDATE OF done
  ON public.task_subtasks
  FOR EACH ROW
  WHEN (NEW.production_step_id IS NOT NULL)
  EXECUTE FUNCTION public.sync_production_step_from_task_subtask();

CREATE OR REPLACE FUNCTION public.sync_task_subtask_from_production_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.task_subtasks
     SET done = NEW.done,
         done_at = CASE WHEN NEW.done THEN COALESCE(done_at, NEW.done_at, now()) ELSE NULL END
   WHERE production_step_id = NEW.id
     AND done IS DISTINCT FROM NEW.done;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_task_subtask_from_production_step
  ON public.production_item_steps;
CREATE TRIGGER sync_task_subtask_from_production_step
  AFTER UPDATE OF done
  ON public.production_item_steps
  FOR EACH ROW
  WHEN (OLD.done IS DISTINCT FROM NEW.done)
  EXECUTE FUNCTION public.sync_task_subtask_from_production_step();

REVOKE ALL ON FUNCTION public.sync_production_step_from_task_subtask()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_task_subtask_from_production_step()
  FROM PUBLIC, anon, authenticated;

-- O responsavel direto da etapa pode dar o check. Quando a etapa ainda nao
-- tem responsavel proprio, o responsavel da tarefa-mae assume esse direito.
DROP POLICY IF EXISTS "assignee_update_own_task_subtasks"
  ON public.task_subtasks;
CREATE POLICY "assignee_update_own_task_subtasks"
ON public.task_subtasks FOR UPDATE TO authenticated
USING (
  assignee_id = auth.uid()
  OR (
    assignee_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_subtasks.task_id
        AND t.assignee_id = auth.uid()
    )
  )
)
WITH CHECK (
  assignee_id = auth.uid()
  OR (
    assignee_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_subtasks.task_id
        AND t.assignee_id = auth.uid()
    )
  )
);

-- Conclusao da tarefa-mae sem abrir permissao ampla de UPDATE. O responsavel
-- pode concluir a propria tarefa, mas nao consegue trocar titulo, cliente,
-- responsavel ou qualquer outro campo por este caminho.
CREATE OR REPLACE FUNCTION public.complete_assigned_task(_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_next_position INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = _task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa nao encontrada';
  END IF;

  IF NOT public.can_edit_org_content(v_task.organization_id)
     AND NOT (
       v_task.assignee_id = auth.uid()
       AND public.is_org_member(v_task.organization_id, auth.uid())
     ) THEN
    RAISE EXCEPTION 'Sem permissao para concluir esta tarefa';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_subtasks st
    WHERE st.task_id = _task_id AND st.done = false
  ) THEN
    RAISE EXCEPTION 'Conclua todas as etapas antes de finalizar a tarefa';
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1
    INTO v_next_position
  FROM public.tasks
  WHERE organization_id = v_task.organization_id
    AND status = 'done';

  UPDATE public.tasks
     SET status = 'done',
         position = v_next_position
   WHERE id = _task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_assigned_task(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_assigned_task(UUID)
  TO authenticated;

COMMIT;
