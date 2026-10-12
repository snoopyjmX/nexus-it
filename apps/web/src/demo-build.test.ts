// @vitest-environment node
import { build } from "vite";
import { describe, expect, it } from "vitest";

// ADR-003 / T-17: um VITE_DEMO esquecido no ambiente não pode transformar o build real num que serve só dados gravados.
// Este teste faz o build normal (cerca de 1 s) e olha o que saiu: o ramo da demo e as respostas gravadas não podem estar lá.
async function emitted(env: string | undefined) {
  const before = process.env.VITE_DEMO;
  if (env === undefined) delete process.env.VITE_DEMO;
  else process.env.VITE_DEMO = env;
  try {
    const result = await build({ logLevel: "silent", build: { write: false } });
    const outputs = Array.isArray(result) ? result : [result];
    return outputs.flatMap((output) => ("output" in output ? output.output : [])).map((file) => ("code" in file ? file.code : String(file.source))).join("\n");
  } finally {
    if (before === undefined) delete process.env.VITE_DEMO;
    else process.env.VITE_DEMO = before;
  }
}

describe("build normal", () => {
  it("não leva o código da demo nem as respostas gravadas", async () => {
    const code = await emitted(undefined);
    expect(code.length).toBeGreaterThan(10_000);
    expect(code).not.toContain("não foi gravada");
    expect(code).not.toContain("tecnico@exemplo.local");
    expect(code).not.toContain("só funciona na versão local");
  });

  it("com VITE_DEMO=true leva a demo (o teste acima enxerga a diferença)", async () => {
    const code = await emitted("true");
    expect(code).toContain("não foi gravada");
  });
});
