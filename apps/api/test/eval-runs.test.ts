import type pg from "pg";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/lib/db.js";
import { api, buildApp, loginAs, seedUsers, type App, type Session } from "./app-helpers.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

const pool: pg.Pool = createPool(testDatabaseUrl());
let app: App;
let ana: Session;
let tecnico: Session;

beforeEach(async () => {
  await resetSchema(pool);
  await migrate(pool);
  await seedUsers(pool);
  app = buildApp(pool);
  [ana, tecnico] = await Promise.all([loginAs(app, "ana"), loginAs(app, "tecnico")]);
});
afterAll(() => pool.end());

const ENV = { date: "2026-10-12T10:00:00.000Z", commit: "abc1234", node: "v22.0.0", os: "Linux", cpu: "CPU X", memoryGb: 16 };

async function insertRun(over: Record<string, unknown> = {}): Promise<void> {
  const row = { dataset_set: "dev", dataset_version: "6593b3ab29a9", search_mode: "lexical", embedding_model: null, llm_model: null, prompt_version: null, environment: JSON.stringify(ENV), result: JSON.stringify({ schemaVersion: 1, marker: "x" }), ...over };
  const keys = Object.keys(row);
  await pool.query(`INSERT INTO eval_runs (${keys.join(", ")}) VALUES (${keys.map((k, i) => `$${i + 1}${k === "environment" || k === "result" ? "::jsonb" : ""}`).join(", ")})`, Object.values(row));
}

describe("GET /eval/runs (FR-12, FR-02)", () => {
  it("exige sessão", async () => {
    expect((await request(app).get("/api/v1/eval/runs")).status).toBe(401);
  });

  it("solicitante recebe 403", async () => {
    await insertRun();
    expect((await api(app, ana).get("/eval/runs")).status).toBe(403);
  });

  it("técnico recebe lista vazia quando nada foi rodado", async () => {
    const res = await api(app, tecnico).get("/eval/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it("devolve as execuções da mais nova para a mais antiga, com versão, modelo, prompt, ambiente e resultado", async () => {
    await insertRun({ dataset_version: "000000000001" });
    await insertRun({ dataset_version: "000000000002", search_mode: "vector", embedding_model: "bge-m3", llm_model: "gemma3:4b", prompt_version: "resumo-v1" });
    const res = await api(app, tecnico).get("/eval/runs");
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { datasetVersion: string }) => i.datasetVersion)).toEqual(["000000000002", "000000000001"]);
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
      set: "dev",
      datasetVersion: "000000000002",
      searchMode: "vector",
      embeddingModel: "bge-m3",
      llmModel: "gemma3:4b",
      promptVersion: "resumo-v1",
      environment: ENV,
      result: { schemaVersion: 1, marker: "x" },
    });
  });

  it("limita a 50 execuções, as mais novas", async () => {
    for (let i = 0; i < 52; i++) await insertRun({ dataset_version: String(i).padStart(12, "0") });
    const res = await api(app, tecnico).get("/eval/runs");
    expect(res.body.items).toHaveLength(50);
    expect(res.body.items[0].datasetVersion).toBe("000000000051");
  });

  it("é só leitura: POST, PATCH e DELETE não existem", async () => {
    expect((await api(app, tecnico).post("/eval/runs", {})).status).toBe(404);
    expect((await api(app, tecnico).patch("/eval/runs", {})).status).toBe(404);
  });
});

describe("tabela eval_runs (restrições do banco)", () => {
  it("aceita linhas válidas", async () => {
    await expect(insertRun({ search_mode: "vector", embedding_model: "bge-m3" })).resolves.toBeUndefined();
    await expect(insertRun({ dataset_set: "test", llm_model: "m", prompt_version: "p" })).resolves.toBeUndefined();
  });

  it.each([
    ["conjunto desconhecido", { dataset_set: "producao" }],
    ["versão que não é hash de 12 hexadecimais", { dataset_version: "v1" }],
    ["modo desconhecido", { search_mode: "hibrida" }],
    ["modo vetorial sem modelo de embedding", { search_mode: "vector" }],
    ["modo lexical com modelo de embedding", { embedding_model: "bge-m3" }],
    ["modelo de linguagem sem versão de prompt", { llm_model: "m" }],
    ["prompt sem modelo de linguagem", { prompt_version: "p" }],
  ])("recusa %s", async (_name, over) => {
    await expect(insertRun(over)).rejects.toMatchObject({ code: "23514" });
  });
});
