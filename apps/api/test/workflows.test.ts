import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../../.github/workflows/", import.meta.url);
// Comentários fora: um passo comentado não pode satisfazer um teste de existência.
const read = (name: string) => readFileSync(new URL(name, dir), "utf8").replace(/^\s*#.*$/gm, "");
const workflows = readdirSync(dir)
  .filter((name) => name.endsWith(".yml"))
  .map((name) => [name, read(name)] as const);

// T-17: a CI é parte da superfície de ataque. Vale para todo workflow, inclusive os que ainda vão entrar.
describe.each(workflows)("workflow %s (T-17)", (_name, text) => {
  it("toda action é fixada por SHA de commit de 40 caracteres", () => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it("não usa pull_request_target", () => {
    expect(text).not.toMatch(/pull_request_target/);
  });

  it("o token começa só com leitura do conteúdo, sem escrita no topo nem write-all", () => {
    expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(text).not.toMatch(/write-all/);
    // Escrita no nível do topo (2 espaços) valeria para todos os jobs.
    expect(text).not.toMatch(/^ {2}[a-z-]+: write$/m);
  });

  it("a única escrita permitida é enviar o resultado do scan de código (security-events), só no job", () => {
    const writes = [...text.matchAll(/^( *)([a-z-]+): write$/gm)];
    for (const [, indent, scope] of writes) {
      expect(scope).toBe("security-events");
      expect(indent).toHaveLength(6);
    }
  });

  it("nenhum checkout guarda credenciais no disco", () => {
    const checkouts = text.match(/actions\/checkout@/g)?.length ?? 0;
    expect(text.match(/persist-credentials: false/g)?.length ?? 0).toBe(checkouts);
  });
});

const only = (name: string) => workflows.find(([file]) => file === name)?.[1] ?? "";

describe("os scans de segurança existem (T-10, T-17)", () => {
  it("Trivy verifica a configuração do Dockerfile e falha em HIGH/CRITICAL (ci.yml)", () => {
    const ci = only("ci.yml");
    expect(ci).toMatch(/aquasecurity\/trivy-action@[0-9a-f]{40}/);
    expect(ci).toMatch(/scan-type: config/);
    expect(ci).toMatch(/severity: "HIGH,CRITICAL"/);
    expect(ci).toMatch(/exit-code: "1"/);
  });

  it("CodeQL analisa JavaScript/TypeScript (codeql.yml)", () => {
    const codeql = only("codeql.yml");
    expect(codeql).toMatch(/github\/codeql-action\/init@[0-9a-f]{40}/);
    expect(codeql).toMatch(/github\/codeql-action\/analyze@[0-9a-f]{40}/);
    expect(codeql).toMatch(/languages: javascript-typescript/);
  });
});
