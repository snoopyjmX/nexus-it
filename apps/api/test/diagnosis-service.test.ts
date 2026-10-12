import { describe, expect, it } from "vitest";
import { QUERY_MAX, SOURCES_MAX, buildQuery, evidenceFor, toSources, toSteps } from "../src/modules/diagnosis/service.js";
import type { SearchHit } from "../src/modules/knowledge/store.js";

const article = (id: string, score = 0.9): SearchHit => ({ kind: "article", id, title: `A ${id}`, symptom: "s", tags: ["t"], score });
const ticket = (id: string, score = 0.8): SearchHit => ({ kind: "ticket", id, title: `T ${id}`, summary: "r", score });

describe("consulta do diagnóstico (ADR-011)", () => {
  it("junta título e descrição e normaliza os espaços", () => {
    expect(buildQuery({ title: "  VPN   não\nconecta ", description: "Erro\t de certificado\r\n" })).toBe("VPN não conecta Erro de certificado");
  });

  it("corta a consulta em 300 caracteres", () => {
    const query = buildQuery({ title: "a".repeat(120), description: "b".repeat(5000) });
    expect(QUERY_MAX).toBe(300);
    expect(query).toHaveLength(300);
    expect(query.startsWith("a".repeat(120))).toBe(true);
  });
});

describe("fontes do diagnóstico (FR-09, FR-10)", () => {
  it("tira o score e o próprio chamado e limita a 5 fontes", () => {
    const hits = [ticket("self"), article("a1"), article("a2"), article("a3"), article("a4"), article("a5"), article("a6")];
    const sources = toSources(hits, "self");
    expect(SOURCES_MAX).toBe(5);
    expect(sources.map((s) => s.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(JSON.stringify(sources)).not.toMatch(/score/i);
  });

  it("não tira artigo com o mesmo id do chamado: a exclusão vale só para chamado", () => {
    expect(toSources([article("x")], "x").map((s) => s.id)).toEqual(["x"]);
  });

  it("evidência: 'threshold' só com busca vetorial e limiar confiável; sem fonte, abstém", () => {
    const sources = toSources([article("a1")], "t");
    expect(evidenceFor({ mode: "vector" }, sources, true)).toBe("threshold");
    expect(evidenceFor({ mode: "vector" }, sources, false)).toBe("unverified");
    expect(evidenceFor({ mode: "lexical" }, sources, true)).toBe("unverified");
    expect(evidenceFor({ mode: "lexical" }, sources, false)).toBe("unverified");
    for (const mode of ["vector", "lexical"] as const) expect(evidenceFor({ mode }, [], true)).toBeNull();
  });

  it("passos: ignora artigo sem procedimento carregado e mantém a ordem das fontes", () => {
    const procedures = new Map([
      ["a2", "1. Segundo A.\n2. Segundo B."],
      ["a1", "1. Primeiro."],
    ]);
    expect(toSteps(["a1", "a3", "a2"], procedures)).toEqual([
      { articleId: "a1", text: "Primeiro." },
      { articleId: "a2", text: "Segundo A." },
      { articleId: "a2", text: "Segundo B." },
    ]);
  });
});
