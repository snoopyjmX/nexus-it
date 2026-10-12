import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../apps/api/src/db/migrate.js";
import { createLogger } from "../../../apps/api/src/lib/logger.js";
import type { Embeddings } from "../../../apps/api/src/modules/embeddings/index.js";
import { createFakeProvider } from "../../../apps/api/test/fake-embeddings.js";
import { resetSchema, testDatabaseUrl } from "../../../apps/api/test/test-db.js";
import { PROMPT_VERSION, type SummaryProvider } from "../../../apps/api/src/modules/diagnosis/summary.js";
import { DEV_DIR, loadDataset } from "../src/dataset.js";
import { loadGenerationCases } from "../src/generation.js";
import { runEvaluation, saveResult } from "../src/runner.js";

const url = testDatabaseUrl();
const pool = new pg.Pool({ connectionString: url, max: 4 });

beforeEach(async () => {
  // Restos de execuções interrompidas (ou de mutações) não podem contaminar os testes de "sem rastro".
  const left = await pool.query<{ nspname: string }>("SELECT nspname FROM pg_namespace WHERE nspname ~ '^eval_[0-9a-f]{12}$'");
  for (const { nspname } of left.rows) await pool.query(`DROP SCHEMA ${nspname} CASCADE`);
  await resetSchema(pool);
  await pool.query("CREATE EXTENSION IF NOT EXISTS unaccent");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await migrate(pool);
});
afterAll(() => pool.end());

const embeddingsWith = (provider = createFakeProvider()): Embeddings => ({ provider, minScore: 0.2, logger: createLogger("silent") });
const evalSchemas = async () => (await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'eval\\_%'")).rows;
const count = async (table: string) => Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

describe("runner da avaliação (FR-12)", () => {
  it("roda a busca real do app sobre o conjunto dev em modo lexical e devolve resultado versionado", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const results = await runEvaluation({ databaseUrl: url, dataset, set: "dev" });
    expect(results).toHaveLength(1);
    const [lexical] = results;
    expect(lexical).toMatchObject({ schemaVersion: 1, set: "dev", datasetVersion: dataset.version, searchMode: "lexical", embeddingModel: null });
    expect(lexical?.environment.node).toBe(process.version);
    expect(lexical?.environment.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lexical?.suite.queryCount).toBe(30);
    expect(lexical?.suite.modes).toEqual({ lexical: 30 });
    expect(lexical?.suite.degradedQueries).toBe(0);
    // 8 diretas + 10 paráfrases + 2 ambíguas + 2 injection têm resposta no gold.
    expect(Object.values(lexical?.suite.byType ?? {}).reduce((sum, c) => sum + c.n, 0)).toBe(22);
    // A busca mapeia ids do banco de volta para os ids do corpus: o top-5 só tem ids do corpus.
    const corpusIds = new Set(dataset.documents.map((d) => d.id));
    for (const row of lexical?.suite.rows ?? []) for (const id of row.top5) expect(corpusIds.has(id), id).toBe(true);
  });

  it("o corpus semeado é pesquisável: um artigo (q29) e um chamado resolvido (q30) esperados aparecem no top-5", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const [lexical] = await runEvaluation({ databaseUrl: url, dataset, set: "dev" });
    const rows = new Map(lexical?.suite.rows.map((r) => [r.id, r]));
    for (const id of ["q29", "q30"]) {
      const row = rows.get(id);
      expect(row?.expected.length, id).toBeGreaterThan(0);
      expect(row?.expectedInTop5, id).toBeGreaterThan(0);
    }
    const kinds = new Set(dataset.documents.filter((d) => ["q29", "q30"].some((q) => dataset.gold[q]?.includes(d.id))).map((d) => d.tipo));
    expect(kinds).toEqual(new Set(["artigo", "chamado"]));
  });

  it("mede o ranking inteiro: o corte de similaridade do app não é aplicado na busca (só avaliado à parte)", async () => {
    const strict: Embeddings = { provider: createFakeProvider(), minScore: 0.99, logger: createLogger("silent") };
    const results = await runEvaluation({ databaseUrl: url, dataset: await loadDataset(DEV_DIR), set: "dev", embeddings: strict });
    const vector = results[1];
    expect(vector?.suite.rows.filter((r) => r.top5.length > 0).length).toBeGreaterThan(20);
    expect(vector?.suite.abstention.configured?.threshold).toBe(0.99);
  });

  it("é reproduzível: duas execuções dão exatamente o mesmo ranking, inclusive nos empates de score", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const embeddings = embeddingsWith();
    const first = await runEvaluation({ databaseUrl: url, dataset, set: "dev", embeddings });
    const second = await runEvaluation({ databaseUrl: url, dataset, set: "dev", embeddings });
    expect(second.map((r) => r.suite)).toEqual(first.map((r) => r.suite));
  });

  it("com embeddings roda também o modo vetorial e avalia o limiar configurado", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const results = await runEvaluation({ databaseUrl: url, dataset, set: "dev", embeddings: embeddingsWith(createFakeProvider("modelo-falso")) });
    expect(results.map((r) => r.searchMode)).toEqual(["lexical", "vector"]);
    const vector = results[1];
    expect(vector).toMatchObject({ embeddingModel: "modelo-falso" });
    expect(vector?.suite.modes).toEqual({ vector: 30 });
    expect(vector?.suite.abstention.configured?.threshold).toBe(0.2);
    expect(results[0]?.suite.abstention.configured).toBeNull();
  });

  it("não deixa rastro: nenhum schema temporário e nenhuma linha nas tabelas do app", async () => {
    await runEvaluation({ databaseUrl: url, dataset: await loadDataset(DEV_DIR), set: "dev", embeddings: embeddingsWith() });
    expect(await evalSchemas()).toEqual([]);
    for (const table of ["users", "tickets", "kb_articles", "ai_runs", "eval_runs"]) expect(await count(table), table).toBe(0);
  });

  it("não deixa rastro nem quando a preparação falha (embeddings fora do ar)", async () => {
    const provider = createFakeProvider();
    provider.down = true;
    await expect(runEvaluation({ databaseUrl: url, dataset: await loadDataset(DEV_DIR), set: "dev", embeddings: embeddingsWith(provider) })).rejects.toThrow(/embedding/i);
    expect(await evalSchemas()).toEqual([]);
    expect(await count("users")).toBe(0);
  });

  it("recusa rodar em produção", async () => {
    await expect(runEvaluation({ databaseUrl: url, dataset: await loadDataset(DEV_DIR), set: "dev", nodeEnv: "production" })).rejects.toThrow(/produção/);
  });

  it("explica qual campo do documento não cabe no app em vez de inventar um valor", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const broken = { ...dataset, documents: dataset.documents.map((d, i) => (i === 0 ? { ...d, ambiente: "" } : d)) };
    await expect(runEvaluation({ databaseUrl: url, dataset: broken, set: "dev" })).rejects.toThrow(new RegExp(`${dataset.documents[0]?.id}.*ambiente`));
    expect(await evalSchemas()).toEqual([]);
  });
});

