import { cpus } from "node:os";
import { pathToFileURL } from "node:url";
import { createPasswordHasher, DEFAULT_PARAMS } from "../modules/auth/password.js";

const TARGET_MS = { min: 100, max: 500 };

export function summarize(timesMs: number[]) {
  if (timesMs.length === 0) throw new Error("sem medidas");
  const sorted = [...timesMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
  const verdict = medianMs > TARGET_MS.max ? "lento" : medianMs < TARGET_MS.min ? "rapido" : "ok";
  return { medianMs, minMs: sorted[0] as number, maxMs: sorted.at(-1) as number, verdict } as const;
}

// Uso: pnpm auth:bench. Mede o hash de senha com os parâmetros atuais (ADR-009) nesta máquina.
async function main() {
  const hasher = createPasswordHasher();
  await hasher.hash("aquecimento");
  const times: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now();
    await hasher.hash("senha-de-medicao");
    times.push(performance.now() - start);
  }
  const result = summarize(times);
  const advice = {
    ok: "Dentro do alvo (100–500 ms). Mantenha os parâmetros.",
    lento: `Acima de ${TARGET_MS.max} ms. Baixe N de 2^16 para 2^15 em DEFAULT_PARAMS (password.ts) e registre no ADR-009. Hashes antigos são refeitos no login.`,
    rapido: `Abaixo de ${TARGET_MS.min} ms. Considere subir N para 2^17 e registrar no ADR-009.`,
  }[result.verdict];
  process.stdout.write(
    [
      `CPU: ${cpus()[0]?.model ?? "desconhecida"} (${cpus().length} núcleos)`,
      `Parâmetros: N=${DEFAULT_PARAMS.N} r=${DEFAULT_PARAMS.r} p=${DEFAULT_PARAMS.p}`,
      `10 hashes: mediana ${result.medianMs.toFixed(0)} ms, mínimo ${result.minMs.toFixed(0)} ms, máximo ${result.maxMs.toFixed(0)} ms`,
      advice,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
