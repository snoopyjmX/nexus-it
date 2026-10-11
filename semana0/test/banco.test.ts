import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buscarLexical, buscarVetorial, conferirUrl, indexar } from "../src/banco.js";
import type { Documento } from "../src/dados.js";

describe("conferirUrl", () => {
  it("recusa banco que não é dedicado ao experimento", () => {
    expect(() => conferirUrl("postgres://u:p@127.0.0.1/nexus")).toThrow(/recusado/);
    expect(() => conferirUrl(undefined)).toThrow(/DATABASE_URL/);
  });
  it("aceita *_semana0 e *_test", () => {
    expect(conferirUrl("postgres://u:p@127.0.0.1/nexus_semana0")).toContain("nexus_semana0");
    expect(conferirUrl("postgres://u:p@127.0.0.1/nexus_test")).toContain("nexus_test");
  });
});

const doc = (id: string, titulo: string, procedimento: string): Documento => ({
  id, tipo: "artigo", categoria: "c", titulo, sintoma: "", ambiente: "", procedimento, resultado: "", rascunho_llm: false,
});

describe("indexação e busca (Postgres + pgvector)", () => {
  const pool = new pg.Pool({ connectionString: conferirUrl(process.env.DATABASE_URL) });
  const docs = [
    doc("d-titulo", "Configuração de impressão", "reiniciar"),
    doc("d-proced", "Outro assunto", "ajustar configuração de impressão"),
    doc("d-vpn", "VPN não conecta", "reemitir certificado"),
  ];
  // Vetores 3D artificiais: a ordem por cosseno é conhecida de antemão.
  const vetores = [[1, 0, 0], [0.9, 0.1, 0], [0, 0, 1]];

  beforeAll(() => indexar(pool, docs, vetores));
  afterAll(async () => {
    await pool.query("DROP TABLE IF EXISTS semana0_documento");
    await pool.end();
  });

  it("lexical ignora acento e dá mais peso ao título (A) que ao procedimento (B)", async () => {
    const r = await buscarLexical(pool, "configuracao impressao");
    expect(r.map((x) => x.id)).toEqual(["d-titulo", "d-proced"]);
    expect(r[0]?.score).toBeGreaterThan(r[1]?.score ?? Infinity);
  });

  it("lexical exige todos os termos (websearch_to_tsquery faz AND)", async () => {
    expect(await buscarLexical(pool, "impressão certificado")).toEqual([]);
  });

  it("lexical trata a consulta como dado, não como SQL", async () => {
    expect(await buscarLexical(pool, "'; DROP TABLE semana0_documento; --")).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM semana0_documento")).rows[0].n).toBe(3);
  });

  it("vetorial ordena por similaridade de cosseno exata", async () => {
    const r = await buscarVetorial(pool, [1, 0, 0]);
    expect(r.map((x) => x.id)).toEqual(["d-titulo", "d-proced", "d-vpn"]);
    expect(r[0]?.score).toBeCloseTo(1, 6);
    expect(r[2]?.score).toBeCloseTo(0, 6);
  });

  it("recusa vetores de dimensões diferentes", async () => {
    await expect(indexar(pool, docs.slice(0, 2), [[1, 0], [1, 0, 0]])).rejects.toThrow(/dimensões/);
  });
});
