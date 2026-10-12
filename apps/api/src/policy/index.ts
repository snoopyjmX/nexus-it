import type { Role } from "../modules/auth/users.js";

export interface PolicyActor {
  id: string;
  role: Role;
}

export type TicketAction = "ticket:create" | "ticket:read" | "ticket:comment" | "ticket:update";

// Nega por padrão: ação desconhecida, ou ação sobre chamado sem informar o chamado, é falsa.
export function can(actor: PolicyActor, action: TicketAction, ticket?: { requesterId: string }): boolean {
  if (action === "ticket:create") return actor.role === "requester";
  if (action === "ticket:read" || action === "ticket:comment" || action === "ticket:update") {
    if (!ticket) return false;
    return actor.role === "technician" || (actor.role === "requester" && ticket.requesterId === actor.id);
  }
  return false;
}

// Filtro SQL para listagens e buscas. `index` é a posição do primeiro parâmetro ($n) livre na consulta.
export function scopeTicketsFor(actor: PolicyActor, index: number): { clause: string; params: string[] } {
  if (actor.role === "technician") return { clause: "TRUE", params: [] };
  return { clause: `t.requester_id = $${index}`, params: [actor.id] };
}
