import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, CheckCircle2, Search, StickyNote, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addWhatsAppContactNote,
  formatarTelefone,
  loadWhatsAppContactNotes,
  markWhatsAppConversationRead,
  updateWhatsAppContact,
  type ConversationPriority,
  type ConversationStatus,
  type CrmStage,
  type TeamAssignee,
  type WhatsAppContact,
  type WhatsAppMessage,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type ClientOption = { id: string; name: string };

type Props = {
  organizationId: string;
  contacts: WhatsAppContact[];
  messages: WhatsAppMessage[];
  clients: ClientOption[];
  assignees: TeamAssignee[];
  canEdit: boolean;
  mode: "inbox" | "pipeline";
};

const STATUS: { value: ConversationStatus; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando_cliente", label: "Aguardando cliente" },
  { value: "resolvido", label: "Resolvido" },
  { value: "arquivado", label: "Arquivado" },
];

const PRIORITY: { value: ConversationPriority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

const STAGES: { value: CrmStage; label: string }[] = [
  { value: "novo_contato", label: "Novos contatos" },
  { value: "qualificacao", label: "Qualificação" },
  { value: "reuniao", label: "Reunião" },
  { value: "proposta", label: "Proposta" },
  { value: "cliente", label: "Cliente" },
  { value: "perdido", label: "Perdido" },
];

const formatDateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function contactName(contact: WhatsAppContact, clientMap: Map<string, string>) {
  return (contact.client_id && clientMap.get(contact.client_id)) || contact.profile_name || formatarTelefone(contact.wa_id);
}

function priorityClass(priority: ConversationPriority) {
  if (priority === "urgente") return "text-red-400";
  if (priority === "alta") return "text-amber-400";
  return "text-muted-foreground";
}

export function WhatsAppCRM({
  organizationId,
  contacts,
  messages,
  clients,
  assignees,
  canEdit,
  mode,
}: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(contacts[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "abertas">("abertas");
  const [note, setNote] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const assigneeMap = useMemo(
    () => new Map(assignees.map((assignee) => [assignee.user_id, assignee.display_name])),
    [assignees],
  );
  const filteredContacts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return contacts.filter((contact) => {
      const statusMatches = statusFilter === "abertas"
        ? !["resolvido", "arquivado"].includes(contact.conversation_status)
        : contact.conversation_status === statusFilter;
      if (!statusMatches) return false;
      if (!term) return true;
      return [contactName(contact, clientMap), contact.profile_name, contact.wa_id, ...contact.tags]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term));
    });
  }, [clientMap, contacts, search, statusFilter]);

  useEffect(() => {
    if (!selectedId || !contacts.some((contact) => contact.id === selectedId)) {
      setSelectedId(contacts[0]?.id ?? null);
    }
  }, [contacts, selectedId]);

  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;
  const selectedMessages = useMemo(
    () => messages
      .filter((message) => message.contact?.id === selectedId)
      .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()),
    [messages, selectedId],
  );

  useEffect(() => {
    setTagsDraft(selected?.tags.join(", ") ?? "");
    if (!selected?.unread_count) return;
    void markWhatsAppConversationRead(selected.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-contacts", organizationId] });
    });
  }, [organizationId, queryClient, selected?.id, selected?.tags, selected?.unread_count]);

  const notes = useQuery({
    queryKey: ["whatsapp-contact-notes", selectedId],
    queryFn: () => loadWhatsAppContactNotes(selectedId!),
    enabled: !!selectedId,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateWhatsAppContact>[1] }) =>
      updateWhatsAppContact(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-contacts", organizationId] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const addNote = useMutation({
    mutationFn: () => addWhatsAppContactNote(organizationId, selectedId!, note),
    onSuccess: () => {
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-contact-notes", selectedId] });
      toast.success("Nota interna adicionada.");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (mode === "pipeline") {
    return (
      <div className="overflow-x-auto pb-3">
        <div className="grid min-w-[1180px] grid-cols-6 gap-3">
          {STAGES.map((stage) => {
            const stageContacts = contacts.filter((contact) => contact.crm_stage === stage.value);
            return (
              <section key={stage.value} className="rounded-2xl border border-border bg-muted/15 p-3">
                <header className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide">{stage.label}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{stageContacts.length}</span>
                </header>
                <div className="space-y-2">
                  {stageContacts.map((contact) => (
                    <article key={contact.id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{contactName(contact, clientMap)}</p>
                          <p className="truncate text-xs text-muted-foreground">{formatarTelefone(contact.wa_id)}</p>
                        </div>
                        {contact.unread_count > 0 && (
                          <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">
                            {contact.unread_count}
                          </span>
                        )}
                      </div>
                      <p className={cn("mt-2 text-xs", priorityClass(contact.priority))}>
                        {PRIORITY.find((item) => item.value === contact.priority)?.label}
                        {contact.assigned_to ? ` · ${assigneeMap.get(contact.assigned_to) ?? "Responsável"}` : " · Sem responsável"}
                      </p>
                      {canEdit && (
                        <Select
                          value={contact.crm_stage}
                          onValueChange={(value: CrmStage) => update.mutate({ id: contact.id, patch: { crm_stage: value } })}
                        >
                          <SelectTrigger className="mt-3 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STAGES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </article>
                  ))}
                  {stageContacts.length === 0 && (
                    <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Nenhum contato</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[300px_minmax(0,1fr)_300px]">
      <aside className="border-b border-border lg:border-b-0 lg:border-r">
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversa" className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ConversationStatus | "abertas")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="abertas">Conversas abertas</SelectItem>
              {STATUS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-[540px] overflow-y-auto">
          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => setSelectedId(contact.id)}
              className={cn(
                "w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/40",
                selectedId === contact.id && "bg-brand-soft/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-medium">{contactName(contact, clientMap)}</p>
                {contact.unread_count > 0 && (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-brand-foreground">{contact.unread_count}</span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {contact.last_message_at ? formatDateTime.format(new Date(contact.last_message_at)) : formatarTelefone(contact.wa_id)}
              </p>
              <p className={cn("mt-1 text-[11px]", priorityClass(contact.priority))}>
                {STATUS.find((item) => item.value === contact.conversation_status)?.label}
                {contact.assigned_to ? ` · ${assigneeMap.get(contact.assigned_to) ?? "Responsável"}` : ""}
              </p>
            </button>
          ))}
          {filteredContacts.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>}
        </div>
      </aside>

      <main className="flex min-h-[500px] flex-col border-b border-border lg:border-b-0 lg:border-r">
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{contactName(selected, clientMap)}</h2>
                <p className="text-xs text-muted-foreground">{formatarTelefone(selected.wa_id)}</p>
              </div>
              {canEdit && (
                <Select
                  value={selected.conversation_status}
                  onValueChange={(value: ConversationStatus) => update.mutate({ id: selected.id, patch: { conversation_status: value } })}
                >
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto bg-muted/10 p-4">
              {selectedMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[82%] rounded-2xl px-3 py-2 text-sm",
                    message.direction === "enviada" ? "ml-auto bg-brand text-brand-foreground" : "bg-muted",
                  )}
                >
                  <p className="whitespace-pre-line">{message.body ?? `[${message.message_type}]`}</p>
                  <p className={cn("mt-1 text-[10px]", message.direction === "enviada" ? "text-brand-foreground/70" : "text-muted-foreground")}>
                    {formatDateTime.format(new Date(message.sent_at))}
                  </p>
                </div>
              ))}
              {selectedMessages.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Ainda não há mensagens guardadas.</p>}
            </div>
            <div className="border-t border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
              A resposta pelo painel será ativada quando o token permanente do número oficial estiver disponível. O histórico recebido já pode ser organizado aqui.
            </div>
          </>
        ) : (
          <div className="m-auto text-center text-sm text-muted-foreground">Selecione uma conversa.</div>
        )}
      </main>

      <aside className="max-h-[620px] space-y-4 overflow-y-auto p-4">
        {selected && (
          <>
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"><UserRound className="h-3.5 w-3.5" /> Organização</h3>
              <div className="space-y-2">
                <Select
                  value={selected.assigned_to ?? "__none__"}
                  disabled={!canEdit}
                  onValueChange={(value) => update.mutate({ id: selected.id, patch: { assigned_to: value === "__none__" ? null : value } })}
                >
                  <SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem responsável</SelectItem>
                    {assignees.map((assignee) => <SelectItem key={assignee.user_id} value={assignee.user_id}>{assignee.display_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={selected.priority}
                  disabled={!canEdit}
                  onValueChange={(value: ConversationPriority) => update.mutate({ id: selected.id, patch: { priority: value } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITY.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select
                  value={selected.client_id ?? "__none__"}
                  disabled={!canEdit}
                  onValueChange={(value) => update.mutate({ id: selected.id, patch: { client_id: value === "__none__" ? null : value } })}
                >
                  <SelectTrigger><SelectValue placeholder="Vincular cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem cliente</SelectItem>
                    {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={selected.crm_stage}
                  disabled={!canEdit}
                  onValueChange={(value: CrmStage) => update.mutate({ id: selected.id, patch: { crm_stage: value } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"><CalendarClock className="h-3.5 w-3.5" /> Próximo retorno</h3>
              <Input
                type="datetime-local"
                disabled={!canEdit}
                value={selected.next_follow_up_at ? selected.next_follow_up_at.slice(0, 16) : ""}
                onChange={(event) => update.mutate({
                  id: selected.id,
                  patch: { next_follow_up_at: event.target.value ? new Date(event.target.value).toISOString() : null },
                })}
              />
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">Etiquetas</h3>
              <Input
                value={tagsDraft}
                disabled={!canEdit}
                onChange={(event) => setTagsDraft(event.target.value)}
                onBlur={() => {
                  const tags = tagsDraft.split(",").map((tag) => tag.trim()).filter(Boolean);
                  if (JSON.stringify(tags) !== JSON.stringify(selected.tags)) update.mutate({ id: selected.id, patch: { tags } });
                }}
                placeholder="lead, indicação, urgente"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Separe com vírgulas.</p>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"><StickyNote className="h-3.5 w-3.5" /> Notas internas</h3>
              {canEdit && (
                <div className="space-y-2">
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Contexto que só a equipe vê…" rows={3} />
                  <Button size="sm" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>Adicionar nota</Button>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {(notes.data ?? []).map((item) => (
                  <div key={item.id} className="rounded-xl bg-muted/50 p-2.5">
                    <p className="whitespace-pre-line text-xs">{item.body}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime.format(new Date(item.created_at))}</p>
                  </div>
                ))}
              </div>
            </section>

            {selected.priority === "urgente" ? (
              <p className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-300"><AlertCircle className="h-4 w-4" /> Atendimento urgente</p>
            ) : selected.conversation_status === "resolvido" ? (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Conversa resolvida</p>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}
