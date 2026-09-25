// Camada de dados do WhatsApp fora do horário (leitura + vínculo de contato).
// Gravação de mensagem e criação de tarefa acontecem só no servidor.

import { supabase } from "@/integrations/supabase/client";
import { edgeReasonCode, invokeEdge } from "@/lib/edgeInvoke";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type WhatsAppConnection = {
  id: string;
  display_phone_number: string | null;
  is_test_number: boolean;
  status: "active" | "paused";
};

export type WhatsAppContact = {
  id: string;
  wa_id: string;
  profile_name: string | null;
  client_id: string | null;
  conversation_status: ConversationStatus;
  crm_stage: CrmStage;
  priority: ConversationPriority;
  assigned_to: string | null;
  tags: string[];
  next_follow_up_at: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type ConversationStatus = "novo" | "em_atendimento" | "aguardando_cliente" | "resolvido" | "arquivado";
export type ConversationPriority = "baixa" | "normal" | "alta" | "urgente";
export type CrmStage = "novo_contato" | "qualificacao" | "reuniao" | "proposta" | "cliente" | "perdido";

export type TeamAssignee = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  avatar_url: string | null;
};

export type WhatsAppContactNote = {
  id: string;
  contact_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type WhatsAppMessage = {
  id: string;
  direction: "recebida" | "enviada";
  message_type: string;
  body: string | null;
  sent_at: string;
  fora_do_horario: boolean;
  expires_at: string;
  summary_id: string | null;
  contact: WhatsAppContact | null;
};

export type WhatsAppSummary = {
  id: string;
  client_id: string | null;
  contact_label: string;
  period_start: string;
  period_end: string;
  message_count: number;
  summary: string;
  urgency: "baixa" | "media" | "alta";
  task_ids: string[];
  created_at: string;
  client: { name: string } | null;
};

export const URGENCIA: Record<WhatsAppSummary["urgency"], { label: string; variant: "neutral" | "warning" | "danger" }> = {
  baixa: { label: "Baixa", variant: "neutral" },
  media: { label: "Média", variant: "warning" },
  alta: { label: "Urgente", variant: "danger" },
};

export async function loadWhatsAppConnection(organizationId: string): Promise<WhatsAppConnection | null> {
  const { data, error } = await (supabase as AnyClient)
    .from("whatsapp_connections")
    .select("id, display_phone_number, is_test_number, status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WhatsAppConnection | null) ?? null;
}

export async function loadWhatsAppSummaries(organizationId: string): Promise<WhatsAppSummary[]> {
  const { data, error } = await (supabase as AnyClient)
    .from("whatsapp_summaries")
    .select("id, client_id, contact_label, period_start, period_end, message_count, summary, urgency, task_ids, created_at, client:clients(name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as WhatsAppSummary[];
}

export async function loadWhatsAppMessages(organizationId: string): Promise<WhatsAppMessage[]> {
  const { data, error } = await (supabase as AnyClient)
    .from("whatsapp_messages")
    .select("id, direction, message_type, body, sent_at, fora_do_horario, expires_at, summary_id, contact:whatsapp_contacts(id, wa_id, profile_name, client_id, conversation_status, crm_stage, priority, assigned_to, tags, next_follow_up_at, last_message_at, unread_count)")
    .eq("organization_id", organizationId)
    .order("sent_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as WhatsAppMessage[];
}

export async function loadWhatsAppContacts(organizationId: string): Promise<WhatsAppContact[]> {
  const { data, error } = await (supabase as AnyClient)
    .from("whatsapp_contacts")
    .select("id, wa_id, profile_name, client_id, conversation_status, crm_stage, priority, assigned_to, tags, next_follow_up_at, last_message_at, unread_count")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WhatsAppContact[];
}

export async function loadWhatsAppAssignees(organizationId: string): Promise<TeamAssignee[]> {
  const { data, error } = await (supabase as AnyClient).rpc("get_task_assignees", {
    _organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamAssignee[];
}

export async function updateWhatsAppContact(
  contactId: string,
  patch: Partial<Pick<WhatsAppContact,
    "client_id" | "conversation_status" | "crm_stage" | "priority" | "assigned_to" | "tags" | "next_follow_up_at"
  >>,
): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("whatsapp_contacts")
    .update(patch)
    .eq("id", contactId);
  if (error) throw new Error(error.message);
}

export async function markWhatsAppConversationRead(contactId: string): Promise<void> {
  const { error } = await (supabase as AnyClient).rpc("whatsapp_mark_conversation_read", {
    _contact_id: contactId,
  });
  if (error) throw new Error(error.message);
}

export async function loadWhatsAppContactNotes(contactId: string): Promise<WhatsAppContactNote[]> {
  const { data, error } = await (supabase as AnyClient)
    .from("whatsapp_contact_notes")
    .select("id, contact_id, author_id, body, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WhatsAppContactNote[];
}

export async function addWhatsAppContactNote(
  organizationId: string,
  contactId: string,
  body: string,
): Promise<void> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Sessão inválida.");
  const { error } = await (supabase as AnyClient).from("whatsapp_contact_notes").insert({
    organization_id: organizationId,
    contact_id: contactId,
    author_id: auth.user.id,
    body: body.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function linkContactToClient(contactId: string, clientId: string | null): Promise<void> {
  return updateWhatsAppContact(contactId, { client_id: clientId });
}

/** Resumos criados hoje (desde 0h no horário do navegador). */
export async function loadTodaySummaries(organizationId: string): Promise<Pick<WhatsAppSummary, "id" | "urgency">[]> {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const { data, error } = await (supabase as AnyClient)
    .from("whatsapp_summaries")
    .select("id, urgency")
    .eq("organization_id", organizationId)
    .gte("created_at", inicio.toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<WhatsAppSummary, "id" | "urgency">[];
}

export async function gerarResumoAgora(organizationId: string): Promise<{ resumos: number; tarefas: number; falhas: number }> {
  const { data, error } = await invokeEdge<{ resumos: number; tarefas: number; falhas: number }>(
    "whatsapp-resumo",
    { body: { organization_id: organizationId } },
  );
  if (error) {
    const code = await edgeReasonCode(error);
    throw new Error(
      code === "whatsapp_resumo_forbidden"
        ? "Você não tem permissão para gerar o resumo."
        : `Não foi possível gerar o resumo${code ? ` (${code})` : ""}.`,
    );
  }
  return data as { resumos: number; tarefas: number; falhas: number };
}

/** Dias inteiros até o texto ser apagado; 0 = apaga hoje. */
export function diasParaApagar(expiresAt: string, agora = Date.now()): number {
  const fim = new Date(expiresAt).getTime();
  if (!Number.isFinite(fim)) return 0;
  return Math.max(0, Math.ceil((fim - agora) / 86_400_000));
}

export function textoContador(dias: number): string {
  if (dias <= 0) return "apaga hoje";
  return dias === 1 ? "apaga em 1 dia" : `apaga em ${dias} dias`;
}

/** 5548999990000 -> +55 (48) 99999-0000. Outros países: +<número>. */
export function formatarTelefone(waId: string): string {
  const digitos = waId.replace(/\D+/g, "");
  const br = digitos.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (br) return `+55 (${br[1]}) ${br[2]}-${br[3]}`;
  return `+${digitos}`;
}
