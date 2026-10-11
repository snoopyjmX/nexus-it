import { describe, expect, it } from "vitest";
import { analisar, relatorio, type Rankings } from "../src/analise.js";
import type { Consulta } from "../src/dados.js";

const r = (...pares: [string, number][]) => pares.map(([id, score]) => ({ id, score }));
const r2 = (...pares: [string, number][]) => pares.map(([id, score]) => ({ id, score }));
const consultas: Consulta[] = [
  { id: "q1", texto: "", tipo: "parafrase", categoria: "vpn", grupo: "calibracao" },
  { id: "q2", texto: "", tipo: "direta", categoria: "vpn", grupo: "validacao" },
  { id: "q3", texto: "", tipo: "sem_resposta", categoria: "rede", grupo: "calibracao" },
  { id: "q4", texto: "", tipo: "sem_resposta", categoria: "rede", grupo: "validacao" },
];
const gold = { q1: ["d1"], q2: ["d2"], q3: [], q4: [] };
const rankings = new Map<string, Rankings>([
  ["q1", { lexical: [], vetorial: r(["d1", 0.8]), hibrida: r(["d1", 0.016]) }],
  ["q2", { lexical: r(["d2", 0.5]), vetorial: r(["d9", 0.6], ["d2", 0.55]), hibrida: r(["d2", 0.03]) }],
  ["q3", { lexical: [], vetorial: r(["d1", 0.3]), hibrida: r(["d1", 0.016]) }],
  ["q4", { lexical: [], vetorial: r(["d2", 0.35]), hibrida: r(["d2", 0.016]) }],
]);

describe("analisar", () => {
  const a = analisar(consultas, gold, rankings);

  it("mede só respondíveis nas tabelas por tipo e categoria", () => {
    expect(Object.keys(a.porTipo)).toEqual(["direta", "parafrase"]);
    expect(a.porTipo.parafrase?.lexical).toMatchObject({ n: 1, hit5: 0 });
    expect(a.porCategoria.vpn?.vetorial).toMatchObject({ n: 2, hit1: 1, hit5: 2 });
  });

  it("compara cada método com a lexical por Hit@5", () => {
    expect(a.porConsulta.find((l) => l.id === "q1")?.vetorialVsLexical).toBe("ganha");
    expect(a.porConsulta.find((l) => l.id === "q2")?.vetorialVsLexical).toBe("empata");
    expect(a.comparacao.vetorial["tipo:parafrase"]).toEqual({ ganha: 1, empata: 0, perde: 0 });
    expect(a.porConsulta.find((l) => l.id === "q3")?.vetorialVsLexical).toBeNull();
    expect(a.comparacao.vetorial["categoria:vpn"]).toEqual({ ganha: 1, empata: 1, perde: 0 });
  });

  it("placar por categoria só conta diretas e paráfrases", () => {
    const amb: Consulta = { id: "q5", texto: "", tipo: "ambigua", categoria: "vpn" };
    const r = new Map(rankings).set("q5", { lexical: [], vetorial: r2(["d1", 0.9], ["d2", 0.8]), hibrida: [] });
    const b = analisar([...consultas, amb], { ...gold, q5: ["d1", "d2"] }, r);
    expect(b.comparacao.vetorial["categoria:vpn"]).toEqual({ ganha: 1, empata: 1, perde: 0 });
    expect(b.comparacao.vetorial["tipo:ambigua"]).toEqual({ ganha: 1, empata: 0, perde: 0 });
    expect(b.porConsulta.find((l) => l.id === "q5")?.esperadasNoTop5).toEqual({ lexical: 0, vetorial: 2, hibrida: 0 });
    expect(relatorio(b)).toContain("| q5 | 2 | 0/2 | 2/2 | 0/2 |");
  });

  it("calibra o limiar num grupo e confere no outro", () => {
    const v = a.abstencao.vetorial;
    expect(v.calibracao).toMatchObject({ abstemSemResposta: 1, perdeRespondivel: 0 });
    expect(v.validacao).toMatchObject({ abstemSemResposta: 1, totalSemResposta: 1, perdeRespondivel: 0, totalRespondivel: 1 });
  });

  it("gera o relatório com tabela consulta a consulta e sem veredito", () => {
    const md = relatorio(a);
    expect(md).toContain("| q1 | parafrase | vpn | — | 1 | 1 | ganha | ganha |");
    expect(md).toContain("Score não é probabilidade");
    expect(md).toContain("O veredito (passou / não passou / inconclusivo) vai em decisao.md");
  });

  it("falha se faltar ranking de alguma consulta", () => {
    expect(() => analisar(consultas, gold, new Map())).toThrow(/Sem ranking para q1/);
  });
});
