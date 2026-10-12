import type { Logger } from "pino";
import type { Queryable } from "../tickets/store.js";
import type { EmbeddingProvider } from "./provider.js";

export interface Embeddings {
  provider: EmbeddingProvider;
  // Ponto de partida medido na Semana 0 (ADR-007); recalibrar na base real.
  minScore: number;
  logger: Logger;
}

export interface StoredVector {
  literal: string;
  model: string;
}

export const toVectorLiteral = (vector: number[]): string => `[${vector.join(",")}]`;

// Mesma composição de texto da Semana 0 (`textoCompleto`), para que o que foi medido valha aqui.
export const articleText = (a: { title: string; symptom: string; environment: string; procedure: string; expectedResult: string }): string =>
  [a.title, a.symptom, a.environment, a.procedure, a.expectedResult].filter(Boolean).join("\n");

export const ticketText = (t: { title: string; description?: string | undefined; resolutionNote?: string | null | undefined }): string =>
  [t.title, t.description, t.resolutionNote].filter(Boolean).join("\n");

// Nunca lança: indisponibilidade do modelo não pode derrubar publicar, resolver ou buscar (FR-13, ADR-007).
export async function embedOrNull(embeddings: Embeddings | undefined, text: string): Promise<StoredVector | null> {
  if (!embeddings) return null;
  try {
    const [vector] = await embeddings.provider.embed([text]);
    return vector ? { literal: toVectorLiteral(vector), model: embeddings.provider.model } : null;
  } catch (error) {
    embeddings.logger.warn({ err: error }, "embedding indisponível; seguindo sem vetor");
    return null;
  }
}

export interface PendingCounts {
  articles: number;
  tickets: number;
}

// Linhas pesquisáveis que ainda não têm vetor do modelo atual.
export async function pendingCounts(db: Queryable, model: string): Promise<PendingCounts> {
  const { rows } = await db.query<{ articles: string; tickets: string }>(
    `SELECT (SELECT count(*) FROM kb_articles WHERE status = 'published' AND (embedding IS NULL OR embedding_model <> $1)) AS articles,
            (SELECT count(*) FROM tickets WHERE status IN ('resolved', 'closed') AND (embedding IS NULL OR embedding_model <> $1)) AS tickets`,
    [model],
  );
  return { articles: Number(rows[0]?.articles), tickets: Number(rows[0]?.tickets) };
}
