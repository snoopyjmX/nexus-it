import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, createPool } from "./lib/db.js";
import { createLogger } from "./lib/logger.js";

const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const app = createApp({ db: createDatabase(pool), logger });

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
