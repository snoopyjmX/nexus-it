import { type Request, type RequestHandler, Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { HttpError } from "../../lib/errors.js";
import { createRateLimiter } from "../../lib/rate-limit.js";
import { can, type PolicyActor } from "../../policy/index.js";
import type { Auth, AuthContext } from "../auth/index.js";
import type { Embeddings } from "../embeddings/index.js";
import { searchKnowledge } from "../knowledge/search.js";
import { findTicket } from "../tickets/store.js";
import { SOURCES_MAX, articleIdsForSteps, buildQuery, evidenceFor, toSources, toSteps } from "./service.js";
import { articleProcedures, insertRun, setFeedback } from "./store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noBody = z.object({}).strict();
const feedbackSchema = z.object({ useful: z.boolean(), correction: z.string().trim().min(1).max(1000).optional() }).strict();

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "Requisição inválida.");
  return result.data;
}

const actorOf = (res: { locals: Record<string, unknown> }): PolicyActor => (res.locals.auth as AuthContext).user;

function uuidParam(req: Request): string {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new HttpError(404);
  return id;
}

export interface DiagnosisDeps {
  pool: pg.Pool;
  auth: Auth;
  embeddings?: Embeddings;
  // Padrão true (ADR-011). false força "evidência não verificada" mesmo com busca vetorial (FR-10).
  thresholdTrusted?: boolean;
  limits?: { max: number; windowMs: number };
}

// Monta as rotas direto em /api/v1 (o diagnóstico mora em /tickets/:id e em /diagnosis-runs), por isso a
// autenticação é por rota, e não um router.use que alcançaria também /health.
export function createDiagnosisRouter({ pool, auth, embeddings, thresholdTrusted = true, limits = { max: 10, windowMs: 60_000 } }: DiagnosisDeps) {
  const router = Router();
  const csrf: RequestHandler = auth.requireCsrf;
  const limiter = createRateLimiter(limits);
  // Um diagnóstico por vez por usuário (T-04). Em memória: vale por processo (ADR-009, ADR-011).
  const running = new Set<string>();

  router.post("/tickets/:id/diagnosis", auth.requireAuth, csrf, async (req, res) => {
    const actor = actorOf(res);
    if (!can(actor, "diagnosis:run")) throw new HttpError(403, "Somente técnicos pedem diagnóstico.");
    parse(noBody, req.body ?? {});
    const ticket = await findTicket(pool, actor, uuidParam(req));
    if (!ticket) throw new HttpError(404);

    if (running.has(actor.id)) throw new HttpError(429, "Já há um diagnóstico em andamento.");
    const retryAfter = limiter.retryAfter(actor.id);
    if (retryAfter !== null) throw new HttpError(429, "Muitos diagnósticos em pouco tempo. Tente de novo em instantes.", { "Retry-After": String(retryAfter) });
    limiter.record(actor.id);
    running.add(actor.id);

    try {
      const started = performance.now();
      const outcome = await searchKnowledge(pool, embeddings, actor, buildQuery(ticket), SOURCES_MAX + 1, thresholdTrusted ? {} : { minScore: 0 });
      const sources = toSources(outcome.items, ticket.id);
      const evidence = evidenceFor(outcome, sources, thresholdTrusted);
      const stepSources = articleIdsForSteps(sources);
      const steps = toSteps(stepSources, await articleProcedures(pool, stepSources));
      const runId = await insertRun(pool, {
        ticketId: ticket.id,
        userId: actor.id,
        searchMode: outcome.mode,
        degraded: outcome.degraded,
        retrieved: sources.map(({ kind, id }) => ({ kind, id })),
        abstained: evidence === null,
        evidence,
        durationMs: Math.round(performance.now() - started),
      });
      res.status(201).json({ runId, mode: outcome.mode, degraded: outcome.degraded, abstained: evidence === null, evidence, sources, steps });
    } finally {
      running.delete(actor.id);
    }
  });

  router.post("/diagnosis-runs/:id/feedback", auth.requireAuth, csrf, async (req, res) => {
    if (!can(actorOf(res), "diagnosis:feedback")) throw new HttpError(403, "Somente técnicos avaliam o diagnóstico.");
    const id = uuidParam(req);
    const { useful, correction } = parse(feedbackSchema, req.body);
    const saved = await setFeedback(pool, id, { useful, correction: correction ?? null });
    if (!saved) throw new HttpError(404);
    res.json(saved);
  });

  return router;
}
