import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

// T-17: a CI é parte da superfície de ataque. Estas regras valem para todos os jobs, inclusive os que ainda vão entrar.
describe("workflow de CI (T-17)", () => {
  it("toda action é fixada por SHA de commit de 40 caracteres", () => {
    const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it("não usa pull_request_target", () => {
    expect(workflow).not.toMatch(/pull_request_target/);
  });

  it("o token começa só com leitura do conteúdo", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("nenhum checkout guarda credenciais no disco", () => {
    const checkouts = workflow.match(/actions\/checkout@/g)?.length ?? 0;
    const closed = workflow.match(/persist-credentials: false/g)?.length ?? 0;
    expect(closed).toBe(checkouts);
  });
});
