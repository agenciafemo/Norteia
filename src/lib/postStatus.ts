/**
 * Estado de um post do planejamento, com os mesmos nomes e as mesmas cores em
 * toda a aplicação.
 *
 * Vive aqui porque o quadro de Produção passou a mostrar o post que a peça
 * espelha: duas listas separadas de rótulos acabariam divergindo, e "Pendente"
 * no planejamento com outro nome na Produção faz a equipe achar que são
 * estados diferentes.
 */
export const POST_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending: "Pendente",
  approved: "Aprovado",
  needs_revision: "Em revisão",
};

// Cor significa estado da peça, nada mais: aprovado é o único verde, revisão
// é âmbar, o resto é neutro.
export const POST_STATUS_BADGE: Record<string, string> = {
  draft: "border-muted-foreground/20 bg-muted text-muted-foreground",
  pending: "border-muted-foreground/20 bg-muted text-muted-foreground",
  approved: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600",
  needs_revision: "border-amber-500/30 bg-amber-500/15 text-amber-600",
};

export function postStatusLabel(status: string | null | undefined): string {
  if (!status) return POST_STATUS_LABELS.draft;
  return POST_STATUS_LABELS[status] ?? status;
}

export function postStatusBadge(status: string | null | undefined): string {
  if (!status) return POST_STATUS_BADGE.draft;
  return POST_STATUS_BADGE[status] ?? POST_STATUS_BADGE.draft;
}
