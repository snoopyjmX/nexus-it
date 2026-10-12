import { loadConfig } from "../config.js";
import { createPool } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { createPasswordHasher } from "../modules/auth/password.js";
import { UserInputError } from "../modules/auth/users.js";
import { seed } from "./seed.js";

const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);

try {
  const result = await seed(pool, createPasswordHasher(), { password: process.env.SEED_PASSWORD, nodeEnv: config.NODE_ENV });
  logger.info(result, "seed concluído");
} catch (error) {
  if (error instanceof UserInputError) logger.error(error.message);
  else logger.fatal({ err: error }, "seed falhou");
  process.exitCode = 1;
} finally {
  await pool.end();
}
