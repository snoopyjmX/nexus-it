import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { DEV_DIR, loadDataset, validateDataset } from "../src/dataset.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const semana0 = path.join(here, "../../../semana0/dados");

describe("conjunto dev (docs/AI_EVALUATION.md)", () => {
  it("é cópia byte a byte dos dados da Semana 0: nada foi inventado nem editado", () => {
    for (const file of ["corpus.json", "consultas.json", "gold.json"]) {
      expect(readFileSync(path.join(DEV_DIR, file), "utf8"), file).toBe(readFileSync(path.join(semana0, file), "utf8"));
    }
  });

  it("carrega, valida e traz o hash de versão de 12 hexadecimais", async () => {
    const dataset = await loadDataset(DEV_DIR);
    expect(dataset.documents).toHaveLength(40);
    expect(dataset.queries).toHaveLength(30);
    expect(dataset.version).toMatch(/^[0-9a-f]{12}$/);
    expect(dataset.documents.every((d) => d.rascunho_llm)).toBe(true);
  });

  it("tem a mesma versão que a Semana 0 registrou ao medir esses arquivos", async () => {
    const recorded = JSON.parse(readFileSync(path.join(semana0, "../resultados/2026-10-11T23-30-56-busca.json"), "utf8")) as { versaoDados: string };
    expect((await loadDataset(DEV_DIR)).version).toBe(recorded.versaoDados);
  });

  it("a versão é estável e muda se qualquer byte muda", async () => {
    const a = await loadDataset(DEV_DIR);
    expect((await loadDataset(DEV_DIR)).version).toBe(a.version);
    const dir = mkdtempSync(path.join(os.tmpdir(), "eval-ds-"));
    for (const file of ["corpus.json", "consultas.json", "gold.json"]) {
      const text = readFileSync(path.join(DEV_DIR, file), "utf8");
      writeFileSync(path.join(dir, file), file === "gold.json" ? `${text}\n` : text);
    }
    expect((await loadDataset(dir)).version).not.toBe(a.version);
  });
});

describe("validação de consistência", () => {
  const doc = (id: string) => ({ id, tipo: "artigo" as const, categoria: "c", titulo: "t", sintoma: "s", ambiente: "", procedimento: "p", resultado: "", rascunho_llm: false });
  const query = (id: string, tipo: "direta" | "sem_resposta" | "ambigua" = "direta") => ({ id, texto: "x", tipo, categoria: "c", ...(tipo === "sem_resposta" ? { grupo: "calibracao" as const } : {}) });

  it("aceita dados consistentes", () => {
    expect(() => validateDataset([doc("d1")], [query("q1")], { q1: ["d1"] })).not.toThrow();
  });

  it.each([
    ["documento duplicado", [doc("d1"), doc("d1")], [query("q1")], { q1: ["d1"] }, /duplicado/],
    ["consulta sem gold", [doc("d1")], [query("q1")], {}, /sem entrada/],
    ["gold com documento inexistente", [doc("d1")], [query("q1")], { q1: ["zz"] }, /inexistente/],
    ["gold de consulta inexistente", [doc("d1")], [query("q1")], { q1: ["d1"], q2: ["d1"] }, /consulta inexistente/],
    ["sem_resposta com fonte", [doc("d1")], [query("q1", "sem_resposta")], { q1: ["d1"] }, /sem_resposta/],
    ["respondível sem fonte", [doc("d1")], [query("q1")], { q1: [] }, /vazio/],
    ["ambígua com uma fonte só", [doc("d1")], [query("q1", "ambigua")], { q1: ["d1"] }, /ambigua/],
  ])("recusa %s", (_name, documents, queries, gold, message) => {
    expect(() => validateDataset(documents, queries, gold)).toThrow(message);
  });
});
