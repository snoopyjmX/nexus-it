import { describe, expect, it } from "vitest";
import { summarize } from "../src/cli/bench-password.js";

describe("bench do scrypt (ADR-009)", () => {
  it("dentro de 100–500 ms: mantém o custo", () => {
    expect(summarize([380, 410, 400, 390, 420])).toMatchObject({ medianMs: 400, minMs: 380, maxMs: 420, verdict: "ok" });
  });

  it("acima de 500 ms: manda baixar o N", () => {
    expect(summarize([600, 640, 620]).verdict).toBe("lento");
  });

  it("abaixo de 100 ms: manda subir o N", () => {
    expect(summarize([40, 50, 45]).verdict).toBe("rapido");
  });

  it("mediana de quantidade par usa a média dos dois do meio", () => {
    expect(summarize([100, 200, 300, 400]).medianMs).toBe(250);
  });

  it("sem medidas é erro, não 'ok'", () => {
    expect(() => summarize([])).toThrow();
  });
});
