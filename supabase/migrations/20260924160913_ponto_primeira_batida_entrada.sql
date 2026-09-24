-- ============================================================================
-- Ponto: primeira batida oficial continua sendo entrada depois do meio-dia.
--
-- Ajustes pendentes participam da sequencia para que "esqueci a entrada" possa
-- registrar a saida atual corretamente. Mas isso criava uma ambiguidade: se
-- havia uma entrada retroativa aguardando a ADM e a pessoa escolhia "estou
-- chegando agora", a primeira batida REAL das 13h virava saida para almoco.
--
-- A intencao enviada pela tela agora desempata: sem nenhuma batida oficial no
-- dia, uma sugestao explicita de entrada e preservada em qualquer horario. O
-- fluxo "esqueci a entrada" continua enviando a sugestao da saida atual e,
-- portanto, continua considerando o ajuste pendente na sequencia.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_time_clock_punch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_day_start TIMESTAMPTZ;
  v_next_day_start TIMESTAMPTZ;
  v_last_kind TEXT;
  v_tem_batida_oficial BOOLEAN;
  v_almoco_feito BOOLEAN;
  v_segundo INTEGER;
  v_esperado TEXT;
  v_adjustment public.time_clock_adjustment_requests%ROWTYPE;
BEGIN
  IF NEW.adjustment_request_id IS NOT NULL THEN
    SELECT request.*
    INTO v_adjustment
    FROM public.time_clock_adjustment_requests request
    WHERE request.id = NEW.adjustment_request_id
      AND request.status = 'approved';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A solicitacao de ajuste precisa estar aprovada';
    END IF;

    NEW.organization_id := v_adjustment.organization_id;
    NEW.user_id := v_adjustment.user_id;
    NEW.punched_at := v_adjustment.requested_punched_at;
    NEW.kind := v_adjustment.kind;
    NEW.note := left('Ajuste aprovado: ' || v_adjustment.reason, 500);
    NEW.created_at := v_adjustment.reviewed_at;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members member
    WHERE member.organization_id = NEW.organization_id
      AND member.user_id = NEW.user_id
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'O usuario deve ser membro ativo da organizacao';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.organization_id::TEXT || ':' || NEW.user_id::TEXT, 0)
  );

  v_day_start := date_trunc('day', v_now AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo';
  v_next_day_start := v_day_start + INTERVAL '1 day';
  v_segundo := public.time_clock_segundo_do_dia(v_now);

  SELECT EXISTS (
    SELECT 1
    FROM public.time_clock_punches punch
    WHERE punch.organization_id = NEW.organization_id
      AND punch.user_id = NEW.user_id
      AND punch.punched_at >= v_day_start
      AND punch.punched_at < v_next_day_start
  ) INTO v_tem_batida_oficial;

  -- Ultima etapa do dia: batidas oficiais + ajustes ainda em analise.
  SELECT sequence.kind
  INTO v_last_kind
  FROM (
    SELECT punch.kind, punch.punched_at AS happened_at
    FROM public.time_clock_punches punch
    WHERE punch.organization_id = NEW.organization_id
      AND punch.user_id = NEW.user_id
      AND punch.punched_at >= v_day_start
      AND punch.punched_at < v_next_day_start
    UNION ALL
    SELECT request.kind, request.requested_punched_at AS happened_at
    FROM public.time_clock_adjustment_requests request
    WHERE request.organization_id = NEW.organization_id
      AND request.user_id = NEW.user_id
      AND request.status = 'pending'
      AND request.requested_punched_at >= v_day_start
      AND request.requested_punched_at < v_next_day_start
  ) sequence
  ORDER BY sequence.happened_at DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.time_clock_punches punch
    WHERE punch.organization_id = NEW.organization_id
      AND punch.user_id = NEW.user_id
      AND punch.kind = 'saida_almoco'
      AND punch.punched_at >= v_day_start
      AND punch.punched_at < v_next_day_start
  ) INTO v_almoco_feito;

  -- A escolha "estou chegando agora" vence ajustes ainda pendentes. Esta e a
  -- primeira batida oficial, então nao pode virar almoco apenas pelo horario.
  IF NOT v_tem_batida_oficial AND NEW.kind = 'entrada' THEN
    v_esperado := 'entrada';
  ELSIF v_last_kind IS NULL THEN
    v_esperado := 'entrada';
  ELSIF v_last_kind = 'saida_almoco' THEN
    v_esperado := 'volta_almoco';
  ELSIF v_last_kind = 'saida_intervalo' THEN
    v_esperado := 'volta_intervalo';
  ELSIF v_last_kind = 'saida' THEN
    RAISE EXCEPTION 'A jornada de hoje ja foi concluida';
  ELSE
    IF NOT v_almoco_feito
       AND v_segundo >= (SELECT de FROM public.time_clock_janela('saida_almoco'))
       AND v_segundo <= (SELECT ate FROM public.time_clock_janela('saida_almoco')) THEN
      v_esperado := 'saida_almoco';
    ELSIF v_segundo >= (SELECT de FROM public.time_clock_janela('saida')) THEN
      v_esperado := 'saida';
    ELSE
      v_esperado := 'saida_intervalo';
    END IF;
  END IF;

  NEW.kind := v_esperado;
  NEW.punched_at := v_now;
  NEW.created_at := NEW.punched_at;
  NEW.note := NULLIF(btrim(NEW.note), '');
  RETURN NEW;
END;
$$;

COMMIT;

SELECT 'primeira batida oficial respeita chegada agora' AS item,
       pg_get_functiondef('public.prepare_time_clock_punch()'::regprocedure)
         ILIKE '%NOT v_tem_batida_oficial AND NEW.kind = ''entrada''%' AS ok;
