import { loadConfig } from "../config.js";
import { createPool } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { migrate } from "./migrate.js";

const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);

try {
  const applied = await migrate(pool);
  logger.info({ applied }, applied.length ? "migrações aplicadas" : "banco já atualizado");
} catch (error) {
  logger.fatal({ err: error }, "migração falhou");
  process.exitCode = 1;
} finally {
  await pool.end();
}
