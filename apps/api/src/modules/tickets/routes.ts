import { type Request, type RequestHandler, Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { HttpError } from "../../lib/errors.js";
import { can, type PolicyActor } from "../../policy/index.js";
import type { Auth, AuthContext } from "../auth/index.js";
import { embedOrNull, ticketText, type Embeddings } from "../embeddings/index.js";
import {
  CATEGORIES,
  PRIORITIES,
  findTicket,
  insertComment,
  insertEvent,
  insertTicket,
  isActiveTechnician,
  listComments,
  listEvents,
  listTickets,
  updateTicket,
  type Queryable,
  type Ticket,
  type TicketChanges,
} from "./store.js";
import { STATUSES, checkTransition } from "./transitions.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["closed", "cancelled"]);

const text = (max: number) => z.string().trim().min(1).max(max);
const version = z.number().int().min(1);

const createSchema = z.object({ title: text(120), description: text(5000), category: z.enum(CATEGORIES) }).strict();
const requesterPatch = z.object({ version, title: text(120).optional(), description: text(5000).optional() }).strict();
const technicianPatch = z
  .object({ version, priority: z.enum(PRIORITIES).optional(), category: z.enum(CATEGORIES).optional(), assigneeId: z.string().regex(UUID).nullable().optional() })
  .strict();
const transitionSchema = z
  .object({ to: z.enum(STATUSES), comment: z.string().max(5000).optional(), resolutionNote: z.string().max(5000).optional(), assigneeId: z.string().regex(UUID).optional() })
  .strict();
const commentSchema = z.object({ body: text(5000) }).strict();
const listSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: z.enum(CATEGORIES).optional(),
    assigneeId: z.string().regex(UUID).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "Requisição inválida.");
  return result.data;
}

const actorOf = (res: { locals: Record<string, unknown> }): PolicyActor => (res.locals.auth as AuthContext).user;

function ticketId(req: Request): string {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new HttpError(404);
  return id;
}

// O cliente nunca recebe os ids internos duplicados (requesterId/assigneeId já estão em requester/assignee).
function present({ requesterId: _r, assigneeId: _a, ...ticket }: Ticket) {
  return ticket;
}

export interface TicketsDeps {
  pool: pg.Pool;
  auth: Auth;
  embeddings?: Embeddings;
}

