import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../apps/api/src/config.js";
import { createPool } from "../../../apps/api/src/lib/db.js";
import { createLogger } from "../../../apps/api/src/lib/logger.js";
import type { Embeddings } from "../../../apps/api/src/modules/embeddings/index.js";
import { createOllamaProvider } from "../../../apps/api/src/modules/embeddings/provider.js";
import { DEV_DIR, TEST_DIR, loadDataset } from "./dataset.js";
import { formatReport } from "./report.js";
import { runEvaluation, saveResult } from "./runner.js";

// Uso: pnpm eval [--set dev|test]
// Usa DATABASE_URL (o banco precisa estar migrado) e, com EMBEDDINGS_ENABLED=true, roda também o modo vetorial.
// O conjunto de teste só é lido; este código nunca escreve em dataset/.
const setIndex = process.argv.indexOf("--set");
const set = setIndex === -1 ? "dev" : process.argv[setIndex + 1];
if (set !== "dev" && set !== "test") {
  process.stderr.write("Uso: pnpm eval [--set dev|test]\n");
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
  const dataset = await loadDataset(set === "dev" ? DEV_DIR : TEST_DIR);
  const results = await runEvaluation({ databaseUrl: config.DATABASE_URL, dataset, set, nodeEnv: config.NODE_ENV, ...(embeddings ? { embeddings } : {}) });
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