describe("gravação do resultado em eval_runs", () => {
  it("grava uma linha por resultado com os campos de FR-12 e o resultado completo", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const results = await runEvaluation({ databaseUrl: url, dataset, set: "dev", embeddings: embeddingsWith(createFakeProvider("m1")) });
    for (const result of results) await saveResult(pool, result);
    const { rows } = await pool.query("SELECT dataset_set, dataset_version, search_mode, embedding_model, llm_model, prompt_version, environment, result FROM eval_runs ORDER BY search_mode");
    expect(rows.map((r) => [r.search_mode, r.embedding_model, r.dataset_set, r.dataset_version])).toEqual([
      ["lexical", null, "dev", dataset.version],
      ["vector", "m1", "dev", dataset.version],
    ]);
    expect(rows[0].llm_model).toBeNull();
    expect(rows[0].environment).toHaveProperty("cpu");
    expect(rows[0].result.suite.queryCount).toBe(30);
  });
});

function fakeSummarizer(): SummaryProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    model: "gemma3:4b",
    prompts,
    async complete({ user }) {
      prompts.push(user);
      return JSON.stringify({ resumo: "Resumo de teste.", fontes: ["F1"] });
    },
  };
}

describe("avaliação da geração (ADR-008)", () => {
  async function runWithGeneration(provider = fakeSummarizer(), rounds = 2, embeddings?: Embeddings) {
    const dataset = await loadDataset(DEV_DIR);
    const { cases, version } = await loadGenerationCases(DEV_DIR, dataset);
    const results = await runEvaluation({ databaseUrl: url, dataset, set: "dev", ...(embeddings ? { embeddings } : {}), generation: { provider, cases, casesVersion: version, rounds } });
    return { results, provider, dataset };
  }

  it("mede a geração no modo que o app usa (lexical sem embeddings), com modelo, prompt e 12 casos", async () => {
    const { results, provider } = await runWithGeneration();
    expect(results).toHaveLength(1);
    const generation = results[0]?.generation;
    expect(generation).toMatchObject({ model: "gemma3:4b", promptVersion: PROMPT_VERSION, rounds: 2 });
    expect(generation?.cases).toHaveLength(12);
    expect(generation?.casesVersion).toMatch(/^[0-9a-f]{12}$/);
    // Nem todo caso chama o modelo (abstenção não chama), mas cada chamada é uma rodada de um caso.
    const calls = generation?.cases.flatMap((c) => c.rounds).filter((r) => r.status !== "abstained").length;
    expect(provider.prompts).toHaveLength(calls ?? -1);
    expect(calls).toBeGreaterThan(0);
  });

  it("com embeddings a geração fica no resultado vetorial", async () => {
    const { results } = await runWithGeneration(fakeSummarizer(), 1, embeddingsWith());
    expect(results.map((r) => [r.searchMode, r.generation !== undefined])).toEqual([["lexical", false], ["vector", true]]);
  });

  it("força o documento plantado no contexto e registra se o trecho chegou ao modelo", async () => {
    const { results } = await runWithGeneration();
    const byId = Object.fromEntries((results[0]?.generation?.cases ?? []).map((c) => [c.caseId, c]));
    expect(byId.q29?.contextIds).toContain("kb-ac-02");
    expect(byId.q30?.contextIds).toContain("ch-08");
    // O procedimento do artigo entra como passos no prompt; o do chamado resolvido não (só título e descrição).
    expect(byId.q29?.markerInPrompt).toBe(true);
    expect(byId.q30?.markerInPrompt).toBe(false);
    expect(results[0]?.generation?.summary.injectionReachedModel).toEqual({ n: 1, of: 2 });
  });

  it("quando o plantado não foi recuperado, entra à força na 3ª posição e fica marcado", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const provider = fakeSummarizer();
    const results = await runEvaluation({
      databaseUrl: url,
      dataset,
      set: "dev",
      generation: { provider, rounds: 1, casesVersion: "abc123abc123", cases: [{ consulta: "q29", documento_plantado: "kb-es-01", marcador: "tela azul" }, { consulta: "q30", documento_plantado: "ch-05", marcador: "qualquer" }] },
    });
    const [first, second] = results[0]?.generation?.cases ?? [];
    expect(first).toMatchObject({ caseId: "q29", plantedForced: true });
    expect(first?.contextIds[2]).toBe("kb-es-01");
    expect(second).toMatchObject({ caseId: "q30", plantedForced: true });
    expect(second?.contextIds[2]).toBe("ch-05");
    expect(first?.contextIds.length).toBeLessThanOrEqual(5);
  });

  it("consulta sem nenhuma fonte abstém e o modelo não é chamado para ela", async () => {
    const dataset = await loadDataset(DEV_DIR);
    const withNothing = {
      ...dataset,
      queries: [...dataset.queries, { id: "zz", texto: "wqpzx kjhgf", tipo: "sem_resposta" as const, categoria: "x", grupo: "calibracao" as const }],
      gold: { ...dataset.gold, zz: [] },
    };
    const provider = fakeSummarizer();
    const results = await runEvaluation({ databaseUrl: url, dataset: withNothing, set: "dev", generation: { provider, rounds: 2, casesVersion: "abc123abc123", cases: [{ consulta: "zz" }] } });
    const generation = results[0]?.generation;
    expect(generation?.cases[0]).toMatchObject({ caseId: "zz", abstained: true, contextIds: [] });
    expect(generation?.summary.abstainedUnanswerable).toEqual({ n: 1, of: 1 });
    expect(provider.prompts).toHaveLength(0);
  });

  it("a geração usa o ranking sem corte de similaridade, como o diagnóstico com limiar não confiável", async () => {
    const strict: Embeddings = { provider: createFakeProvider(), minScore: 0.99, logger: createLogger("silent") };
    const { results } = await runWithGeneration(fakeSummarizer(), 1, strict);
    expect(results[1]?.generation?.summary.statusCounts.ok ?? 0).toBeGreaterThan(0);
  });

  it("o modelo recebe só o texto da consulta e fontes do corpus, nunca ids do banco", async () => {
    const { provider } = await runWithGeneration(fakeSummarizer(), 1);
    expect(provider.prompts.length).toBeGreaterThan(0);
    for (const prompt of provider.prompts) expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("não deixa rastro mesmo medindo a geração", async () => {
    await runWithGeneration();
    expect(await evalSchemas()).toEqual([]);
    expect(await count("tickets")).toBe(0);
  });

  it("grava modelo e prompt em eval_runs quando há geração", async () => {
    const { results } = await runWithGeneration(fakeSummarizer(), 1);
    for (const result of results) await saveResult(pool, result);
    const { rows } = await pool.query("SELECT llm_model, prompt_version, result FROM eval_runs");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ llm_model: "gemma3:4b", prompt_version: PROMPT_VERSION });
    expect(rows[0].result.generation.cases).toHaveLength(12);
  });
});
