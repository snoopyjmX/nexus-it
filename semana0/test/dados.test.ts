import path from "node:path";
import { describe, expect, it } from "vitest";
import { carregar, Consulta, validar, type Documento } from "../src/dados.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const doc = (id: string): Documento => ({
  id, tipo: "artigo", categoria: "x", titulo: "t", sintoma: "s", ambiente: "", procedimento: "p", resultado: "", rascunho_llm: false,
});

describe("carregar", () => {
  it("lê corpus, consultas e gold e aplica padrões", async () => {
    const d = await carregar(FIXTURES);
    expect(d.documentos).toHaveLength(3);
    expect(d.documentos[0]?.rascunho_llm).toBe(false);
    expect(d.consultas.map((c) => c.id)).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("avisa quando as quantidades fogem do protocolo, sem bloquear", async () => {
    const d = await carregar(FIXTURES);
    expect(d.avisos).toContain("direta: 1 consultas (protocolo pede 8)");
  });

  it("versão muda quando os dados mudam e é estável quando não mudam", async () => {
    const { mkdtemp, cp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "semana0-"));
    await cp(FIXTURES, dir, { recursive: true });
    const v1 = (await carregar(dir)).versao;
    expect((await carregar(dir)).versao).toBe(v1);
    await writeFile(path.join(dir, "gold.json"), JSON.stringify({ f1: ["kb-vpn-certificado"], f2: ["ch-impressora-fila"], f3: [], f4: [] }));
    expect((await carregar(dir)).versao).not.toBe(v1);
  });

  it("rejeita campo desconhecido (provável erro de digitação)", () => {
    expect(Consulta.safeParse({ id: "a", texto: "t", tipo: "direta", categoria: "c", grupoo: "calibracao" }).success).toBe(false);
  });
});

describe("validar", () => {
  const c = (id: string, tipo: Consulta["tipo"], grupo?: "calibracao" | "validacao"): Consulta => ({
    id, texto: "t", tipo, categoria: "x", ...(grupo ? { grupo } : {}),
  });

  it.each([
    ["consulta sem gold", [c("q1", "direta")], {}, /q1 sem entrada em gold/],
    ["gold com documento inexistente", [c("q1", "direta")], { q1: ["nao-existe"] }, /documento inexistente: nao-existe/],
    ["sem_resposta com fonte", [c("q1", "sem_resposta", "calibracao")], { q1: ["d1"] }, /sem_resposta mas o gold tem fontes/],
    ["respondível sem fonte", [c("q1", "parafrase")], { q1: [] }, /parafrase mas o gold está vazio/],
    ["sem_resposta sem grupo", [c("q1", "sem_resposta")], { q1: [] }, /precisa de grupo/],
    ["ambígua com uma fonte só", [c("q1", "ambigua")], { q1: ["d1"] }, /precisa de 2\+ fontes/],
    ["gold órfão", [c("q1", "direta")], { q1: ["d1"], q9: [] }, /consulta inexistente: q9/],
  ])("%s é erro", (_nome, consultas, gold, erro) => {
    expect(() => validar([doc("d1")], consultas, gold)).toThrow(erro);
  });

  it("documento duplicado é erro", () => {
    expect(() => validar([doc("d1"), doc("d1")], [], {})).toThrow(/documento duplicado: d1/);
  });
});
