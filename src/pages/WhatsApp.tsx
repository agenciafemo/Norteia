import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, StatusBadge } from "@/components/common";
import { WhatsAppCRM } from "@/components/whatsapp/WhatsAppCRM";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import {
  formatarTelefone,
  gerarResumoAgora,
  linkContactToClient,
  loadWhatsAppConnection,
  loadWhatsAppAssignees,
  loadWhatsAppContacts,
  loadWhatsAppMessages,
  loadWhatsAppSummaries,
  URGENCIA,
} from "@/lib/whatsapp";

const SEM_CLIENTE = "__sem_cliente__";

const quando = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default function WhatsApp() {
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const podeEditar = role === "owner" || role === "admin" || role === "manager" || role === "editor";

  const conexao = useQuery({
    queryKey: ["whatsapp-connection", organizationId],
    queryFn: () => loadWhatsAppConnection(organizationId!),
    enabled: !!organizationId,
    retry: false,
  });
  const ativo = !!conexao.data;

  const resumos = useQuery({
    queryKey: ["whatsapp-summaries", organizationId],
    queryFn: () => loadWhatsAppSummaries(organizationId!),
    enabled: !!organizationId && ativo,
  });
  const mensagens = useQuery({
    queryKey: ["whatsapp-messages", organizationId],
    queryFn: () => loadWhatsAppMessages(organizationId!),
    enabled: !!organizationId && ativo,
    refetchInterval: 60_000,
  });
  const contatos = useQuery({
    queryKey: ["whatsapp-contacts", organizationId],
    queryFn: () => loadWhatsAppContacts(organizationId!),
    enabled: !!organizationId && ativo,
  });
  const responsaveis = useQuery({
    queryKey: ["whatsapp-assignees", organizationId],
    queryFn: () => loadWhatsAppAssignees(organizationId!),
    enabled: !!organizationId && ativo,
  });
  const clientes = useQuery({
    queryKey: ["whatsapp-clients", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!organizationId && ativo,
  });

  const atualizar = () => {
    for (const chave of ["whatsapp-summaries", "whatsapp-messages", "whatsapp-contacts", "whatsapp-today"]) {
      queryClient.invalidateQueries({ queryKey: [chave] });
    }
  };

  const gerar = useMutation({
    mutationFn: () => gerarResumoAgora(organizationId!),
    onSuccess: (resultado) => {
      if (resultado.resumos > 0) {
        toast.success(`${resultado.resumos} resumo(s) e ${resultado.tarefas} tarefa(s) criados.`);
      } else if (resultado.falhas > 0) {
        toast.error("Não foi possível resumir agora. As mensagens continuam pendentes.");
      } else {
        toast.info("Nada novo fora do horário para resumir.");
      }
      atualizar();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const vincular = useMutation({
    mutationFn: ({ contactId, clientId }: { contactId: string; clientId: string | null }) =>
      linkContactToClient(contactId, clientId),
    onSuccess: () => {
      toast.success("Contato atualizado.");
      atualizar();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pendentes = (mensagens.data ?? []).filter(
    (m) => m.fora_do_horario && !m.summary_id && m.direction === "recebida",
  ).length;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-brand" />
            <h1 className="text-2xl font-semibold tracking-tight">CRM e WhatsApp</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Centralize o atendimento, distribua conversas, acompanhe o funil e transforme mensagens em
            próximos passos. Fora do expediente, a IA continua resumindo demandas e criando tarefas.
          </p>
        </div>
        {ativo && podeEditar && (
          <Button onClick={() => gerar.mutate()} disabled={gerar.isPending}>
            {gerar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            Gerar resumo agora{pendentes > 0 ? ` (${pendentes})` : ""}
          </Button>
        )}
      </div>

      {conexao.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : conexao.isError ? (
        <EmptyState
          icon={MessageCircle}
          title="WhatsApp ainda não configurado neste ambiente"
          description="A migration do WhatsApp precisa ser aplicada antes. Passo a passo em docs/whatsapp-setup.md."
        />
      ) : !ativo ? (
        <EmptyState
          icon={MessageCircle}
          title="Nenhum número de WhatsApp conectado"
          description="Quando o número da agência estiver ligado ao Norteia, as mensagens fora do horário aparecem aqui. Passo a passo em docs/whatsapp-setup.md."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Número: <span className="font-medium text-foreground">{conexao.data?.display_phone_number ?? "—"}</span>
            </span>
            {conexao.data?.is_test_number && <StatusBadge variant="warning" size="sm">número de teste da Meta</StatusBadge>}
            {conexao.data?.status === "paused" && <StatusBadge variant="neutral" size="sm">pausado</StatusBadge>}
          </div>

          <Tabs defaultValue="atendimento">
            <TabsList>
              <TabsTrigger value="atendimento">Atendimento</TabsTrigger>
              <TabsTrigger value="funil">Funil CRM</TabsTrigger>
              <TabsTrigger value="resumos">Resumos</TabsTrigger>
              <TabsTrigger value="contatos">Contatos</TabsTrigger>
            </TabsList>

            <TabsContent value="atendimento" className="mt-4">
              <WhatsAppCRM
                organizationId={organizationId!}
                contacts={contatos.data ?? []}
                messages={mensagens.data ?? []}
                clients={clientes.data ?? []}
                assignees={responsaveis.data ?? []}
                canEdit={podeEditar}
                mode="inbox"
              />
            </TabsContent>

            <TabsContent value="funil" className="mt-4">
              <WhatsAppCRM
                organizationId={organizationId!}
                contacts={contatos.data ?? []}
                messages={mensagens.data ?? []}
                clients={clientes.data ?? []}
                assignees={responsaveis.data ?? []}
                canEdit={podeEditar}
                mode="pipeline"
              />
            </TabsContent>

            <TabsContent value="resumos" className="mt-4 space-y-3">
              {(resumos.data ?? []).length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="Nenhum resumo ainda"
                  description="O primeiro sai às 8h30 do próximo dia útil, se chegar mensagem fora do horário."
                />
              ) : (
                (resumos.data ?? []).map((resumo) => (
                  <article key={resumo.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {resumo.client?.name ?? resumo.contact_label}
                        {resumo.client?.name && (
                          <span className="ml-1.5 font-normal text-muted-foreground">· {resumo.contact_label}</span>
                        )}
                      </p>
                      <StatusBadge variant={URGENCIA[resumo.urgency].variant} size="sm">
                        {URGENCIA[resumo.urgency].label}
                      </StatusBadge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {resumo.message_count} mensagem(ns) · {quando.format(new Date(resumo.period_start))} a{" "}
                      {quando.format(new Date(resumo.period_end))}
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm">{resumo.summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      {resumo.task_ids.length > 0 ? (
                        <Button asChild size="sm" variant="outline">
                          <Link to={resumo.client_id ? `/tasks/cliente/${resumo.client_id}` : "/tasks"}>
                            {resumo.task_ids.length} tarefa(s) criada(s)
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">Sem tarefa — só informação ou já resolvido.</span>
                      )}
                    </div>
                  </article>
                ))
              )}
            </TabsContent>

            <TabsContent value="contatos" className="mt-4">
              {(contatos.data ?? []).length === 0 ? (
                <EmptyState icon={MessageCircle} title="Nenhum contato ainda" description="Cada número que mandar mensagem aparece aqui para ser ligado a um cliente." />
              ) : (
                <div className="divide-y rounded-2xl border border-border bg-card">
                  {(contatos.data ?? []).map((contato) => (
                    <div key={contato.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div>
                        <p className="text-sm font-medium">{contato.profile_name ?? "Sem nome no WhatsApp"}</p>
                        <p className="text-xs text-muted-foreground">{formatarTelefone(contato.wa_id)}</p>
                      </div>
                      <Select
                        value={contato.client_id ?? SEM_CLIENTE}
                        disabled={!podeEditar || vincular.isPending}
                        onValueChange={(valor) =>
                          vincular.mutate({ contactId: contato.id, clientId: valor === SEM_CLIENTE ? null : valor })
                        }
                      >
                        <SelectTrigger className="w-64">
                          <SelectValue placeholder="Ligar a um cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_CLIENTE}>Sem cliente</SelectItem>
                          {(clientes.data ?? []).map((cliente) => (
                            <SelectItem key={cliente.id} value={cliente.id}>{cliente.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Ligar o número a um cliente faz as próximas tarefas nascerem no quadro daquele cliente.
              </p>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