export function createTicketsRouter({ pool, auth, embeddings }: TicketsDeps) {
  const router = Router();
  router.use(auth.requireAuth);
  const csrf: RequestHandler = auth.requireCsrf;

  async function inTransaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Chamado alheio e chamado inexistente são indistinguíveis (404).
  async function visible(db: Queryable, actor: PolicyActor, id: string, action: "ticket:read" | "ticket:comment" | "ticket:update", lock = false) {
    const ticket = await findTicket(db, actor, id, { lock });
    if (!ticket || !can(actor, action, ticket)) throw new HttpError(404);
    return ticket;
  }

  async function requireAssignee(db: Queryable, id: string) {
    if (!(await isActiveTechnician(db, id))) throw new HttpError(400, "Responsável deve ser um técnico ativo.");
  }

  router.post("/", csrf, async (req, res) => {
    const actor = actorOf(res);
    if (!can(actor, "ticket:create")) throw new HttpError(403, "Somente solicitantes abrem chamados.");
    const input = parse(createSchema, req.body);
    const ticket = await inTransaction(async (db) => {
      const id = await insertTicket(db, actor.id, input);
      await insertEvent(db, id, actor.id, { type: "created" });
      return visible(db, actor, id, "ticket:read");
    });
    res.status(201).json(present(ticket));
  });

  router.get("/", async (req, res) => {
    const { limit, cursor, ...filters } = parse(listSchema, req.query);
    const page = await listTickets(pool, actorOf(res), filters, limit, cursor ? decodeCursor(cursor) : undefined);
    res.json({
      // A listagem não leva a descrição: ela só vem no detalhe.
      items: page.items.map(({ description: _d, ...item }) => present(item as Ticket)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });

  router.get("/:id", async (req, res) => {
    res.json(present(await visible(pool, actorOf(res), ticketId(req), "ticket:read")));
  });

  router.patch("/:id", csrf, async (req, res) => {
    const actor = actorOf(res);
    const id = ticketId(req);
    const body = actor.role === "technician" ? parse(technicianPatch, req.body) : parse(requesterPatch, req.body);
    const { version: expected, ...fields } = body;
    if (Object.values(fields).every((value) => value === undefined)) throw new HttpError(400, "Nenhum campo para alterar.");

    const updated = await inTransaction(async (db) => {
      const ticket = await visible(db, actor, id, "ticket:update", true);
      if (TERMINAL.has(ticket.status)) throw new HttpError(422, "Chamado encerrado não pode ser alterado.");
      if (actor.role === "requester" && ticket.status !== "open") throw new HttpError(422, "O chamado só pode ser editado enquanto está aberto.");
      if (ticket.version !== expected) throw new HttpError(409, "O chamado foi alterado por outra pessoa. Recarregue e tente de novo.");

      const changes: TicketChanges = {};
      const events: Parameters<typeof insertEvent>[3][] = [];
      if ("title" in fields && fields.title !== undefined && fields.title !== ticket.title) changes.title = fields.title;
      if ("description" in fields && fields.description !== undefined && fields.description !== ticket.description) changes.description = fields.description;
      if (changes.title !== undefined || changes.description !== undefined) events.push({ type: "edited" });
      if ("priority" in fields && fields.priority !== undefined && fields.priority !== ticket.priority) {
        changes.priority = fields.priority;
        events.push({ type: "priority_changed", from: ticket.priority, to: fields.priority });
      }
      if ("category" in fields && fields.category !== undefined && fields.category !== ticket.category) {
        changes.category = fields.category;
        events.push({ type: "category_changed", from: ticket.category, to: fields.category });
      }
      if ("assigneeId" in fields && fields.assigneeId !== undefined && fields.assigneeId !== ticket.assigneeId) {
        if (fields.assigneeId !== null) await requireAssignee(db, fields.assigneeId);
        changes.assignee_id = fields.assigneeId;
        events.push({ type: "assignee_changed", from: ticket.assigneeId, to: fields.assigneeId ?? "" });
      }
      if (events.length === 0) return ticket;

      await updateTicket(db, id, changes);
      for (const event of events) await insertEvent(db, id, actor.id, event);
      return visible(db, actor, id, "ticket:read");
    });
    res.json(present(updated));
  });

  router.post("/:id/transitions", csrf, async (req, res) => {
    const actor = actorOf(res);
    const id = ticketId(req);
    const input = parse(transitionSchema, req.body);

    // Ao resolver, o vetor sai antes da transação (ADR-007). A checagem pura vem antes para que quem
    // não pode resolver não gaste chamadas ao modelo.
    const before = await visible(pool, actor, id, "ticket:read");
    const planned = checkTransition(actor, before, input);
    const vector = planned.ok && input.to === "resolved" ? await embedOrNull(embeddings, ticketText({ ...before, resolutionNote: planned.resolutionNote })) : null;

    const updated = await inTransaction(async (db) => {
      const ticket = await visible(db, actor, id, "ticket:read", true);
      const result = checkTransition(actor, ticket, input);
      if (!result.ok) throw new HttpError({ "not-allowed": 422, forbidden: 403, missing: 400 }[result.kind], result.detail);

      const changes: TicketChanges = { status: input.to };
      if (result.assigneeId !== undefined) {
        await requireAssignee(db, result.assigneeId);
        changes.assignee_id = result.assigneeId;
      }
      if (result.resolutionNote !== undefined) changes.resolution_note = result.resolutionNote;
      if (input.to === "resolved") {
        changes.resolved_at = new Date();
        // Se o chamado mudou entre a leitura e a transação, o vetor pode estar velho: fica sem, e o backfill refaz.
        const usable = ticket.version === before.version && vector;
        changes.embedding = usable ? vector.literal : null;
        changes.embedding_model = usable ? vector.model : null;
      }
      if (ticket.status === "resolved" && input.to === "in_progress") {
        changes.resolved_at = null;
        // Reabrir tira o chamado da busca: o banco recusa vetor em chamado que não está resolvido ou fechado (FR-15).
        changes.embedding = null;
        changes.embedding_model = null;
      }

      await updateTicket(db, id, changes);
      await insertEvent(db, id, actor.id, { type: "transitioned", from: ticket.status, to: input.to });
      if (result.assigneeId !== undefined && result.assigneeId !== ticket.assigneeId) {
        await insertEvent(db, id, actor.id, { type: "assignee_changed", from: ticket.assigneeId, to: result.assigneeId });
      }
      if (result.comment !== undefined) await insertComment(db, id, actor.id, result.comment);
      return visible(db, actor, id, "ticket:read");
    });
    res.json(present(updated));
  });

  router.get("/:id/comments", async (req, res) => {
    const id = ticketId(req);
    await visible(pool, actorOf(res), id, "ticket:read");
    res.json({ items: await listComments(pool, id) });
  });

  router.post("/:id/comments", csrf, async (req, res) => {
    const actor = actorOf(res);
    const id = ticketId(req);
    const { body } = parse(commentSchema, req.body);
    await visible(pool, actor, id, "ticket:comment");
    const commentId = await insertComment(pool, id, actor.id, body);
    const [comment] = await listComments(pool, id, commentId);
    res.status(201).json(comment);
  });

  router.get("/:id/events", async (req, res) => {
    const id = ticketId(req);
    await visible(pool, actorOf(res), id, "ticket:read");
    res.json({ items: await listEvents(pool, id) });
  });

  return router;
}
