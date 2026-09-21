import { supabase } from "@/integrations/supabase/client";

// Timer de tarefa em andamento (ended_at nulo). Compartilhado pelo chip da
// navbar e pela janelinha Picture-in-Picture (mesma query key -> um fetch só).

export type RunningEntry = {
  id: string;
  task_id: string;
  started_at: string;
  tasks: { title: string } | null;
};

// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function loadRunningTimer(userId: string): Promise<RunningEntry | null> {
  const { data } = await (supabase as AnyClient)
    .from("task_time_entries")
    .select("id, task_id, started_at, tasks(title)")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RunningEntry | null) ?? null;
}

export async function stopTimerEntry(entryId: string): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("task_time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) throw error;
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function elapsedFrom(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

/** Maior lançamento manual aceito (mesmo limite da função no banco). */
export const TEMPO_MANUAL_MAX_MINUTOS = 16 * 60;

/**
 * Converte horas + minutos digitados em minutos válidos, ou null.
 *
 * Aceita "0h 45min", "2h 0min", "1h 90min" (vira 2h30). Recusa zero, negativo
 * e acima de 16h — o banco recusaria do mesmo jeito, mas avisar antes poupa a
 * pessoa de um erro depois de clicar em salvar.
 */
export function minutosInformados(horas: number, minutos: number): number | null {
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null;
  if (horas < 0 || minutos < 0) return null;
  const total = Math.round(horas) * 60 + Math.round(minutos);
  if (total < 1 || total > TEMPO_MANUAL_MAX_MINUTOS) return null;
  return total;
}

/**
 * Lança tempo à mão numa tarefa. Só existe este caminho: a tabela não aceita
 * início/fim escolhidos pela tela, e a linha fica marcada como "manual" para
 * separar tempo medido de tempo declarado.
 */
export async function addManualTaskTime(taskId: string, minutes: number, note?: string): Promise<void> {
  const { error } = await (supabase as AnyClient).rpc("add_task_manual_time", {
    _task_id: taskId,
    _minutes: minutes,
    _note: note?.trim() || null,
  });
  if (error) throw error;
}
