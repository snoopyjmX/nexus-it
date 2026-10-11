import { describe, expect, it } from "vitest";
import { escolherMetodo, type EntradaEscolha } from "../src/escolher-metodo.js";

// Contagem só com o que a regra lê (Hit@5 e MRR nas paráfrases).
const c = (hit5: number, mrr: number) => ({ n: 10, hit1: 0, hit5, mrr });
const p = (ganha: number, empata: number, perde: number) => ({ ganha, empata, perde });

function entrada(o: {
  vet?: [number, number]; // hit5, mrr nas paráfrases
  hib?: [number, number];
  vetorial?: Record<string, ReturnType<typeof p>>;
  hibrida?: Record<string, ReturnType<typeof p>>;
}): EntradaEscolha {
  const [vh, vm] = o.vet ?? [8, 0.6];
  const [hh, hm] = o.hib ?? [7, 0.5];
  return {
    porTipo: { parafrase: { lexical: c(4, 0.3), vetorial: c(vh, vm), hibrida: c(hh, hm) } },
    comparacao: {
      vetorial: o.vetorial ?? { "tipo:parafrase": p(4, 6, 0), "tipo:direta": p(0, 8, 0) },
      hibrida: o.hibrida ?? { "tipo:parafrase": p(3, 7, 0), "tipo:direta": p(0, 8, 0) },
    },
  };
}

describe("escolherMetodo (criterios.md, busca vetorial/híbrida)", () => {
  it("escolhe a variante de maior Hit@5 nas paráfrases quando ela cumpre o critério", () => {
    expect(escolherMetodo(entrada({})).metodo).toBe("vetorial");
    expect(escolherMetodo(entrada({ vet: [6, 0.5], hib: [8, 0.6] })).metodo).toBe("hibrida");
  });

  it("desempata por MRR nas paráfrases", () => {
    expect(escolherMetodo(entrada({ vet: [7, 0.4], hib: [7, 0.55] })).metodo).toBe("hibrida");
    expect(escolherMetodo(entrada({ vet: [7, 0.55], hib: [7, 0.4] })).metodo).toBe("vetorial");
  });

  it("fica na lexical se a melhor variante supera em menos de 2 paráfrases", () => {
    const r = escolherMetodo(entrada({ vetorial: { "tipo:parafrase": p(1, 9, 0), "tipo:direta": p(0, 8, 0) } }));
    expect(r.metodo).toBe("lexical");
    expect(r.motivo).toMatch(/1/);
  });

  it("aceita 1 perda nas diretas e recusa 2", () => {
    const base = { "tipo:parafrase": p(4, 6, 0) };
    expect(escolherMetodo(entrada({ vetorial: { ...base, "tipo:direta": p(0, 7, 1) } })).metodo).toBe("vetorial");
    expect(escolherMetodo(entrada({ vetorial: { ...base, "tipo:direta": p(0, 6, 2) } })).metodo).toBe("lexical");
  });

  it("recusa 2 ou mais perdas na mesma categoria, mas aceita 1 em cada", () => {
    const base = { "tipo:parafrase": p(4, 6, 0), "tipo:direta": p(0, 8, 0) };
    expect(escolherMetodo(entrada({ vetorial: { ...base, "categoria:vpn": p(0, 4, 2) } })).metodo).toBe("lexical");
    expect(
      escolherMetodo(entrada({ vetorial: { ...base, "categoria:vpn": p(1, 3, 1), "categoria:rede": p(0, 3, 1) } })).metodo,
    ).toBe("vetorial");
  });

  it("avalia o critério só na melhor variante, não na outra", () => {
    // A híbrida cumpriria o critério, mas a vetorial é a melhor e não cumpre: lexical.
    const r = escolherMetodo(
      entrada({
        vet: [9, 0.7],
        hib: [7, 0.5],
        vetorial: { "tipo:parafrase": p(5, 5, 0), "tipo:direta": p(0, 6, 2) },
        hibrida: { "tipo:parafrase": p(3, 7, 0), "tipo:direta": p(0, 8, 0) },
      }),
    );
    expect(r.metodo).toBe("lexical");
  });

  it("usa a lexical quando não há paráfrases na análise", () => {
    expect(escolherMetodo({ porTipo: {}, comparacao: { vetorial: {}, hibrida: {} } }).metodo).toBe("lexical");
  });
});
