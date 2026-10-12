import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../apps/api/src/config.js";
import { createPool } from "../../../apps/api/src/lib/db.js";
import { createLogger } from "../../../apps/api/src/lib/logger.js";
import type { Embeddings } from "../../../apps/api/src/modules/embeddings/index.js";
import { createOllamaProvider } from "../../../apps/api/src/modules/embeddings/provider.js";
import { createOllamaSummaryProvider } from "../../../apps/api/src/modules/diagnosis/summary-provider.js";
import { DEV_DIR, TEST_DIR, loadDataset } from "./dataset.js";
import { loadGenerationCases } from "./generation.js";
import { formatReport } from "./report.js";
import { runEvaluation, saveResult } from "./runner.js";

// Uso: pnpm eval [--set dev|test] [--llm [--rounds N]]
// --llm mede também o resumo do modelo (ADR-008) com LLM_MODEL em OLLAMA_BASE_URL; --rounds padrão 3.
// Usa DATABASE_URL (o banco precisa estar migrado) e, com EMBEDDINGS_ENABLED=true, roda também o modo vetorial.
// O conjunto de teste só é lido; este código nunca escreve em dataset/.
const option = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const set = option("set") ?? "dev";
const rounds = Number(option("rounds") ?? 3);
if ((set !== "dev" && set !== "test") || !Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
  process.stderr.write("Uso: pnpm eval [--set dev|test] [--llm [--rounds 1..10]]\n");
  process.exit(1);
}

const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const embeddings: Embeddings | undefined = config.EMBEDDINGS_ENABLED
  ? {
      provider: createOllamaProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.EMBEDDING_MODEL, timeoutMs: config.EMBEDDING_TIMEOUT_MS }),
      minScore: config.VECTOR_MIN_SCORE,
      logger,
    }
  : undefined;

const pool = createPool(config.DATABASE_URL);
try {
  const dir = set === "dev" ? DEV_DIR : TEST_DIR;
  const dataset = await loadDataset(dir);
  let generation: Parameters<typeof runEvaluation>[0]["generation"];
  if (process.argv.includes("--llm")) {
    const loaded = await loadGenerationCases(dir, dataset);
    generation = {
      provider: createOllamaSummaryProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS }),
      cases: loaded.cases,
      casesVersion: loaded.version,
      rounds,
    };
  }
  const results = await runEvaluation({ databaseUrl: config.DATABASE_URL, dataset, set, nodeEnv: config.NODE_ENV, ...(embeddings ? { embeddings } : {}), ...(generation ? { generation } : {}) });
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../results");
  await mkdir(outDir, { recursive: true });
  for (const result of results) {
    const id = await saveResult(pool, result);
    const stamp = result.environment.date.replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(outDir, `${stamp}-${result.set}-${result.searchMode}.json`);
    await writeFile(file, JSON.stringify(result, null, 2));
    process.stdout.write(`${formatReport(result)}\nGravado em eval_runs (${id}) e em ${file}\n\n`);
  }
} catch (error) {
  logger.fatal({ err: error }, "avaliação falhou");
  process.exitCode = 1;
} finally {
  await pool.end();
}
