import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../apps/api/src/db/migrate.js";
import { createLogger } from "../../../apps/api/src/lib/logger.js";
import type { Embeddings } from "../../../apps/api/src/modules/embeddings/index.js";
import { createFakeProvider } from "../../../apps/api/test/fake-embeddings.js";
import { resetSchema, testDatabaseUrl } from "../../../apps/api/test/test-db.js";
import { DEV_DIR, loadDataset } from "../src/dataset.js";
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
