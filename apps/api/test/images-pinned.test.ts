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
  it("o Postgres do CI é exatamente o do compose", () => {
    const image = (path: string) => /^[ \t]*image:[ \t]*(\S+)/m.exec(read(path))?.[1];
    expect(image(".github/workflows/ci.yml")).toBe(image("docker-compose.yml"));
  });

  it("o Dependabot cobre actions, Dockerfile, compose e pacotes (T-09)", () => {
    const config = read(".github/dependabot.yml");
    for (const ecosystem of ["github-actions", "docker", "docker-compose", "npm"]) {
      expect(config).toContain(`package-ecosystem: "${ecosystem}"`);
    }
  });
});
