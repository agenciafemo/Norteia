-- ============================================================================
-- Tarefas: lançar tempo à mão quando o cronômetro não foi usado.
--
-- Até aqui o tempo da tarefa só entrava pelo cronômetro, de propósito: o
-- gatilho maintain_task_time_entry força o início no relógio do banco para
-- impedir apontamento inflado pelo cliente. O efeito colateral é que quem
-- esquece de apertar "Iniciar" termina a tarefa com 0:00, e não há como
-- corrigir — o tempo gasto simplesmente some dos relatórios.
--
-- Agora dá para informar o tempo, mas sem abrir mão da proteção:
--   * o lançamento manual só entra pela função add_task_manual_time (a tela
--     nunca escreve direto na tabela com início/fim à sua escolha);
--   * toda linha diz de onde veio: source = 'cronometro' ou 'manual' — assim
--     quem analisa separa tempo medido de tempo declarado;
--   * o limite é de 16h por lançamento e a linha nasce finalizada (imutável,
--     como os apontamentos do cronômetro).
--
-- Idempotente.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.task_time_entries') IS NULL
     OR to_regclass('public.tasks') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas de tarefas';
  END IF;

  IF to_regprocedure('public.can_edit_org_content(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta a função de permissão can_edit_org_content';
  END IF;
END;
$$;

ALTER TABLE public.task_time_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'cronometro',
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE public.task_time_entries
  DROP CONSTRAINT IF EXISTS task_time_entries_source_check;
ALTER TABLE public.task_time_entries
  ADD CONSTRAINT task_time_entries_source_check
  CHECK (source IN ('cronometro', 'manual'));

ALTER TABLE public.task_time_entries
  DROP CONSTRAINT IF EXISTS task_time_entries_note_length;
ALTER TABLE public.task_time_entries
  ADD CONSTRAINT task_time_entries_note_length
  CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 300));

COMMENT ON COLUMN public.task_time_entries.source IS
  'cronometro = medido pelo relógio do banco; manual = informado pela pessoa via add_task_manual_time.';

-- O gatilho segue forçando o relógio do banco em todo INSERT — exceto quando
-- quem insere é add_task_manual_time, que liga a marca abaixo só durante a
-- própria transação. Sem a marca, qualquer tentativa de gravar início/fim
-- escolhidos pela tela continua sendo reescrita como cronômetro.
CREATE OR REPLACE FUNCTION public.maintain_task_time_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('norteia.tempo_manual', true) = 'on' THEN
      NEW.source := 'manual';
      RETURN NEW;
    END IF;

    -- Sempre usa o relogio do banco para impedir apontamento inflado pelo cliente.
    NEW.source := 'cronometro';
    NEW.note := NULL;
    NEW.started_at := clock_timestamp();
    NEW.ended_at := NULL;
    NEW.duration_seconds := NULL;
    RETURN NEW;
  END IF;

  IF NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'Tarefa, usuario, inicio e origem do apontamento nao podem ser alterados';
  END IF;

  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Um apontamento finalizado nao pode ser alterado';
  END IF;

  IF NEW.ended_at IS NULL THEN
    NEW.duration_seconds := NULL;
    RETURN NEW;
  END IF;

  NEW.ended_at := clock_timestamp();
  NEW.duration_seconds := GREATEST(
    0,
    floor(extract(epoch FROM (NEW.ended_at - OLD.started_at)))::INTEGER
  );
  RETURN NEW;
END;
$$;

-- Único caminho para lançar tempo à mão.
CREATE OR REPLACE FUNCTION public.add_task_manual_time(
  _task_id UUID,
  _minutes INTEGER,
  _note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_org UUID;
  v_agora TIMESTAMPTZ := clock_timestamp();
  v_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;

  IF _minutes IS NULL OR _minutes < 1 OR _minutes > 16 * 60 THEN
    RAISE EXCEPTION 'Informe entre 1 minuto e 16 horas';
  END IF;

  SELECT t.organization_id INTO v_org
  FROM public.tasks t
  WHERE t.id = _task_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Tarefa não encontrada';
  END IF;

  IF NOT public.can_edit_org_content(v_org, v_user) THEN
    RAISE EXCEPTION 'Sem permissão para lançar tempo nesta tarefa';
  END IF;

  -- Vale só nesta transação: o gatilho aceita o início/fim informados aqui e
  -- mais nenhum outro INSERT.
  PERFORM set_config('norteia.tempo_manual', 'on', true);

  INSERT INTO public.task_time_entries
    (task_id, user_id, started_at, ended_at, duration_seconds, source, note)
  VALUES (
    _task_id,
    v_user,
    v_agora - make_interval(mins => _minutes),
    v_agora,
    _minutes * 60,
    'manual',
    NULLIF(btrim(COALESCE(_note, '')), '')
  )
  RETURNING id INTO v_id;

  PERFORM set_config('norteia.tempo_manual', 'off', true);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_task_manual_time(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_task_manual_time(UUID, INTEGER, TEXT) TO authenticated;

COMMIT;

-- Conferência: 5 linhas, todas ok = true.
SELECT 'coluna de origem' AS item,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'task_time_entries'
                 AND column_name = 'source') AS ok
UNION ALL
SELECT 'apontamento sem origem vira cronômetro',
       (SELECT column_default ILIKE '%cronometro%'
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'task_time_entries'
          AND column_name = 'source')
UNION ALL
SELECT 'gatilho ainda força o relógio do banco',
       pg_get_functiondef('public.maintain_task_time_entry()'::regprocedure)
         ILIKE '%NEW.started_at := clock_timestamp()%'
UNION ALL
SELECT 'equipe pode lançar tempo manual',
       has_function_privilege('authenticated', 'public.add_task_manual_time(uuid,integer,text)', 'EXECUTE')
UNION ALL
SELECT 'visitante não pode',
       NOT has_function_privilege('anon', 'public.add_task_manual_time(uuid,integer,text)', 'EXECUTE');
