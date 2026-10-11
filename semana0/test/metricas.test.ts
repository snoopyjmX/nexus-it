import { describe, expect, it } from "vitest";
import { avaliarLimiar, calibrarLimiar, compararHit5, contar, posicao, rrf } from "../src/metricas.js";

const r = (...ids: string[]) => ids.map((id, i) => ({ id, score: 1 - i / 10 }));

describe("posicao", () => {
  it("devolve a posição 1-based da primeira fonte esperada", () => {
    expect(posicao(r("a", "b", "c"), ["c", "b"])).toBe(2);
  });
  it("devolve null quando nenhuma fonte esperada aparece", () => {
    expect(posicao(r("a"), ["z"])).toBeNull();
  });
});

describe("rrf (k=60)", () => {
  it("soma 1/(k+posição) de cada lista", () => {
    const fundido = rrf([r("a", "b"), r("b", "c")]);
    expect(fundido.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(fundido[0]?.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fundido[1]?.score).toBeCloseTo(1 / 61, 10);
  });
  it("desempata por id para o resultado ser reprodutível", () => {
    expect(rrf([r("b"), r("a")]).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("contar", () => {
  it("conta Hit@1, Hit@5 e MRR (posição ausente vale 0)", () => {
    expect(contar([1, 3, 6, null])).toEqual({ n: 4, hit1: 1, hit5: 2, mrr: Number(((1 + 1 / 3 + 1 / 6) / 4).toFixed(3)) });
  });
  it("posição 5 conta no Hit@5 e posição 6 não (limite exato)", () => {
    expect(contar([5]).hit5).toBe(1);
    expect(contar([6]).hit5).toBe(0);
  });
  it("conjunto vazio não divide por zero", () => {
    expect(contar([])).toEqual({ n: 0, hit1: 0, hit5: 0, mrr: 0 });
  });
});

describe("compararHit5", () => {
  it.each([
    [6, 2, "ganha"],
    [2, 6, "perde"],
    [1, 5, "empata"], // as duas acertam no top-5: posição não decide
    [null, 7, "empata"],
    [null, 1, "ganha"],
  ] as const)("lexical %s × outro %s → %s", (base, outro, esperado) => {
    expect(compararHit5(base, outro)).toBe(esperado);
  });
});

describe("limiar de abstenção", () => {
  it("abstém quando o score fica abaixo do limiar", () => {
    const a = avaliarLimiar(
      [{ score: 0.2, temResposta: false }, { score: 0.6, temResposta: false }, { score: 0.5, temResposta: true }],
      0.55,
    );
    expect(a).toMatchObject({ abstemSemResposta: 1, totalSemResposta: 2, perdeRespondivel: 1, totalRespondivel: 1 });
  });

  it("escolhe um limiar que separa os grupos quando eles são separáveis", () => {
    const pontos = [
      { score: 0.2, temResposta: false },
      { score: 0.3, temResposta: false },
      { score: 0.7, temResposta: true },
      { score: 0.8, temResposta: true },
    ];
    const c = calibrarLimiar(pontos);
    expect(c?.limiar).toBeCloseTo(0.5);
    expect(c).toMatchObject({ abstemSemResposta: 2, perdeRespondivel: 0 });
  });

  it("não abstém quando separar custaria mais respondíveis do que acerta", () => {
    const pontos = [
      { score: 0.9, temResposta: false },
      { score: 0.1, temResposta: true },
      { score: 0.2, temResposta: true },
    ];
    expect(calibrarLimiar(pontos)).toMatchObject({ abstemSemResposta: 0, perdeRespondivel: 0 });
  });

  it("sem pontos não inventa limiar", () => {
    expect(calibrarLimiar([])).toBeNull();
  });
});
