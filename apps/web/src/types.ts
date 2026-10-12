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
  sources: DiagnosisSource[];
  steps: { articleId: string; text: string }[];
}

export type { Role };
