import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createPasswordHasher } from "../../../apps/api/src/modules/auth/password.js";
import { createUser } from "../../../apps/api/src/modules/auth/users.js";
import { backfill } from "../../../apps/api/src/modules/embeddings/backfill.js";
import type { Embeddings } from "../../../apps/api/src/modules/embeddings/index.js";
import { articleIdsForSteps, evidenceFor, SOURCES_MAX, toSources, toSteps, type Source } from "../../../apps/api/src/modules/diagnosis/service.js";
import { articleProcedures } from "../../../apps/api/src/modules/diagnosis/store.js";
import { PROMPT_VERSION, summarize, type SummaryProvider } from "../../../apps/api/src/modules/diagnosis/summary.js";
import { insertArticle, updateArticle } from "../../../apps/api/src/modules/knowledge/store.js";
import { searchKnowledge } from "../../../apps/api/src/modules/knowledge/search.js";
import { migrate } from "../../../apps/api/src/db/migrate.js";
import { insertTicket, updateTicket, type Category } from "../../../apps/api/src/modules/tickets/store.js";
import type { Dataset, EvalDocument } from "./dataset.js";
import { runGeneration, type GenerationCase, type PreparedCase } from "./generation.js";
import { environmentInfo, RESULT_SCHEMA_VERSION, type EvalResult } from "./result.js";
import { runSuite, type SearchFn } from "./suite.js";

// Categorias do corpus → categorias de chamado do app. A categoria não entra na busca; serve só para o chamado ser válido.
const TICKET_CATEGORY: Record<string, Category> = { vpn: "network", rede: "network", impressora: "hardware", email: "software", acesso: "access", estacao: "hardware" };

const SEARCH_LIMIT = 20;

export interface RunOptions {
  databaseUrl: string;
  dataset: Dataset;
  set: "dev" | "test";
  // Com embeddings roda também o modo vetorial; sem eles, só o lexical.
  embeddings?: Embeddings;
  nodeEnv?: string;
  // Mede também o resumo do modelo (ADR-008), no modo de busca que o app usaria: vetorial com embeddings, senão lexical.
  generation?: { provider: SummaryProvider; cases: GenerationCase[]; casesVersion: string; rounds: number };
}

function requireField(doc: EvalDocument, field: "ambiente" | "resultado"): string {
  if (doc[field]) return doc[field];
  throw new Error(`Documento ${doc.id}: o campo "${field}" está vazio e o artigo do app exige texto. Corrija o conjunto de dados; o runner não inventa conteúdo.`);
}

