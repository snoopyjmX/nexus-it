import { z } from "zod";

// bge-m3 (ADR-007). Dimensão fixa: trocar de modelo exige recalcular tudo e um ADR novo.
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

// Formato conferido em docs.ollama.com/api/embed (Semana 0, 2026-10-10).
const response = z.object({ embeddings: z.array(z.array(z.number())) });

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function createOllamaProvider({ baseUrl, model, timeoutMs }: OllamaOptions): EmbeddingProvider {
  return {
    model,
    async embed(texts) {
      const res = await fetch(new URL("/api/embed", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts, truncate: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Ollama /api/embed respondeu ${res.status}`);
      const { embeddings } = response.parse(await res.json());
      if (embeddings.length !== texts.length) throw new Error("Ollama devolveu número de vetores diferente do enviado");
      if (embeddings.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) throw new Error(`Vetor com dimensão diferente de ${EMBEDDING_DIMENSIONS}`);
      return embeddings;
    },
  };
}
