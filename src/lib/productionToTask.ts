import { supabase } from "@/integrations/supabase/client";
import { PIECE_LABEL } from "@/lib/productionPipeline";

// A tabela production_items ganhou task_id numa migration nova, e o types.ts
// gerado ainda não a conhece — mesmo padrão de cast já usado em Producao.tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Etapa da peça, como ela vem do quadro de produção. */
export interface EtapaDaPeca {
  id: string;
  label: string;
  position: number;
  done: boolean;
  assigneeId: string | null;
}

export interface EnviarParaKanbanInput {
  itemId: string;
  organizationId: string;
  clientId: string | null;
  /** Vira o título da tarefa-mãe. Ex.: "Reels 1". */
  titulo: string;
  etapas: EtapaDaPeca[];
  assigneeId: string;
  dueDate: string;
  createdBy: string;
}

/**
 * Nome que a peça leva para o Kanban.
 *
 * Vivia dentro de Producao.tsx. Subiu para cá quando a tela de Tarefas passou a
 * puxar peças também: duas telas montando o mesmo título por conta própria é
 * como se chega em "Reel 1" num lugar e "Reels 1" no outro.
 */
export function tituloDaPeca(peca: {
  title: string | null;
  content_type: string;
  piece_number: number;
}): string {
  return peca.title?.trim()
    ? peca.title.trim()
    : `${PIECE_LABEL[peca.content_type] ?? peca.content_type} ${peca.piece_number}`;
}

/** A peça já foi enviada antes — a tela deve levar à tarefa em vez de criar outra. */
export class PecaJaNoKanbanError extends Error {
  constructor(public readonly taskId: string) {
    super("Esta peça já está no Kanban.");
    this.name = "PecaJaNoKanbanError";
  }
}

/**
 * Manda uma peça do quadro de Produção para o Kanban: cria a tarefa-mãe e uma
 * subtarefa por etapa da peça (roteiro, captação, edição, aprovação...).
 *
 * As duas listas continuam existindo, cada uma com sua finalidade, mas cada
 * subtarefa guarda a etapa que representa. Assim, o check rapido no Kanban e
 * o check da Producao sao a mesma conclusao, nao dois controles concorrentes.
 */
export async function enviarPecaParaKanban(
  input: EnviarParaKanbanInput,
): Promise<string> {
  const db = supabase as AnyClient;

  // Relê do banco em vez de confiar na tela: entre carregar o quadro e clicar,
  // outra pessoa pode ter enviado a mesma peça.
  const atual = await db
    .from("production_items")
    .select("task_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (atual.error) throw new Error(atual.error.message);
  if (atual.data?.task_id) throw new PecaJaNoKanbanError(atual.data.task_id);

  const { data: task, error: taskError } = await db
    .from("tasks")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      title: input.titulo,
      status: "todo",
      priority: "medium",
      assignee_id: input.assigneeId,
      due_date: input.dueDate,
      tags: ["producao"],
      created_by: input.createdBy,
    })
    .select("id")
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.id) throw new Error("Não foi possível criar a tarefa.");

  // Reserva a peca para esta tarefa antes de criar as subtarefas. Alem de ser
  // necessario para validar o vinculo de cada etapa, o filtro por NULL fecha a
  // corrida de duas pessoas clicando em "Enviar" ao mesmo tempo.
  const { data: marcada, error: linkError } = await db
    .from("production_items")
    .update({ task_id: task.id })
    .eq("id", input.itemId)
    .is("task_id", null)
    .select("id");
  if (linkError) {
    await db.from("tasks").delete().eq("id", task.id);
    throw new Error(linkError.message);
  }
  if (!marcada || marcada.length === 0) {
    await db.from("tasks").delete().eq("id", task.id);
    const concorrente = await db
      .from("production_items")
      .select("task_id")
      .eq("id", input.itemId)
      .maybeSingle();
    if (concorrente.data?.task_id) {
      throw new PecaJaNoKanbanError(concorrente.data.task_id);
    }
    throw new Error("Não foi possível vincular a peça à tarefa.");
  }

  // Cada etapa vira uma subtarefa, preservando ordem, responsavel e estado —
  // uma peca enviada no meio do caminho chega ao Kanban com o avanco real.
  const subtarefas = [...input.etapas]
    .sort((a, b) => a.position - b.position)
    .map((etapa, index) => ({
      task_id: task.id,
      title: etapa.label,
      done: etapa.done,
      position: index,
      assignee_id: etapa.assigneeId,
      production_step_id: etapa.id,
    }));

  if (subtarefas.length > 0) {
    const { error: subError } = await db.from("task_subtasks").insert(subtarefas);
    // A tarefa sem as subtarefas seria pior que nada: some o motivo de existir,
    // e a peça ficaria marcada como enviada. Desfaz e deixa tentar de novo.
    if (subError) {
      await db
        .from("production_items")
        .update({ task_id: null })
        .eq("id", input.itemId)
        .eq("task_id", task.id);
      await db.from("tasks").delete().eq("id", task.id);
      throw new Error(subError.message);
    }
  }

  return task.id as string;
}
