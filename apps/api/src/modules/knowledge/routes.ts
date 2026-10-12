import { type RequestHandler, Router, type Request } from "express";
import type pg from "pg";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { HttpError } from "../../lib/errors.js";
import { can, type PolicyActor } from "../../policy/index.js";
import type { Auth, AuthContext } from "../auth/index.js";
import { articleText, embedOrNull, pendingCounts, type Embeddings } from "../embeddings/index.js";
import type { Queryable } from "../tickets/store.js";
import { searchKnowledge } from "./search.js";
import { findArticle, insertArticle, listArticles, setTags, updateArticle, type Article } from "./store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG = /^[a-z0-9][a-z0-9._-]{0,29}$/;

const text = (max: number) => z.string().trim().min(1).max(max);
// Repetição é absorvida pelo banco (chave composta) e a ordem sai do array_agg.
const tags = z.array(z.string().trim().toLowerCase().regex(TAG)).max(10);
const version = z.number().int().min(1);

const fields = {
  title: text(160),
  symptom: text(5000),
  environment: text(2000),
  procedure: text(10000),
  expectedResult: text(2000),
};
const createSchema = z.object({ ...fields, tags }).strict();
const patchSchema = z
  .object({ version, title: fields.title.optional(), symptom: fields.symptom.optional(), environment: fields.environment.optional(), procedure: fields.procedure.optional(), expectedResult: fields.expectedResult.optional(), tags: tags.optional() })
  .strict();
const listSchema = z
  .object({ status: z.enum(["draft", "published"]).optional(), tag: z.string().regex(TAG).optional(), limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().max(200).optional() })
  .strict();
const searchSchema = z.object({ q: text(200), limit: z.coerce.number().int().min(1).max(20).default(10) }).strict();

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "Requisição inválida.");
  return result.data;
}

const actorOf = (res: { locals: Record<string, unknown> }): PolicyActor => (res.locals.auth as AuthContext).user;

function articleId(req: Request): string {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new HttpError(404);
  return id;
}

export interface KnowledgeDeps {
  pool: pg.Pool;
  auth: Auth;
  // Sem isto (ou com o Ollama fora do ar) tudo funciona só com a busca por palavras (FR-13).
  embeddings?: Embeddings;
}

export function createKnowledgeRouters({ pool, auth, embeddings }: KnowledgeDeps) {
  const csrf: RequestHandler = auth.requireCsrf;
  // Rotas de escrita: o papel é checado antes de olhar o artigo, então solicitante recebe 403 (FR-02).
  const technicianOnly: RequestHandler = (_req, res, next) => {
    if (!can(actorOf(res), "article:write")) throw new HttpError(403, "Somente técnicos alteram a base de conhecimento.");
    next();
  };

  async function inTransaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function visible(db: Queryable, actor: PolicyActor, id: string, lock = false): Promise<Article> {
    const article = await findArticle(db, actor, id, { lock });
    if (!article || !can(actor, "article:read", article)) throw new HttpError(404);
    return article;
  }

  const articles = Router();
  articles.use(auth.requireAuth);

  articles.post("/", csrf, technicianOnly, async (req, res) => {
    const actor = actorOf(res);
    const { tags: tagList, ...input } = parse(createSchema, req.body);
    const article = await inTransaction(async (db) => {
      const id = await insertArticle(db, actor.id, input);
      await setTags(db, id, tagList);
      return visible(db, actor, id);
    });
    res.status(201).json(article);
  });

  articles.get("/", async (req, res) => {
    const { limit, cursor, ...filters } = parse(listSchema, req.query);
    const page = await listArticles(pool, actorOf(res), filters, limit, cursor ? decodeCursor(cursor) : undefined);
    res.json({
      // A listagem não leva o procedimento: ele só vem no detalhe.
      items: page.items.map(({ procedure: _p, environment: _e, expectedResult: _r, ...item }) => item),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });

  articles.get("/:id", async (req, res) => {
    res.json(await visible(pool, actorOf(res), articleId(req)));
  });

  articles.patch("/:id", csrf, technicianOnly, async (req, res) => {
    const actor = actorOf(res);
    const id = articleId(req);
    const { version: expected, tags: tagList, ...changes } = parse(patchSchema, req.body);
    if (tagList === undefined && Object.values(changes).every((value) => value === undefined)) throw new HttpError(400, "Nenhum campo para alterar.");

    // O vetor sai antes da transação: chamada HTTP lenta dentro dela seguraria a conexão (ADR-007).
    const before = await visible(pool, actor, id);
    if (before.version !== expected) throw new HttpError(409, "O artigo foi alterado por outra pessoa. Recarregue e tente de novo.");
    const merged = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
    const textChanged = articleText(merged) !== articleText(before);
    // Publicado e com texto novo: o vetor antigo ficou velho, então é recalculado ou apagado.
    const vector = before.status === "published" && textChanged ? await embedOrNull(embeddings, articleText(merged)) : undefined;

    const updated = await inTransaction(async (db) => {
      const article = await visible(db, actor, id, true);
      if (article.version !== expected) throw new HttpError(409, "O artigo foi alterado por outra pessoa. Recarregue e tente de novo.");
      await updateArticle(db, id, {
        ...changes,
        ...(article.status === "published" && textChanged ? { embedding: vector?.literal ?? null, embedding_model: vector?.model ?? null } : {}),
      });
      if (tagList !== undefined) await setTags(db, id, tagList);
      return visible(db, actor, id);
    });
    res.json(updated);
  });

  for (const [action, from, to] of [["publish", "draft", "published"], ["unpublish", "published", "draft"]] as const) {
    articles.post(`/:id/${action}`, csrf, technicianOnly, async (req, res) => {
      const actor = actorOf(res);
      const id = articleId(req);
      const before = await visible(pool, actor, id);
      const vector = action === "publish" && before.status === "draft" ? await embedOrNull(embeddings, articleText(before)) : null;
      const updated = await inTransaction(async (db) => {
        const article = await visible(db, actor, id, true);
        if (article.status !== from) throw new HttpError(422, `O artigo já está ${article.status === "published" ? "publicado" : "em rascunho"}.`);
        if (action === "publish" && article.version !== before.version) throw new HttpError(409, "O artigo foi alterado por outra pessoa. Recarregue e tente de novo.");
        // Despublicar limpa o vetor no mesmo UPDATE (FR-15); o banco recusa vetor em rascunho.
        await updateArticle(db, id, { status: to, embedding: vector?.literal ?? null, embedding_model: vector?.model ?? null });
        return visible(db, actor, id);
      });
      res.json(updated);
    });
  }

  const search = Router();
  search.use(auth.requireAuth);
  search.get("/", async (req, res) => {
    const { q, limit } = parse(searchSchema, req.query);
    // `degraded`: a busca semântica está ligada mas não respondeu; a tela avisa (FR-13).
    res.json(await searchKnowledge(pool, embeddings, actorOf(res), q, limit));
  });

  search.get("/status", technicianOnly, async (_req, res) => {
    if (!embeddings) return void res.json({ embeddings: { enabled: false } });
    res.json({ embeddings: { enabled: true, model: embeddings.provider.model, minScore: embeddings.minScore, pending: await pendingCounts(pool, embeddings.provider.model) } });
  });

  return { articles, search };
}
