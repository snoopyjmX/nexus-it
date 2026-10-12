import { Router } from "express";
import type pg from "pg";
import { HttpError } from "../../lib/errors.js";
import { can, type PolicyActor } from "../../policy/index.js";
import type { Auth, AuthContext } from "../auth/index.js";

const LIMIT = 50;

interface Row {
  id: string;
  created_at: Date;
  dataset_set: "dev" | "test";
  dataset_version: string;
  search_mode: "lexical" | "vector";
  embedding_model: string | null;
  llm_model: string | null;
  prompt_version: string | null;
  environment: unknown;
  result: unknown;
}

// Laboratório: só leitura (FR-12). Quem grava é o runner por CLI (packages/evaluation), nunca esta API.
export function createEvalRouter({ pool, auth }: { pool: pg.Pool; auth: Auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get("/runs", async (_req, res) => {
    const actor: PolicyActor = (res.locals.auth as AuthContext).user;
    if (!can(actor, "eval:read")) throw new HttpError(403, "Somente técnicos acessam o laboratório.");
    const { rows } = await pool.query<Row>(
      `SELECT id, created_at, dataset_set, dataset_version, search_mode, embedding_model, llm_model, prompt_version, environment, result
         FROM eval_runs ORDER BY created_at DESC, id DESC LIMIT $1`,
      [LIMIT],
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        set: row.dataset_set,
        datasetVersion: row.dataset_version,
        searchMode: row.search_mode,
        embeddingModel: row.embedding_model,
        llmModel: row.llm_model,
        promptVersion: row.prompt_version,
        environment: row.environment,
        result: row.result,
      })),
    });
  });

  return router;
}
