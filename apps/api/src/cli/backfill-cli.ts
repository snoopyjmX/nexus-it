import { loadConfig } from "../config.js";
import { createPool } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { backfill } from "../modules/embeddings/backfill.js";
import { createOllamaProvider } from "../modules/embeddings/provider.js";

// Uso: EMBEDDINGS_ENABLED=true pnpm embeddings:backfill
// Recalcula os vetores que faltam (Ollama fora do ar ao publicar/resolver) ou que são de outro modelo.
const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
if (!config.EMBEDDINGS_ENABLED) {
  logger.error("EMBEDDINGS_ENABLED não está como true; nada a fazer");
  process.exit(1);
}
const pool = createPool(config.DATABASE_URL);
try {
  const provider = createOllamaProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.EMBEDDING_MODEL, timeoutMs: config.EMBEDDING_TIMEOUT_MS });
  const result = await backfill(pool, provider);
  logger.info(result, "backfill concluído");
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
