import type { Cursor } from "../../lib/cursor.js";
import { SEARCHABLE_ARTICLES, scopeArticlesFor, type PolicyActor } from "../../policy/index.js";
import type { Queryable } from "../tickets/store.js";

export type ArticleStatus = "draft" | "published";

interface ArticleRow {
  id: string;
  title: string;
  symptom: string;
  environment: string;
  procedure: string;
  expected_result: string;
  status: ArticleStatus;
  version: number;
  author_id: string;
  author_name: string;
  tags: string[];
  created_at: string;
  created_cursor: string;
  updated_at: string;
}

export interface Article {
  id: string;
  title: string;
  symptom: string;
  environment: string;
  procedure: string;
  expectedResult: string;
  status: ArticleStatus;
  version: number;
  author: { id: string; displayName: string };
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const TAGS = `COALESCE((SELECT array_agg(g.name ORDER BY g.name)
                          FROM kb_article_tags x JOIN kb_tags g ON g.id = x.tag_id
                         WHERE x.article_id = a.id), '{}')`;

const SELECT = `
  SELECT a.id, a.title, a.symptom, a.environment, a.procedure, a.expected_result, a.status, a.version,
         a.author_id, u.display_name AS author_name, ${TAGS} AS tags,
         a.created_at, a.created_at::text AS created_cursor, a.updated_at
    FROM kb_articles a
    JOIN users u ON u.id = a.author_id`;

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    title: row.title,
    symptom: row.symptom,
    environment: row.environment,
    procedure: row.procedure,
    expectedResult: row.expected_result,
    status: row.status,
    version: row.version,
    author: { id: row.author_id, displayName: row.author_name },
    tags: row.tags,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// Pelo escopo da política: rascunho some da consulta para o solicitante e vira 404 na rota.
export async function findArticle(db: Queryable, actor: PolicyActor, id: string, options: { lock?: boolean } = {}): Promise<Article | null> {
  const { rows } = await db.query<ArticleRow>(`${SELECT} WHERE a.id = $1 AND ${scopeArticlesFor(actor)}${options.lock ? " FOR UPDATE OF a" : ""}`, [id]);
  return rows[0] ? toArticle(rows[0]) : null;
}

export async function listArticles(db: Queryable, actor: PolicyActor, filters: { status?: ArticleStatus | undefined; tag?: string | undefined }, limit: number, cursor?: Cursor) {
  const params: unknown[] = [];
  const where = [scopeArticlesFor(actor)];
  if (filters.status) {
    params.push(filters.status);
    where.push(`a.status = $${params.length}`);
  }
  if (filters.tag) {
    params.push(filters.tag);
    where.push(`EXISTS (SELECT 1 FROM kb_article_tags x JOIN kb_tags g ON g.id = x.tag_id WHERE x.article_id = a.id AND g.name = $${params.length})`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    where.push(`(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const { rows } = await db.query<ArticleRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map(toArticle), next: rows.length > limit && last ? { createdAt: last.created_cursor, id: last.id } : null };
}

export interface ArticleFields {
  title: string;
  symptom: string;
  environment: string;
  procedure: string;
  expectedResult: string;
}

export async function insertArticle(db: Queryable, authorId: string, input: ArticleFields): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO kb_articles (title, symptom, environment, procedure, expected_result, author_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [input.title, input.symptom, input.environment, input.procedure, input.expectedResult, authorId],
  );
  return rows[0]?.id as string;
}

// Nomes de coluna vêm do código; valores sempre por parâmetro.
const COLUMNS: Record<keyof ArticleFields, string> = {
  title: "title",
  symptom: "symptom",
  environment: "environment",
  procedure: "procedure",
  expectedResult: "expected_result",
};

export async function updateArticle(db: Queryable, id: string, changes: { [K in keyof ArticleFields]?: string | undefined } & { status?: ArticleStatus | undefined }): Promise<void> {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
  const sets = entries.map(([key], i) => `${key === "status" ? "status" : COLUMNS[key as keyof ArticleFields]} = $${i + 2}`);
  await db.query(`UPDATE kb_articles SET ${[...sets, "version = version + 1", "updated_at = now()"].join(", ")} WHERE id = $1`, [id, ...entries.map(([, value]) => value)]);
}

export async function setTags(db: Queryable, articleId: string, tags: string[]): Promise<void> {
  await db.query("DELETE FROM kb_article_tags WHERE article_id = $1", [articleId]);
  if (tags.length === 0) return;
  await db.query("INSERT INTO kb_tags (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING", [tags]);
  await db.query("INSERT INTO kb_article_tags (article_id, tag_id) SELECT $1, id FROM kb_tags WHERE name = ANY($2::text[])", [articleId, tags]);
}

export interface SearchHit {
  id: string;
  title: string;
  symptom: string;
  tags: string[];
  score: number;
}

// Baseline lexical (FR-07). O `plainto_tsquery` junta os termos com AND, o que zerava as
// paráfrases na Semana 0; aqui o AND vira OR e o ts_rank_cd ordena por quantos termos casam.
// O desempate por id deixa o resultado reproduzível.
export async function searchArticles(db: Queryable, q: string, limit: number): Promise<SearchHit[]> {
  const { rows } = await db.query<{ id: string; title: string; symptom: string; tags: string[]; score: number }>(
    `SELECT a.id, a.title, a.symptom, ${TAGS} AS tags, ts_rank_cd(a.search, query.q)::float8 AS score
       FROM kb_articles a,
            LATERAL (SELECT replace(plainto_tsquery('portuguese', f_unaccent($1))::text, ' & ', ' | ')::tsquery AS q) query
      WHERE ${SEARCHABLE_ARTICLES} AND a.search @@ query.q
      ORDER BY score DESC, a.id
      LIMIT $2`,
    [q, limit],
  );
  return rows;
}
