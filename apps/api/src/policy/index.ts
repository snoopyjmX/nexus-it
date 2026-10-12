import type { Role } from "../modules/auth/users.js";

export interface PolicyActor {
  id: string;
  role: Role;
}

export type TicketAction = "ticket:create" | "ticket:read" | "ticket:comment" | "ticket:update";
export type ArticleAction = "article:read" | "article:write";
export type Action = TicketAction | ArticleAction;

type Resource = { requesterId: string } | { status: "draft" | "published" };

// Nega por padrão: ação desconhecida, ou ação sobre recurso sem informar o recurso, é falsa.
export function can(actor: PolicyActor, action: Action, resource?: Resource): boolean {
  switch (action) {
    case "ticket:create":
      return actor.role === "requester";
    case "ticket:read":
    case "ticket:comment":
    case "ticket:update":
      if (!resource || !("requesterId" in resource)) return false;
      return actor.role === "technician" || (actor.role === "requester" && resource.requesterId === actor.id);
    case "article:write":
      return actor.role === "technician";
    case "article:read":
      if (!resource || !("status" in resource)) return false;
      return actor.role === "technician" || resource.status === "published";
    default:
      return false;
  }
}

// Filtro SQL para listagens e buscas. `index` é a posição do primeiro parâmetro ($n) livre na consulta.
export function scopeTicketsFor(actor: PolicyActor, index: number): { clause: string; params: string[] } {
  if (actor.role === "technician") return { clause: "TRUE", params: [] };
  return { clause: `t.requester_id = $${index}`, params: [actor.id] };
}

// Listagem de artigos: técnico enxerga rascunhos para gerir a base, solicitante não.
export function scopeArticlesFor(actor: PolicyActor): string {
  return actor.role === "technician" ? "TRUE" : "a.status = 'published'";
}

// Busca e contexto de diagnóstico só veem o que está publicado, para qualquer papel
// (matriz de visibilidade, ARCHITECTURE §5; FR-15).
export const SEARCHABLE_ARTICLES = "a.status = 'published'";

// Chamados só entram na busca (e no contexto do diagnóstico) depois de resolvidos; reabrir tira da busca.
export const SEARCHABLE_TICKET_STATUSES = "t.status IN ('resolved', 'closed')";
