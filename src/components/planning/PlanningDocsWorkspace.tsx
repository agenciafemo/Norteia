import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FilePenLine,
  Loader2,
  Plus,
  Save,
  ScrollText,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { GeneratedContentResult } from "@/components/content/GeneratedContentResult";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { generateClientContent, type GeneratedContent } from "@/lib/contentGeneration";
import { loadContentBase } from "@/lib/contentKnowledge";
import {
  createPlanningDocument,
  deletePlanningDocument,
  generatedContentToDocument,
  generatedScriptScenes,
  generatedStaticCopy,
  listPlanningDocuments,
  type PlanningContentDocument,
  type PlanningDocumentStatus,
  type PlanningDocumentType,
  updatePlanningDocument,
} from "@/lib/planningContentDocuments";
import { scenesSpokenText } from "@/lib/scriptScenes";
import { cn } from "@/lib/utils";

type PlanningPost = {
  id: string;
  content_type: string;
  position: number;
  caption?: string | null;
};

type Props = {
  organizationId: string;
  planningId: string;
  clientId: string;
  clientName: string;
  posts: PlanningPost[];
  onApplied?: () => void;
};

const POST_LABEL: Record<string, string> = {
  static: "Post",
  reels: "Reel",
  carousel: "Carrossel",
  story: "Story",
  blog: "Blog",
  linkedin: "LinkedIn",
};

function pieceLabel(post: PlanningPost, posts: PlanningPost[]) {
  const sameType = posts.filter((item) => item.content_type === post.content_type);
  return `#${POST_LABEL[post.content_type] ?? "Peça"}${sameType.findIndex((item) => item.id === post.id) + 1}`;
}

function generationError(error: Error) {
  if (error.message.includes("content_profile_required")) return "Complete o dossiê deste cliente antes de usar a IA.";
  if (error.message.includes("forbidden")) return "Seu perfil não possui permissão para gerar conteúdo.";
  return "Não foi possível gerar o rascunho agora.";
}

