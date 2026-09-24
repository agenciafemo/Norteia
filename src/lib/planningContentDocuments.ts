import { supabase } from "@/integrations/supabase/client";
import type { GeneratedContent } from "@/lib/contentGeneration";
import { formatGeneratedContent } from "@/lib/contentGeneration";
import { newSceneId, type Scene } from "@/lib/scriptScenes";

export type PlanningDocumentType = "copy" | "script";
export type PlanningDocumentStatus = "draft" | "review" | "approved";

export type PlanningContentDocument = {
  id: string;
  organization_id: string;
  planning_id: string;
  client_id: string;
  post_id: string | null;
  document_type: PlanningDocumentType;
  title: string;
  body: string;
  ai_content: GeneratedContent | null;
  status: PlanningDocumentStatus;
  created_at: string;
  updated_at: string;
};

type QueryError = { message: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
interface QueryBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  insert(values: Record<string, unknown>): QueryBuilder<T>;
  update(values: Record<string, unknown>): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
  single(): PromiseLike<QueryResult<T>>;
}

// A migration desta feature pode chegar antes da geração automática dos tipos.
// O adaptador fica isolado aqui, sem contaminar os componentes.
const documentsDb = supabase as unknown as {
  from<T>(relation: string): QueryBuilder<T>;
};

export async function listPlanningDocuments(planningId: string) {
  const { data, error } = await documentsDb
    .from<PlanningContentDocument[]>("planning_content_documents")
    .select("*")
    .eq("planning_id", planningId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlanningContentDocument[];
}

export async function createPlanningDocument(input: {
  organizationId: string;
  planningId: string;
  clientId: string;
  postId: string | null;
  type: PlanningDocumentType;
  title: string;
}) {
  const { data, error } = await documentsDb
    .from<PlanningContentDocument>("planning_content_documents")
    .insert({
      organization_id: input.organizationId,
      planning_id: input.planningId,
      client_id: input.clientId,
      post_id: input.postId,
      document_type: input.type,
      title: input.title,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PlanningContentDocument;
}

export async function updatePlanningDocument(
  id: string,
  fields: Partial<Pick<PlanningContentDocument, "post_id" | "title" | "body" | "ai_content" | "status">>,
) {
  const { data, error } = await documentsDb
    .from<PlanningContentDocument>("planning_content_documents")
    .update(fields)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as PlanningContentDocument;
}

export async function deletePlanningDocument(id: string) {
  const { error } = await documentsDb.from<unknown>("planning_content_documents").delete().eq("id", id);
  if (error) throw error;
}

export function generatedContentToDocument(content: GeneratedContent) {
  return formatGeneratedContent(content);
}

export function generatedScriptScenes(content: GeneratedContent): Scene[] {
  return content.script_sections.map((block) => ({
    id: newSceneId(),
    speech: block.body.trim(),
    editing: block.visual_direction.trim(),
    seconds: null,
  })).filter((scene) => scene.speech || scene.editing);
}

export function generatedStaticCopy(content: GeneratedContent) {
  return [content.hook, content.cta].map((value) => value.trim()).filter(Boolean).join("\n\n");
}

