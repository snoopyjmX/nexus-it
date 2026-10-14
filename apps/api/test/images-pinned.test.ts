import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const DIGEST = /@sha256:[0-9a-f]{64}$/;

// T-10 e T-09: a tag de uma imagem pode mudar sem aviso; o digest não. Atualizar uma imagem é uma mudança
// de código (troca o digest), revisável, e não algo que acontece sozinho no próximo build.
describe("imagens fixadas por digest (T-10)", () => {
  it.each([
    ["docker-compose.yml", /^[ \t]*image:[ \t]*(\S+)/gm],
    [".github/workflows/ci.yml", /^[ \t]*image:[ \t]*(\S+)/gm],
    ["apps/api/Dockerfile", /^FROM[ \t]+(\S+)/gm],
  ] as const)("%s", (path, pattern) => {
    const images = [...read(path).matchAll(pattern)].map((match) => match[1] ?? "");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(DIGEST);
  });

  // O Dependabot não varre o `services.image` do ci.yml: sem esta checagem, o CI poderia testar outro pgvector.
  // Vale para todo job do ci.yml que sobe o Postgres, não só para o primeiro.
  it("todo Postgres do CI é exatamente o do compose", () => {
    const images = (path: string) => [...read(path).matchAll(/^[ \t]*image:[ \t]*(\S+)/gm)].map((match) => match[1]);
    const compose = images("docker-compose.yml");
    expect(compose).toHaveLength(1);
    const ci = images(".github/workflows/ci.yml");
    expect(ci.length).toBeGreaterThan(1);
    for (const image of ci) expect(image).toBe(compose[0]);
  });

  // O Trivy config só entende o Dockerfile (compose e workflows não são configuração que ele reconheça): os
  // controles de T-10 sobre o compose ficam aqui.
  it("o compose não expõe o Postgres na rede nem dá privilégio ao container (T-10)", () => {
    const compose = read("docker-compose.yml").replace(/^\s*#.*$/gm, "");
    expect(compose).not.toMatch(/docker\.sock/);
    expect(compose).not.toMatch(/privileged:\s*true/);
    expect(compose).not.toMatch(/cap_add/);
    const ports = [...compose.matchAll(/^\s*-\s*"?(\d[^"\n]*:\d+)"?\s*$/gm)].map((match) => match[1] ?? "");
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port).toMatch(/^127\.0\.0\.1:/);
  });

  it("o Dependabot cobre actions, Dockerfile, compose e pacotes (T-09)", () => {
    const config = read(".github/dependabot.yml");
    for (const ecosystem of ["github-actions", "docker", "docker-compose", "npm"]) {
      expect(config).toContain(`package-ecosystem: "${ecosystem}"`);
    }
  });
});
