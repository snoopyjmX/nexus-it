import type { SearchOutcome } from "../knowledge/search.js";
import type { SearchHit } from "../knowledge/store.js";
import { extractSteps } from "./steps.js";

// Limites de projeto (ADR-011): arbitrários dentro de um teto, para reavaliar com uso real.
export const QUERY_MAX = 300;
export const SOURCES_MAX = 5;
export const STEP_SOURCES_MAX = 3;
export const STEPS_PER_ARTICLE_MAX = 20;

// O limiar da Semana 0 foi medido em consultas curtas; por isso o corte de tamanho.
export function buildQuery(ticket: { title: string; description: string }): string {
  return `${ticket.title} ${ticket.description}`.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}

// O score serve para ordenar e filtrar no servidor e nunca sai daqui (ADR-011, FR-10).
export type Source =
  | { kind: "article"; id: string; title: string; symptom: string; tags: string[] }
  | { kind: "ticket"; id: string; title: string; summary: string };

export interface Step {
  articleId: string;
  text: string;
}

export function toSources(items: SearchHit[], ticketId: string): Source[] {
  return items
    .filter((hit) => !(hit.kind === "ticket" && hit.id === ticketId))
    .slice(0, SOURCES_MAX)
    .map(({ score: _score, ...source }) => source);
}

export function articleIdsForSteps(sources: Source[]): string[] {
  return sources.filter((source) => source.kind === "article").slice(0, STEP_SOURCES_MAX).map((source) => source.id);
}

export function toSteps(ids: string[], procedures: Map<string, string>): Step[] {
  return ids.flatMap((articleId) => extractSteps(procedures.get(articleId) ?? "").slice(0, STEPS_PER_ARTICLE_MAX).map((text) => ({ articleId, text })));
}

// FR-10: com busca vetorial e limiar confiável, o corte já veio da consulta ("threshold"). Sem limiar aplicado
// (busca por palavras ou limiar marcado como não confiável), as fontes saem como "unverified". Sem fonte, abstém.
export function evidenceFor(outcome: Pick<SearchOutcome, "mode">, sources: Source[], thresholdTrusted: boolean): "threshold" | "unverified" | null {
  if (sources.length === 0) return null;
  return outcome.mode === "vector" && thresholdTrusted ? "threshold" : "unverified";
}
