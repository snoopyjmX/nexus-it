import { describe, expect, it } from "vitest";
import { calibrateThreshold, count, evaluateThreshold, position, type ScorePoint } from "../src/metrics.js";

describe("posição da primeira fonte esperada (FR-12)", () => {
  const ranking = [{ id: "a", score: 3 }, { id: "b", score: 2 }, { id: "c", score: 1 }];
  it("é 1-based, pega a primeira esperada e devolve null se não aparece", () => {
    expect(position(ranking, ["c"])).toBe(3);
    expect(position(ranking, ["c", "b"])).toBe(2);
    expect(position(ranking, ["z"])).toBeNull();
    expect(position(ranking, [])).toBeNull();
    expect(position([], ["a"])).toBeNull();
  });
});

describe("contagens Hit@1, Hit@5 e MRR", () => {
  it("conta acertos e calcula o MRR com 3 casas", () => {
    expect(count([1, 2, 5, 6, null])).toEqual({ n: 5, hit1: 1, hit5: 3, mrr: 0.373 });
  });
  it("posição 6 ou maior conta no MRR mas não no Hit@5", () => {
    expect(count([6])).toEqual({ n: 1, hit1: 0, hit5: 0, mrr: 0.167 });
  });
  it("lista vazia dá zeros, sem NaN", () => {
    expect(count([])).toEqual({ n: 0, hit1: 0, hit5: 0, mrr: 0 });
  });
});

describe("abstenção por limiar", () => {
  const points: ScorePoint[] = [
    { score: 0.2, answerable: false },
    { score: 0.3, answerable: false },
    { score: 0.6, answerable: false },
    { score: 0.5, answerable: true },
    { score: 0.7, answerable: true },
  ];

  it("abstém quando o melhor score fica abaixo do limiar e conta acertos e perdas", () => {
    expect(evaluateThreshold(points, 0.4)).toEqual({ threshold: 0.4, abstainedUnanswerable: 2, totalUnanswerable: 3, lostAnswerable: 0, totalAnswerable: 2 });
    expect(evaluateThreshold(points, 0.6)).toEqual({ threshold: 0.6, abstainedUnanswerable: 2, totalUnanswerable: 3, lostAnswerable: 1, totalAnswerable: 2 });
  });

  it("score igual ao limiar não abstém", () => {
    expect(evaluateThreshold([{ score: 0.5, answerable: true }], 0.5).lostAnswerable).toBe(0);
  });

  it("calibra maximizando (abstenções certas − respondíveis perdidas), depois menos perdas, depois menor limiar", () => {
    const best = calibrateThreshold(points);
    expect(best).toMatchObject({ abstainedUnanswerable: 2, lostAnswerable: 0 });
    expect(best?.threshold).toBeCloseTo(0.4, 10);
  });

  it("empate de valor escolhe menos respondíveis perdidas", () => {
    const tie: ScorePoint[] = [
      { score: 0.1, answerable: false },
      { score: 0.5, answerable: true },
      { score: 0.9, answerable: false },
    ];
    // limiar entre 0,1 e 0,5: +1 −0 = 1; limiar acima de 0,9: +2 −1 = 1. Fica o que perde menos.
    const best = calibrateThreshold(tie);
    expect(best).toMatchObject({ abstainedUnanswerable: 1, lostAnswerable: 0 });
  });

  it("sem pontos não há limiar; sem sem-resposta o limiar não abstém", () => {
    expect(calibrateThreshold([])).toBeNull();
    expect(calibrateThreshold([{ score: 0.5, answerable: true }])).toMatchObject({ abstainedUnanswerable: 0, lostAnswerable: 0 });
  });
});
