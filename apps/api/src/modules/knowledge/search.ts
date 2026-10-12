import type { PolicyActor } from "../../policy/index.js";
import { embedOrNull, type Embeddings } from "../embeddings/index.js";
import type { Queryable } from "../tickets/store.js";
import { search, type SearchHit } from "./store.js";

export interface SearchOutcome {
  mode: "vector" | "lexical";
  // A busca semântica está ligada mas não respondeu (FR-13).
  degraded: boolean;
  items: SearchHit[];
}

// Único caminho de busca: a rota GET /search e o diagnóstico usam o mesmo escopo e o mesmo fallback.
// `minScore` troca o corte do cosseno (0 = sem corte); ignorado na busca por palavras.
export async function searchKnowledge(
  db: Queryable,
  embeddings: Embeddings | undefined,
  actor: PolicyActor,
  q: string,
  limit: number,
  options: { minScore?: number } = {},
): Promise<SearchOutcome> {
  const vector = await embedOrNull(embeddings, q);
  const items = await search(db, actor, q, limit, vector && embeddings ? { literal: vector.literal, minScore: options.minScore ?? embeddings.minScore } : undefined);
  return { mode: vector ? "vector" : "lexical", degraded: embeddings !== undefined && !vector, items };
}
