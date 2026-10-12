import type { Role } from "../auth/users.js";

export const STATUSES = ["open", "in_progress", "waiting_requester", "resolved", "closed", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export interface Actor {
  id: string;
  role: Role;
}

export interface TransitionTicket {
  status: Status;
  requesterId: string;
  assigneeId: string | null;
}

export interface TransitionInput {
  to: Status;
  comment?: string | undefined;
  resolutionNote?: string | undefined;
  assigneeId?: string | undefined;
}

type Who = "technician" | "owner" | "owner-or-technician";

// ARCHITECTURE §3, uma linha por aresta. Estado fora daqui não tem saída (closed, cancelled).
const EDGES: { from: Status; to: Status; who: Who; needs?: "comment" | "resolutionNote" }[] = [
  { from: "open", to: "in_progress", who: "technician" },
  { from: "open", to: "cancelled", who: "owner-or-technician" },
  { from: "in_progress", to: "waiting_requester", who: "technician", needs: "comment" },
  { from: "waiting_requester", to: "in_progress", who: "owner-or-technician" },
  { from: "in_progress", to: "resolved", who: "technician", needs: "resolutionNote" },
  { from: "resolved", to: "in_progress", who: "owner", needs: "comment" },
  { from: "resolved", to: "closed", who: "owner-or-technician" },
];

export type TransitionResult =
  | { ok: true; assigneeId?: string; comment?: string; resolutionNote?: string }
  | { ok: false; kind: "not-allowed" | "forbidden" | "missing"; detail: string };

export function checkTransition(actor: Actor, ticket: TransitionTicket, input: TransitionInput): TransitionResult {
  const edge = EDGES.find((e) => e.from === ticket.status && e.to === input.to);
  if (!edge) return { ok: false, kind: "not-allowed", detail: `Transição de ${ticket.status} para ${input.to} não é permitida.` };

  const isTechnician = actor.role === "technician";
  const isOwner = actor.role === "requester" && actor.id === ticket.requesterId;
  const allowed = edge.who === "technician" ? isTechnician : edge.who === "owner" ? isOwner : isOwner || isTechnician;
  if (!allowed) return { ok: false, kind: "forbidden", detail: "Seu perfil não pode fazer esta transição." };

  const comment = input.comment?.trim() || undefined;
  const resolutionNote = input.resolutionNote?.trim() || undefined;
  if (edge.needs === "comment" && !comment) return { ok: false, kind: "missing", detail: "Esta transição exige um comentário." };
  if (edge.needs === "resolutionNote" && !resolutionNote) return { ok: false, kind: "missing", detail: "Esta transição exige a nota de resolução." };

  return {
    ok: true,
    ...(edge.needs === "comment" && comment ? { comment } : {}),
    ...(edge.needs === "resolutionNote" && resolutionNote ? { resolutionNote } : {}),
    ...(ticket.status === "open" && input.to === "in_progress" ? { assigneeId: input.assigneeId ?? actor.id } : {}),
  };
}
