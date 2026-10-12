import { describe, expect, it } from "vitest";
import { formatReport } from "../src/report.js";
import type { GenerationResult } from "../src/generation.js";
import type { EvalResult } from "../src/result.js";

const result: EvalResult = {
  schemaVersion: 1,
  set: "dev",
  datasetVersion: "6593b3ab29a9",
  searchMode: "vector",
  embeddingModel: "bge-m3",
  environment: { date: "2026-10-12T10:00:00.000Z", commit: "abc1234", node: "v22.0.0", os: "Linux 6 x64", cpu: "CPU X", memoryGb: 16 },
  suite: {
    queryCount: 30,
    degradedQueries: 1,
    modes: { vector: 30 },
    byType: { direta: { n: 8, hit1: 7, hit5: 8, mrr: 0.938 } },
    byCategory: { vpn: { n: 3, hit1: 3, hit5: 3, mrr: 1 } },
    abstention: {
      calibration: { threshold: 0.4, abstainedUnanswerable: 3, totalUnanswerable: 4, lostAnswerable: 1, totalAnswerable: 9 },
      validation: { threshold: 0.4, abstainedUnanswerable: 2, totalUnanswerable: 4, lostAnswerable: 0, totalAnswerable: 9 },
      configured: null,
    },
    rows: [],
  },
};

describe("relatório legível da execução", () => {
  it("traz versão, modelo, ambiente e as contagens (não percentuais) por tipo e categoria", () => {
    const text = formatReport(result);
    for (const part of ["6593b3ab29a9", "vector", "bge-m3", "abc1234", "CPU X", "direta", "7/8", "8/8", "0.938", "vpn", "3/3"]) expect(text).toContain(part);
    expect(text).not.toContain("%");
  });

  it("avisa de consultas degradadas e mostra a abstenção em contagens", () => {
    const text = formatReport(result);
    expect(text).toMatch(/1 consulta.*degrad/i);
    expect(text).toContain("3/4");
    expect(text).toContain("0.4");
  });

  it("diz que a abstenção do limiar configurado não foi avaliada quando não há", () => {
    expect(formatReport(result)).toMatch(/configurado.*não avaliado/i);
  });
});

const generation: GenerationResult = {
  casesVersion: "ffffffffffff",
  model: "gemma3:4b",
  promptVersion: "resumo-v1",
  rounds: 3,
  firstCallMs: 41_000,
  warmP50Ms: 18_400,
  warmP95Ms: 38_600,
  cases: [
    {
      caseId: "q29",
      type: "injection",
      expected: ["kb-ac-02"],
      contextIds: ["kb-ac-02"],
      plantedForced: true,
      abstained: false,
      markerInPrompt: true,
      stable: true,
      rounds: [{ round: 1, status: "ok", durationMs: 18_000, text: "Resumo.", citedCorpusIds: ["kb-ac-02"], discarded: 0, citedExpected: null, markerLeaked: false }],
    },
  ],
  summary: {
    citedExpected: { met: 7, of: 8 },
    abstainedUnanswerable: { n: 1, of: 2 },
    injectionLeaked: [],
    injectionReachedModel: { n: 1, of: 2 },
    statusCounts: { ok: 30, uncited: 2 },
    discardedCitations: 4,
    stable: { n: 11, of: 12 },
  },
  criteria: [
    { name: "cita a fonte esperada", rule: "≥ 6 de 8 respondíveis", value: "7 de 8", met: true },
    { name: "p50 aquecido ≤ 20 s", rule: "≤ 20 000 ms", value: "25000 ms", met: false },
    { name: "sem dados", rule: "x", value: "y", met: null },
  ],
  humanReview: "Os critérios b e c do T-05 exigem leitura humana.",
};

describe("relatório da geração", () => {
  const text = formatReport({ ...result, generation });

  it("traz modelo, prompt, rodadas, tempos e o veredito de cada critério automático", () => {
    for (const part of ["gemma3:4b", "resumo-v1", "3 rodadas", "41000", "18400", "38600", "cita a fonte esperada: 7 de 8 (≥ 6 de 8 respondíveis): atende", "p50 aquecido ≤ 20 s: 25000 ms (≤ 20 000 ms): NÃO atende", "sem dados: y (x): sem dados"]) {
      expect(text, part).toContain(part);
    }
  });

  it("diz quantos ataques de injection chegaram ao modelo e lembra da leitura humana", () => {
    expect(text).toContain("chegou ao modelo em 1 de 2 casos");
    expect(text).toMatch(/chegou ao modelo/i);
    expect(text).toContain("critérios b e c");
  });

  it("conta os desfechos e as citações descartadas", () => {
    expect(text).toContain("ok 30");
    expect(text).toContain("uncited 2");
    expect(text).toMatch(/4 citaç/);
  });

  it("sem geração não há seção de geração", () => {
    expect(formatReport(result)).not.toMatch(/geração/i);
  });
});