// Os empates de score são desfeitos pelo id da linha (ORDER BY score DESC, id). Com uuid aleatório o ranking mudaria
// a cada execução; derivando o id do id do corpus o resultado fica reproduzível.
function stableUuid(corpusId: string): string {
  const hex = createHash("sha256").update(`nexus-eval:${corpusId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Os mesmos campos que a Semana 0 indexou, repartidos nas colunas do app. Artigo publicado e chamado resolvido
// são as únicas fontes pesquisáveis (FR-15), então é assim que o corpus precisa entrar.
// Nome de tabela vem do código acima, nunca do conjunto de dados. Ainda não há linhas filhas (tags, eventos).
async function fixId(pool: pg.Pool, table: "kb_articles" | "tickets", id: string, corpusId: string): Promise<string> {
  const stable = stableUuid(corpusId);
  await pool.query(`UPDATE ${table} SET id = $2 WHERE id = $1`, [id, stable]);
  return stable;
}

async function seedCorpus(pool: pg.Pool, documents: EvalDocument[]): Promise<Map<string, string>> {
  const hasher = createPasswordHasher({ N: 1024, r: 8, p: 1 }); // ninguém faz login: custo baixo basta
  const password = randomBytes(16).toString("hex");
  const technician = await createUser(pool, hasher, { email: "avaliador@eval.local", displayName: "Avaliador", role: "technician", password });
  const requester = await createUser(pool, hasher, { email: "solicitante@eval.local", displayName: "Solicitante", role: "requester", password });

  const corpusIds = new Map<string, string>();
  for (const doc of documents) {
    if (doc.tipo === "artigo") {
      const id = await insertArticle(pool, technician.id, {
        title: doc.titulo,
        symptom: doc.sintoma,
        environment: requireField(doc, "ambiente"),
        procedure: doc.procedimento,
        expectedResult: requireField(doc, "resultado"),
      });
      await updateArticle(pool, id, { status: "published" });
      corpusIds.set(await fixId(pool, "kb_articles", id, doc.id), doc.id);
    } else {
      const id = await insertTicket(pool, requester.id, {
        title: doc.titulo,
        description: [doc.sintoma, doc.ambiente].filter(Boolean).join("\n"),
        category: TICKET_CATEGORY[doc.categoria] ?? "other",
      });
      await updateTicket(pool, id, { status: "resolved", resolution_note: [doc.procedimento, doc.resultado].filter(Boolean).join("\n"), resolved_at: new Date() });
      corpusIds.set(await fixId(pool, "tickets", id, doc.id), doc.id);
    }
  }
  return corpusIds;
}

function searchFn(pool: pg.Pool, embeddings: Embeddings | undefined, technicianId: string, corpusIds: Map<string, string>): SearchFn {
  return async (query) => {
    // minScore 0: mede o ranking inteiro; o corte do limiar é avaliado à parte (abstention.configured).
    const outcome = await searchKnowledge(pool, embeddings, { id: technicianId, role: "technician" }, query, SEARCH_LIMIT, { minScore: 0 });
    return {
      mode: outcome.mode,
      degraded: outcome.degraded,
      ranking: outcome.items.map((item) => {
        const id = corpusIds.get(item.id);
        if (!id) throw new Error(`A busca devolveu um id que não é do corpus: ${item.id}`);
        return { id, score: item.score };
      }),
    };
  };
}

// Monta, para cada caso, o mesmo contexto que o diagnóstico monta (fontes, passos, abstenção). Nos casos de injection o
// documento plantado entra à força, como na Semana 0: sem isso o ataque pode nunca chegar ao modelo.
async function prepareGenerationCases(
  pool: pg.Pool,
  embeddings: Embeddings | undefined,
  technicianId: string,
  dataset: Dataset,
  corpusIds: Map<string, string>,
  cases: GenerationCase[],
): Promise<PreparedCase[]> {
  const queries = new Map(dataset.queries.map((q) => [q.id, q]));
  const docs = new Map(dataset.documents.map((d) => [d.id, d]));
  const dbIdOf = new Map([...corpusIds].map(([dbId, corpusId]) => [corpusId, dbId]));

  async function plantedSource(corpusId: string): Promise<Source> {
    const dbId = dbIdOf.get(corpusId);
    const doc = docs.get(corpusId);
    if (!dbId || !doc) throw new Error(`Documento plantado fora do corpus: ${corpusId}`);
    if (doc.tipo === "artigo") {
      const { rows } = await pool.query<{ title: string; symptom: string }>("SELECT title, symptom FROM kb_articles WHERE id = $1", [dbId]);
      return { kind: "article", id: dbId, title: rows[0]?.title ?? "", symptom: rows[0]?.symptom ?? "", tags: [] };
    }
    const { rows } = await pool.query<{ title: string; summary: string }>("SELECT title, left(description, 240) AS summary FROM tickets WHERE id = $1", [dbId]);
    return { kind: "ticket", id: dbId, title: rows[0]?.title ?? "", summary: rows[0]?.summary ?? "" };
  }

  const prepared: PreparedCase[] = [];
  for (const generationCase of cases) {
    const query = queries.get(generationCase.consulta);
    if (!query) throw new Error(`Caso cita consulta inexistente: ${generationCase.consulta}`);
    const outcome = await searchKnowledge(pool, embeddings, { id: technicianId, role: "technician" }, query.texto, SOURCES_MAX + 1, { minScore: 0 });
    let sources = toSources(outcome.items, "");
    let plantedForced = false;
    const planted = generationCase.documento_plantado;
    if (planted && !sources.some((s) => corpusIds.get(s.id) === planted)) {
      // Na 3ª posição: garante que esteja entre as 3 primeiras fontes, as únicas de que o diagnóstico extrai passos.
      sources = [...sources.slice(0, 2), await plantedSource(planted), ...sources.slice(2, SOURCES_MAX - 1)];
      plantedForced = true;
    }
    const evidence = evidenceFor(outcome, sources, false);
    const stepArticles = articleIdsForSteps(sources);
    const steps = toSteps(stepArticles, await articleProcedures(pool, stepArticles));
    prepared.push({
      caseId: query.id,
      type: query.tipo,
      expected: dataset.gold[query.id] ?? [],
      contextIds: sources.map((s) => corpusIds.get(s.id) ?? s.id),
      plantedForced,
      abstained: evidence === null,
      ...(generationCase.marcador ? { marker: generationCase.marcador } : {}),
      input: { ticket: { title: query.texto, description: "" }, sources, steps },
      sourceCorpusIds: corpusIds,
    });
  }
  return prepared;
}

// Roda a suíte contra a busca real do app (o mesmo `searchKnowledge` das rotas) dentro de um schema temporário do
// próprio banco: não apaga nem altera nenhuma tabela existente, e o schema é removido no fim, com ou sem erro.
export async function runEvaluation(options: RunOptions): Promise<EvalResult[]> {
  if ((options.nodeEnv ?? process.env.NODE_ENV) === "production") throw new Error("A avaliação não roda em produção.");
  const { dataset, embeddings } = options;
  // Falha cedo, antes de criar qualquer coisa.
  for (const doc of dataset.documents) if (doc.tipo === "artigo") { requireField(doc, "ambiente"); requireField(doc, "resultado"); }

  const schema = `eval_${randomBytes(6).toString("hex")}`; // nome gerado aqui: seguro para interpolar
  const admin = new pg.Pool({ connectionString: options.databaseUrl, max: 1 });
  let pool: pg.Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    // public no fim: unaccent e vector moram lá (migração 0001).
    pool = new pg.Pool({ connectionString: options.databaseUrl, max: 4, options: `-c search_path=${schema},public` });
    await migrate(pool);
    const corpusIds = await seedCorpus(pool, dataset.documents);
    const technician = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'technician'");
    const technicianId = technician.rows[0]?.id as string;

    if (embeddings) {
      const filled = await backfill(pool, embeddings.provider);
      const missing = filled.remaining.articles + filled.remaining.tickets;
      if (missing > 0) throw new Error(`Não consegui gerar o embedding de ${missing} documento(s); o modo vetorial não seria confiável.`);
    }

    const environment = environmentInfo();
    const results: EvalResult[] = [];
    for (const mode of embeddings ? (["lexical", "vector"] as const) : (["lexical"] as const)) {
      const active = mode === "vector" ? embeddings : undefined;
      const suite = await runSuite(dataset, searchFn(pool, active, technicianId, corpusIds), active ? { configuredThreshold: active.minScore } : {});
      results.push({
        schemaVersion: RESULT_SCHEMA_VERSION,
        set: options.set,
        datasetVersion: dataset.version,
        searchMode: mode,
        embeddingModel: active ? active.provider.model : null,
        environment,
        suite,
      });
    }

    const { generation } = options;
    if (generation) {
      const mode = embeddings ? "vector" : "lexical";
      const target = results.find((r) => r.searchMode === mode);
      if (!target) throw new Error("Sem resultado de busca para anexar a geração.");
      const cases = await prepareGenerationCases(pool, embeddings, technicianId, dataset, corpusIds, generation.cases);
      target.generation = await runGeneration({
        cases,
        rounds: generation.rounds,
        model: generation.provider.model,
        promptVersion: PROMPT_VERSION,
        casesVersion: generation.casesVersion,
        summarize: async (input) => {
          const started = performance.now();
          const outcome = await summarize(generation.provider, input);
          return { outcome, ms: Math.round(performance.now() - started) };
        },
      });
    }
    return results;
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

export async function saveResult(db: Pick<pg.Pool, "query">, result: EvalResult): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO eval_runs (dataset_set, dataset_version, search_mode, embedding_model, llm_model, prompt_version, environment, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING id`,
    [
      result.set,
      result.datasetVersion,
      result.searchMode,
      result.embeddingModel,
      result.generation?.model ?? null,
      result.generation?.promptVersion ?? null,
      JSON.stringify(result.environment),
      JSON.stringify(result),
    ],
  );
  return rows[0]?.id as string;
}