export function PlanningDocsWorkspace({
  organizationId,
  planningId,
  clientId,
  clientName,
  posts,
  onApplied,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanningContentDocument | null>(null);
  const [aiBrief, setAiBrief] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");

  const documentsQuery = useQuery({
    queryKey: ["planning-content-documents", planningId],
    queryFn: () => listPlanningDocuments(planningId),
  });
  const baseQuery = useQuery({
    queryKey: ["planning-docs-base", organizationId, clientId],
    queryFn: () => loadContentBase(organizationId, clientId),
  });

  useEffect(() => {
    if (!selectedId && documentsQuery.data?.length) setSelectedId(documentsQuery.data[0].id);
  }, [documentsQuery.data, selectedId]);

  useEffect(() => {
    const selected = documentsQuery.data?.find((document) => document.id === selectedId) ?? null;
    setDraft(selected ? { ...selected } : null);
    setAiBrief(selected?.title ?? "");
  }, [documentsQuery.data, selectedId]);

  const selectedPost = posts.find((post) => post.id === draft?.post_id) ?? null;
  const allowedPosts = useMemo(
    () => draft?.document_type === "script" ? posts.filter((post) => post.content_type === "reels") : posts,
    [draft?.document_type, posts],
  );
  const activeKnowledge = baseQuery.data?.items.filter((item) => item.status === "active").length ?? 0;
  const profileReady = Boolean(baseQuery.data?.profile.id);

  const createMutation = useMutation({
    mutationFn: async (type: PlanningDocumentType) => {
      const candidates = type === "script" ? posts.filter((post) => post.content_type === "reels") : posts;
      const post = candidates[0] ?? null;
      return createPlanningDocument({
        organizationId,
        planningId,
        clientId,
        postId: post?.id ?? null,
        type,
        title: type === "script" ? "Novo roteiro" : "Nova copy",
      });
    },
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["planning-content-documents", planningId] });
      setSelectedId(document.id);
      setOpen(true);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Selecione um documento.");
      return updatePlanningDocument(draft.id, {
        title: draft.title.trim() || (draft.document_type === "script" ? "Roteiro sem título" : "Copy sem título"),
        body: draft.body,
        post_id: draft.post_id,
        ai_content: draft.ai_content,
        status: draft.status,
      });
    },
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["planning-content-documents", planningId] });
      setDraft(document);
      toast.success("Documento salvo.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlanningDocument(draft!.id),
    onSuccess: async () => {
      setSelectedId(null);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["planning-content-documents", planningId] });
      toast.success("Documento removido.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Selecione um documento.");
      if (!aiBrief.trim()) throw new Error("Descreva o tema ou pedido para a IA.");
      if (!profileReady) throw new Error("content_profile_required");
      const format = draft.document_type === "script"
        ? "video_script"
        : selectedPost?.content_type === "carousel" ? "carousel" : "post";
      const existingDraft = draft.body.trim()
        ? `Use o texto abaixo como rascunho a melhorar, sem tratá-lo como fonte factual:\n---\n${draft.body.slice(0, 6_000)}\n---`
        : "";
      return generateClientContent({
        clientId,
        format,
        channel: "instagram",
        topic: aiBrief.trim(),
        objective: "Criar uma peça clara, persuasiva e coerente com a estratégia do cliente",
        extraInstructions: [aiInstructions.trim(), existingDraft].filter(Boolean).join("\n\n"),
        carouselSlides: 7,
        durationSeconds: 60,
      });
    },
    onSuccess: ({ content }) => {
      setDraft((current) => current ? {
        ...current,
        title: current.title.trim() ? current.title : content.title,
        body: generatedContentToDocument(content),
        ai_content: content,
      } : current);
      toast.success("Rascunho criado com o dossiê do cliente. Revise antes de aplicar.");
    },
    onError: (error: Error) => toast.error(generationError(error)),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!draft?.post_id || !draft.ai_content) throw new Error("Vincule uma peça e gere o conteúdo antes de aplicar.");
      const content = draft.ai_content;
      if (draft.document_type === "copy") {
        const payload = selectedPost?.content_type === "carousel"
          ? {
              carousel_copy: content.carousel_slides.map((slide) => slide.body.trim()),
              caption: content.caption,
              hashtags: content.hashtags.join(" "),
            }
          : {
              copy_text: generatedStaticCopy(content),
              caption: content.caption,
              hashtags: content.hashtags.join(" "),
            };
        const { error } = await supabase.from("posts").update(payload as never).eq("id", draft.post_id);
        if (error) throw error;
        return "Copy aplicada à peça. A etapa de Copy foi sincronizada na Produção.";
      }

      const scenes = generatedScriptScenes(content);
      if (!scenes.length) throw new Error("A IA não devolveu blocos de roteiro válidos.");
      const { data: existing, error: existingError } = await supabase
        .from("video_scripts")
        .select("id, completed_at")
        .eq("planning_id", planningId)
        .eq("post_id", draft.post_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;
      const payload = {
        title: content.title || draft.title,
        spoken_text: scenesSpokenText(scenes),
        scenes,
        post_id: draft.post_id,
        editing_instructions: "",
      };
      if (existing) {
        if (existing.completed_at) throw new Error("Este Reel já tem roteiro concluído. Reabra-o na seção Roteiros antes de substituir o texto.");
        const { error } = await supabase.from("video_scripts").update({
          ...payload,
          scenes: scenes as unknown as Json,
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data: scripts, error: positionsError } = await supabase
          .from("video_scripts").select("position").eq("planning_id", planningId);
        if (positionsError) throw positionsError;
        const position = Math.max(-1, ...(scripts ?? []).map((item: { position: number }) => item.position ?? 0)) + 1;
        const { error } = await supabase.from("video_scripts").insert({
          ...payload,
          organization_id: organizationId,
          planning_id: planningId,
          position,
          scenes: scenes as unknown as Json,
        });
        if (error) throw error;
      }
      return "Roteiro enviado como rascunho para a lauda. A conclusão continua sendo manual.";
    },
    onSuccess: async (message) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["posts", planningId] }),
        queryClient.invalidateQueries({ queryKey: ["video-scripts", planningId] }),
        queryClient.invalidateQueries({ queryKey: ["production-items"] }),
      ]);
      onApplied?.();
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateGeneratedContent = (content: GeneratedContent) => {
    setDraft((current) => current ? {
      ...current,
      ai_content: content,
      body: generatedContentToDocument(content),
    } : current);
  };

  return (
    <Card className="overflow-hidden border-brand/20 bg-card/90">
      <CardHeader className="cursor-pointer py-4" onClick={() => setOpen((value) => !value)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-brand-soft p-2 text-brand"><BookOpenText className="h-5 w-5" /></span>
            <div className="min-w-0">
              <CardTitle className="text-base">Docs e IA</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Copy e roteiro ligados às peças, com contexto do dossiê de {clientName}.</p>
            </div>
            <Badge variant="secondary">{documentsQuery.data?.length ?? 0}</Badge>
          </div>
          <Button variant="ghost" size="icon" aria-label={open ? "Recolher Docs" : "Abrir Docs"}>{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="border-t p-4 sm:p-5">
          <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => createMutation.mutate("copy")} disabled={createMutation.isPending}><Plus className="mr-1 h-3.5 w-3.5" />Copy</Button>
                <Button variant="outline" size="sm" onClick={() => createMutation.mutate("script")} disabled={createMutation.isPending}><Plus className="mr-1 h-3.5 w-3.5" />Roteiro</Button>
              </div>
              <div className="space-y-1.5">
                {(documentsQuery.data ?? []).map((document) => {
                  const post = posts.find((item) => item.id === document.post_id);
                  const Icon = document.document_type === "script" ? ScrollText : FilePenLine;
                  return (
                    <button key={document.id} type="button" onClick={() => setSelectedId(document.id)} className={cn("w-full rounded-xl border p-3 text-left transition-colors", selectedId === document.id ? "border-brand bg-brand-soft/40" : "border-border/70 hover:bg-muted/40")}>
                      <div className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-brand" /><span className="truncate text-sm font-semibold">{document.title || "Sem título"}</span></div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{post ? pieceLabel(post, posts) : "Sem peça vinculada"} · {document.status === "draft" ? "Rascunho" : document.status === "review" ? "Em revisão" : "Aprovado"}</p>
                    </button>
                  );
                })}
                {!documentsQuery.isLoading && documentsQuery.data?.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Crie o primeiro documento deste planejamento.</p>}
              </div>
            </aside>

            {draft ? (
              <div className="min-w-0 space-y-5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px_150px]">
                  <div className="space-y-1.5"><Label>Título interno</Label><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Peça do planejamento</Label><Select value={draft.post_id ?? "none"} onValueChange={(value) => setDraft({ ...draft, post_id: value === "none" ? null : value, ai_content: null })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem peça</SelectItem>{allowedPosts.map((post) => <SelectItem key={post.id} value={post.id}>{pieceLabel(post, posts)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1.5"><Label>Status editorial</Label><Select value={draft.status} onValueChange={(value: PlanningDocumentStatus) => setDraft({ ...draft, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Rascunho</SelectItem><SelectItem value="review">Em revisão</SelectItem><SelectItem value="approved">Aprovado</SelectItem></SelectContent></Select></div>
                </div>

                <div className="rounded-2xl border border-brand/20 bg-brand-soft/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div><div className="flex items-center gap-2"><WandSparkles className="h-4 w-4 text-brand" /><h3 className="text-sm font-semibold">Assistente de escrita</h3></div><p className="mt-1 text-xs text-muted-foreground">Lê no servidor o dossiê, {activeKnowledge} referências, {baseQuery.data?.claims.length ?? 0} claims e {baseQuery.data?.rules.length ?? 0} regras.</p></div>
                    <Badge variant={profileReady ? "secondary" : "destructive"}>{profileReady ? "Dossiê conectado" : "Dossiê incompleto"}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5"><Label>O que você quer escrever?</Label><Textarea rows={3} value={aiBrief} onChange={(event) => setAiBrief(event.target.value)} placeholder="Ex.: carrossel sobre prevenção, voltado para pacientes que adiam a consulta" /></div>
                    <div className="space-y-1.5"><Label>Orientações desta peça</Label><Textarea rows={3} value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} placeholder="Ex.: tom acolhedor, evitar jargão, CTA para salvar o post" /></div>
                  </div>
                  <Button className="mt-3" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !profileReady || !aiBrief.trim()}>{generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{draft.body.trim() ? "Melhorar com IA" : "Criar com IA"}</Button>
                </div>

                {draft.ai_content ? (
                  <GeneratedContentResult content={draft.ai_content} contextSummary={{ knowledge_items: activeKnowledge, claims: baseQuery.data?.claims.length ?? 0, compliance_rules: baseQuery.data?.rules.length ?? 0 }} onChange={updateGeneratedContent} onRegenerate={() => generateMutation.mutate()} />
                ) : (
                  <div className="space-y-1.5"><Label>Documento</Label><Textarea className="min-h-[360px] resize-y font-mono text-sm leading-6" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder={draft.document_type === "script" ? "Escreva o roteiro ou peça uma primeira versão à IA…" : "Escreva a copy ou peça uma primeira versão à IA…"} /></div>
                )}

                {draft.ai_content && (
                  <Alert className="border-brand/20"><CheckCircle2 className="h-4 w-4 text-brand" /><AlertTitle>Aplicação controlada</AlertTitle><AlertDescription>{draft.document_type === "script" ? "Enviar para Roteiros cria ou atualiza uma lauda em rascunho. O check da tarefa só acontece em Concluir roteiro." : "Aplicar na peça preenche copy, legenda e hashtags e sincroniza a etapa Copy na Produção."}</AlertDescription></Alert>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}><Trash2 className="mr-1.5 h-4 w-4" />Excluir</Button>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="mr-1.5 h-4 w-4" />Salvar documento</Button>
                    {draft.ai_content && <Button size="sm" onClick={() => applyMutation.mutate()} disabled={!draft.post_id || applyMutation.isPending}>{applyMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}{draft.document_type === "script" ? "Enviar para Roteiros" : "Aplicar na peça"}</Button>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed text-center"><BookOpenText className="h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">Escolha ou crie um documento</p><p className="mt-1 max-w-md text-sm text-muted-foreground">A copy e o roteiro permanecem ligados ao planejamento e à peça correta.</p></div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
