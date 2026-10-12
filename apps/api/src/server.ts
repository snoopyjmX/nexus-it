import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, createPool } from "./lib/db.js";
import { createLogger } from "./lib/logger.js";
import { createAuth } from "./modules/auth/index.js";
import type { Embeddings } from "./modules/embeddings/index.js";
import { createOllamaProvider } from "./modules/embeddings/provider.js";
import { createKnowledgeRouters } from "./modules/knowledge/routes.js";
import { createTicketsRouter } from "./modules/tickets/routes.js";
import { createPasswordHasher } from "./modules/auth/password.js";

const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const auth = createAuth({ pool, hasher: createPasswordHasher(), secureCookie: config.NODE_ENV === "production" });
const embeddings: Embeddings | undefined = config.EMBEDDINGS_ENABLED
  ? {
      provider: createOllamaProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.EMBEDDING_MODEL, timeoutMs: config.EMBEDDING_TIMEOUT_MS }),
      minScore: config.VECTOR_MIN_SCORE,
      logger,
    }
  : undefined;
const app = createApp({
  db: createDatabase(pool),
  logger,
  auth,
  tickets: createTicketsRouter({ pool, auth, ...(embeddings ? { embeddings } : {}) }),
  knowledge: createKnowledgeRouters({ pool, auth, ...(embeddings ? { embeddings } : {}) }),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "API no ar");
});

function shutdown(signal: string) {
  logger.info({ signal }, "encerrando");
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
