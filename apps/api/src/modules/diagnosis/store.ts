import { SEARCHABLE_ARTICLES } from "../../policy/index.js";
import type { Queryable } from "../tickets/store.js";

export interface RunRecord {
  ticketId: string;
  userId: string;
  searchMode: "vector" | "lexical";
  degraded: boolean;
  retrieved: { kind: "article" | "ticket"; id: string }[];
  abstained: boolean;
  evidence: "threshold" | "unverified" | null;
  durationMs: number;
}

// Só ids e desfecho: o texto do chamado e das fontes nunca vai para esta tabela (ADR-011).
export async function insertRun(db: Queryable, run: RunRecord): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ai_runs (ticket_id, user_id, mode, search_mode, degraded, retrieved, abstained, evidence, duration_ms)
     VALUES ($1, $2, 'deterministic', $3, $4, $5::jsonb, $6, $7, $8) RETURNING id`,
    [run.ticketId, run.userId, run.searchMode, run.degraded, JSON.stringify(run.retrieved), run.abstained, run.evidence, run.durationMs],
  );
  return rows[0]?.id as string;
}

// O filtro de publicação fica na própria consulta: artigo despublicado entre a busca e esta leitura não gera passos (T-15).
export async function articleProcedures(db: Queryable, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; procedure: string }>(`SELECT a.id, a.procedure FROM kb_articles a WHERE a.id = ANY($1::uuid[]) AND ${SEARCHABLE_ARTICLES}`, [ids]);
  return new Map(rows.map((row) => [row.id, row.procedure]));
}

export interface Feedback {
  useful: boolean;
  correction: string | null;
}

// O feedback só grava na execução: não toca em artigo nem em chamado (FR-11). Devolve null se a execução não existe.
export async function setFeedback(db: Queryable, runId: string, feedback: Feedback): Promise<Feedback | null> {
  const { rows } = await db.query<{ feedback_useful: boolean; feedback_note: string | null }>(
    "UPDATE ai_runs SET feedback_useful = $2, feedback_note = $3, feedback_at = now() WHERE id = $1 RETURNING feedback_useful, feedback_note",
    [runId, feedback.useful, feedback.correction],
  );
  return rows[0] ? { useful: rows[0].feedback_useful, correction: rows[0].feedback_note } : null;
}
