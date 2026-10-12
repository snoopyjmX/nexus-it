import type pg from "pg";
import type { Cursor } from "../../lib/cursor.js";
import { scopeTicketsFor, type PolicyActor } from "../../policy/index.js";
import type { Status } from "./transitions.js";

export type Queryable = Pick<pg.PoolClient, "query">;

export const CATEGORIES = ["hardware", "software", "network", "access", "other"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];

interface TicketRow {
  id: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: Status;
  requester_id: string;
  requester_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  resolution_note: string | null;
  version: number;
  created_at: string;
  created_cursor: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: Status;
  requesterId: string;
  assigneeId: string | null;
  requester: { id: string; displayName: string };
  assignee: { id: string; displayName: string } | null;
  resolutionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

const SELECT = `
  SELECT t.id, t.title, t.description, t.category, t.priority, t.status, t.requester_id,
         r.display_name AS requester_name, t.assignee_id, a.display_name AS assignee_name,
         t.resolution_note, t.version, t.created_at, t.created_at::text AS created_cursor,
         t.updated_at, t.resolved_at
    FROM tickets t
    JOIN users r ON r.id = t.requester_id
    LEFT JOIN users a ON a.id = t.assignee_id`;

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    requesterId: row.requester_id,
    assigneeId: row.assignee_id,
    requester: { id: row.requester_id, displayName: row.requester_name },
    assignee: row.assignee_id && row.assignee_name ? { id: row.assignee_id, displayName: row.assignee_name } : null,
    resolutionNote: row.resolution_note,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

// Sempre pelo escopo da política: chamado alheio some da consulta, e vira 404 na rota.
export async function findTicket(db: Queryable, actor: PolicyActor, id: string, options: { lock?: boolean } = {}): Promise<Ticket | null> {
  const scope = scopeTicketsFor(actor, 2);
  const { rows } = await db.query<TicketRow>(`${SELECT} WHERE t.id = $1 AND ${scope.clause}${options.lock ? " FOR UPDATE OF t" : ""}`, [id, ...scope.params]);
  return rows[0] ? toTicket(rows[0]) : null;
}

export interface ListFilters {
  status?: Status | undefined;
  priority?: Priority | undefined;
  category?: Category | undefined;
  assigneeId?: string | undefined;
}

export async function listTickets(db: Queryable, actor: PolicyActor, filters: ListFilters, limit: number, cursor?: Cursor) {
  const scope = scopeTicketsFor(actor, 1);
  const params: unknown[] = [...scope.params];
  const where = [scope.clause];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (filters.status) add((n) => `t.status = $${n}`, filters.status);
  if (filters.priority) add((n) => `t.priority = $${n}`, filters.priority);
  if (filters.category) add((n) => `t.category = $${n}`, filters.category);
  if (filters.assigneeId) add((n) => `t.assignee_id = $${n}`, filters.assigneeId);
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    where.push(`(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const { rows } = await db.query<TicketRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toTicket),
    next: rows.length > limit && last ? { createdAt: last.created_cursor, id: last.id } : null,
  };
}

export async function insertTicket(db: Queryable, requesterId: string, input: { title: string; description: string; category: Category }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO tickets (title, description, category, requester_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [input.title, input.description, input.category, requesterId],
  );
  return rows[0]?.id as string;
}

// Colunas vêm do código (nunca do cliente); os valores sempre por parâmetro.
export type TicketChanges = Partial<{
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: Status;
  assignee_id: string | null;
  resolution_note: string;
  resolved_at: Date | null;
  embedding: string | null;
  embedding_model: string | null;
}>;

export async function updateTicket(db: Queryable, id: string, changes: TicketChanges): Promise<void> {
  const entries = Object.entries(changes);
  const sets = entries.map(([column], i) => `${column} = $${i + 2}${column === "embedding" ? "::vector" : ""}`);
  await db.query(`UPDATE tickets SET ${[...sets, "version = version + 1", "updated_at = now()"].join(", ")} WHERE id = $1`, [id, ...entries.map(([, value]) => value)]);
}

export async function isActiveTechnician(db: Queryable, userId: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM users WHERE id = $1 AND role = 'technician' AND active", [userId]);
  return rowCount === 1;
}

// Payload só com origem e destino: nenhum texto livre vai para o histórico.
export type TicketEvent =
  | { type: "created" | "edited" }
  | { type: "transitioned" | "assignee_changed" | "priority_changed" | "category_changed"; from: string | null; to: string };

export async function insertEvent(db: Queryable, ticketId: string, actorId: string, event: TicketEvent): Promise<void> {
  const payload = "from" in event ? { from: event.from, to: event.to } : {};
  await db.query("INSERT INTO ticket_events (ticket_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)", [ticketId, actorId, event.type, payload]);
}

export async function insertComment(db: Queryable, ticketId: string, authorId: string, body: string) {
  const { rows } = await db.query<{ id: string }>("INSERT INTO ticket_comments (ticket_id, author_id, body) VALUES ($1, $2, $3) RETURNING id", [ticketId, authorId, body]);
  return rows[0]?.id as string;
}

export async function listComments(db: Queryable, ticketId: string, onlyId?: string) {
  const { rows } = await db.query<{ id: string; body: string; created_at: string; author_id: string; display_name: string }>(
    `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.display_name
       FROM ticket_comments c JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
      ORDER BY c.created_at, c.id`,
    [ticketId, onlyId ?? null],
  );
  return rows.map((r) => ({ id: r.id, body: r.body, author: { id: r.author_id, displayName: r.display_name }, createdAt: new Date(r.created_at).toISOString() }));
}

export async function listEvents(db: Queryable, ticketId: string) {
  const { rows } = await db.query<{ id: string; event_type: string; payload: object; created_at: string; actor_id: string; display_name: string }>(
    `SELECT e.id, e.event_type, e.payload, e.created_at, u.id AS actor_id, u.display_name
       FROM ticket_events e JOIN users u ON u.id = e.actor_id
      WHERE e.ticket_id = $1 ORDER BY e.created_at, e.id`,
    [ticketId],
  );
  return rows.map((r) => ({ id: r.id, type: r.event_type, actor: { id: r.actor_id, displayName: r.display_name }, payload: r.payload, createdAt: new Date(r.created_at).toISOString() }));
}
