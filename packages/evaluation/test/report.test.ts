import { describe, expect, it } from "vitest";
import { formatReport } from "../src/report.js";
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
