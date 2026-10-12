import { describe, expect, it } from "vitest";
import { DEV_DIR, loadDataset, type Dataset } from "../src/dataset.js";
import { runSuite, type SearchFn } from "../src/suite.js";

const doc = (id: string, categoria = "c1") => ({ id, tipo: "artigo" as const, categoria, titulo: id, sintoma: "s", ambiente: "", procedimento: "p", resultado: "", rascunho_llm: false });

const dataset: Dataset = {
  version: "abc123abc123",
  documents: ["d1", "d2", "d3", "d4"].map((id) => doc(id)),
  queries: [
    { id: "q1", texto: "um", tipo: "direta", categoria: "c1" },
    { id: "q2", texto: "dois", tipo: "parafrase", categoria: "c2" },
    { id: "q3", texto: "tres", tipo: "ambigua", categoria: "c1" },
    { id: "u1", texto: "nada1", tipo: "sem_resposta", categoria: "c1", grupo: "calibracao" },
    { id: "u2", texto: "nada2", tipo: "sem_resposta", categoria: "c1", grupo: "validacao" },
    { id: "a1", texto: "resp1", tipo: "direta", categoria: "c1", grupo: "calibracao" },
    { id: "a2", texto: "resp2", tipo: "direta", categoria: "c1", grupo: "validacao" },
  ],
  gold: { q1: ["d1"], q2: ["d2"], q3: ["d3", "d4"], u1: [], u2: [], a1: ["d1"], a2: ["d2"] },
};

function fakeSearch(rankings: Record<string, [string, number][]>, over: Partial<{ mode: "lexical" | "vector"; degraded: boolean }> = {}): SearchFn {
  return async (query) => ({ mode: "lexical", degraded: false, ...over, ranking: (rankings[query] ?? []).map(([id, score]) => ({ id, score })) });
}

const rankings: Record<string, [string, number][]> = {
  um: [["d1", 0.9], ["d2", 0.1]], // acerto no 1º
  dois: [["d1", 0.8], ["d3", 0.7], ["d2", 0.6]], // acerto no 3º
  tres: [["d4", 0.5], ["d1", 0.4]], // ambígua: uma das duas esperadas no top-5
  nada1: [["d1", 0.2]],
  nada2: [["d2", 0.3]],
  resp1: [["d1", 0.6]],
  resp2: [["d2", 0.5]],
};

describe("execução da suíte (FR-12)", () => {
  it("registra posição, top-5 e quantas esperadas aparecem, por consulta", async () => {
    const { rows } = await runSuite(dataset, fakeSearch(rankings));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.q1).toMatchObject({ position: 1, top5: ["d1", "d2"], expectedInTop5: 1, topScore: 0.9, type: "direta", category: "c1", group: null });
    expect(byId.q2).toMatchObject({ position: 3, expectedInTop5: 1 });
    expect(byId.q3).toMatchObject({ position: 1, expectedInTop5: 1, expected: ["d3", "d4"] });
    expect(byId.u1).toMatchObject({ position: null, expected: [], group: "calibracao" });
  });

  it("calcula Hit@1, Hit@5 e MRR por tipo e por categoria só sobre as consultas com resposta", async () => {
    const out = await runSuite(dataset, fakeSearch(rankings));
    expect(out.byType.direta).toEqual({ n: 3, hit1: 3, hit5: 3, mrr: 1 });
    expect(out.byType.parafrase).toEqual({ n: 1, hit1: 0, hit5: 1, mrr: 0.333 });
    expect(out.byType.ambigua).toEqual({ n: 1, hit1: 1, hit5: 1, mrr: 1 });
    expect(out.byType.sem_resposta).toBeUndefined();
    expect(out.byCategory.c2).toEqual({ n: 1, hit1: 0, hit5: 1, mrr: 0.333 });
    expect(out.byCategory.c1?.n).toBe(4);
  });

  it("consulta sem resultado conta como erro, e topScore vira 0", async () => {
    const out = await runSuite(dataset, fakeSearch({}));
    expect(out.byType.direta).toEqual({ n: 3, hit1: 0, hit5: 0, mrr: 0 });
    expect(out.rows.every((r) => r.topScore === 0 && r.top5.length === 0)).toBe(true);
  });

  it("calibra o limiar num grupo, confere no outro e avalia o limiar configurado em todos", async () => {
    const out = await runSuite(dataset, fakeSearch(rankings), { configuredThreshold: 0.55 });
    // Calibração: u1 (0,2, sem resposta) e a1 (0,6, respondível). O limiar entre eles abstém u1 sem perder a1.
    expect(out.abstention.calibration).toMatchObject({ abstainedUnanswerable: 1, totalUnanswerable: 1, lostAnswerable: 0, totalAnswerable: 1 });
    expect(out.abstention.calibration?.threshold).toBeCloseTo(0.4, 10);
    // Validação com 0,4: u2 (0,3) abstém; a2 (0,5) fica.
    expect(out.abstention.validation).toMatchObject({ abstainedUnanswerable: 1, lostAnswerable: 0 });
    // Configurado 0,55 sobre os 7 casos com grupo ou não: sem-resposta u1,u2 abstêm; respondíveis com score < 0,55 perdem.
    expect(out.abstention.configured).toMatchObject({ threshold: 0.55, abstainedUnanswerable: 2, totalUnanswerable: 2, totalAnswerable: 5 });
    expect(out.abstention.configured?.lostAnswerable).toBe(2); // q3 (0,5) e a2 (0,5)
  });

  it("sem grupos não há calibração; sem limiar configurado não há avaliação dele", async () => {
    const plain: Dataset = { ...dataset, queries: dataset.queries.filter((q) => !q.grupo) };
    const out = await runSuite(plain, fakeSearch(rankings));
    expect(out.abstention).toEqual({ calibration: null, validation: null, configured: null });
  });

  it("conta consultas degradadas e os modos observados", async () => {
    const out = await runSuite(dataset, fakeSearch(rankings, { mode: "vector", degraded: true }));
    expect(out.degradedQueries).toBe(7);
    expect(out.modes).toEqual({ vector: 7 });
    expect(out.queryCount).toBe(7);
  });

  it("propaga a falha da busca em vez de fingir um resultado", async () => {
    await expect(runSuite(dataset, async () => { throw new Error("banco fora"); })).rejects.toThrow("banco fora");
  });

  it("com o conjunto dev e uma busca perfeita, todas as consultas com resposta acertam no 1º", async () => {
    const dev = await loadDataset(DEV_DIR);
    const byText = new Map(dev.queries.map((q) => [q.texto, q.id]));
    const perfect: SearchFn = async (text) => ({ mode: "lexical", degraded: false, ranking: (dev.gold[byText.get(text) ?? ""] ?? []).map((id) => ({ id, score: 1 })) });
    const out = await runSuite(dev, perfect);
    for (const counts of Object.values(out.byType)) expect(counts.hit1).toBe(counts.n);
    expect(out.queryCount).toBe(30);
  });
});
