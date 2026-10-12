import type { Role } from "./auth";

export type Status = "open" | "in_progress" | "waiting_requester" | "resolved" | "closed" | "cancelled";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Category = "hardware" | "software" | "network" | "access" | "other";

export interface Person {
  id: string;
  displayName: string;
}

// Lista e detalhe usam a mesma forma; a listagem não traz `description`.
export interface Ticket {
  id: string;
  title: string;
  description?: string;
  category: Category;
  priority: Priority;
  status: Status;
  requester: Person;
  assignee: Person | null;
  resolutionNote?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketComment {
  id: string;
  body: string;
  author: Person;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  type: "created" | "transitioned" | "assignee_changed" | "priority_changed" | "category_changed" | "edited";
  actor: Person;
  payload: { from?: string | null; to?: string };
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ArticleSummary {
  id: string;
  title: string;
  symptom: string;
  tags: string[];
  status: "draft" | "published";
  version: number;
}

export interface Article extends ArticleSummary {
  environment: string;
  procedure: string;
  expectedResult: string;
  author: Person;
  updatedAt: string;
}

export type SearchHit =
  | { kind: "article"; id: string; title: string; symptom: string; tags: string[]; score: number }
  | { kind: "ticket"; id: string; title: string; summary: string; score: number };

// `degraded`: a busca semântica está ligada no servidor mas não respondeu (FR-13).
export interface SearchResponse {
  mode: "vector" | "lexical";
  degraded: boolean;
  items: SearchHit[];
}

export type SearchStatus = { embeddings: { enabled: false } | { enabled: true; model: string; minScore: number; pending: { articles: number; tickets: number } } };

// Resposta de POST /tickets/:id/diagnosis (ADR-011). Não há score: o servidor não o envia.
export type DiagnosisSource =
  | { kind: "article"; id: string; title: string; symptom: string; tags: string[] }
  | { kind: "ticket"; id: string; title: string; summary: string };

export interface Diagnosis {
  runId: string;
  mode: "vector" | "lexical";
  degraded: boolean;
  abstained: boolean;
  evidence: "threshold" | "unverified" | null;
  // off: sem modelo (ou abstenção); ok: há resumo; unavailable: o modelo falhou e o resto segue valendo (FR-13).
  llm: "off" | "ok" | "unavailable";
  summary: { text: string; sourceIds: string[] } | null;
  sources: DiagnosisSource[];
  steps: { articleId: string; text: string }[];
}

// Laboratório (GET /eval/runs, FR-12). O formato do `result` é o que o runner de packages/evaluation grava.
export interface EvalCounts {
  n: number;
  hit1: number;
  hit5: number;
  mrr: number;
}

export interface EvalThreshold {
  threshold: number;
  abstainedUnanswerable: number;
  totalUnanswerable: number;
  lostAnswerable: number;
  totalAnswerable: number;
}

export interface EvalQueryRow {
  id: string;
  type: string;
  category: string;
  group: string | null;
  expected: string[];
  position: number | null;
  top5: string[];
  expectedInTop5: number;
  topScore: number;
}

export interface EvalEnvironment {
  date: string;
  commit: string;
  node: string;
  os: string;
  cpu: string;
  memoryGb: number;
}

export interface EvalResult {
  schemaVersion: number;
  set: "dev" | "test";
  datasetVersion: string;
  searchMode: "lexical" | "vector";
  embeddingModel: string | null;
  environment: EvalEnvironment;
  suite: {
    queryCount: number;
    degradedQueries: number;
    modes: Partial<Record<"lexical" | "vector", number>>;
    byType: Record<string, EvalCounts>;
    byCategory: Record<string, EvalCounts>;
    abstention: { calibration: EvalThreshold | null; validation: EvalThreshold | null; configured: EvalThreshold | null };
    rows: EvalQueryRow[];
  };
}

export interface EvalRun {
  id: string;
  createdAt: string;
  set: "dev" | "test";
  datasetVersion: string;
  searchMode: "lexical" | "vector";
  embeddingModel: string | null;
  llmModel: string | null;
  promptVersion: string | null;
  environment: EvalEnvironment;
  result: EvalResult;
}

export type { Role };
