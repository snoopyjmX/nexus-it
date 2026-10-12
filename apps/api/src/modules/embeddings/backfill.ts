import type pg from "pg";
import { articleText, pendingCounts, ticketText, toVectorLiteral } from "./index.js";
import type { EmbeddingProvider } from "./provider.js";

export interface BackfillResult {
  embedded: number;
  failed: number;
  remaining: { articles: number; tickets: number };
}

interface Row {
  id: string;
  title: string;
  symptom?: string;
  environment?: string;
  procedure?: string;
  expected_result?: string;
  description?: string;
  resolution_note?: string | null;
}

// Recalcula os vetores que faltam (Ollama estava fora do ar na hora de publicar/resolver) ou que
// são de outro modelo. Idempotente. O UPDATE repete o filtro de status: se o artigo foi
// despublicado no meio do caminho, o vetor não é gravado.
export async function backfill(pool: pg.Pool, provider: EmbeddingProvider, batchSize = 16): Promise<BackfillResult> {
  let embedded = 0;
  let failed = 0;

  const jobs = [
    {
      select: `SELECT id, title, symptom, environment, procedure, expected_result FROM kb_articles
                WHERE status = 'published' AND (embedding IS NULL OR embedding_model <> $1) ORDER BY id`,
      update: `UPDATE kb_articles SET embedding = $2::vector, embedding_model = $3 WHERE id = $1 AND status = 'published'`,
      text: (r: Row) => articleText({ title: r.title, symptom: r.symptom ?? "", environment: r.environment ?? "", procedure: r.procedure ?? "", expectedResult: r.expected_result ?? "" }),
    },
    {
      select: `SELECT id, title, description, resolution_note FROM tickets
                WHERE status IN ('resolved', 'closed') AND (embedding IS NULL OR embedding_model <> $1) ORDER BY id`,
      update: `UPDATE tickets SET embedding = $2::vector, embedding_model = $3 WHERE id = $1 AND status IN ('resolved', 'closed')`,
      text: (r: Row) => ticketText({ title: r.title, description: r.description, resolutionNote: r.resolution_note }),
    },
  ];

  for (const job of jobs) {
    const { rows } = await pool.query<Row>(job.select, [provider.model]);
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      try {
        const vectors = await provider.embed(batch.map(job.text));
        for (const [index, row] of batch.entries()) {
          const written = await pool.query(job.update, [row.id, toVectorLiteral(vectors[index] ?? []), provider.model]);
          embedded += written.rowCount ?? 0;
        }
      } catch {
        failed += batch.length;
      }
    }
  }
  return { embedded, failed, remaining: await pendingCounts(pool, provider.model) };
}
