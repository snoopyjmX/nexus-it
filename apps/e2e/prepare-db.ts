import "../api/test/setup.js";
import { seed } from "../api/src/cli/seed.js";
import { migrate } from "../api/src/db/migrate.js";
import { createPool } from "../api/src/lib/db.js";
import { createPasswordHasher } from "../api/src/modules/auth/password.js";
import { resetSchema, testDatabaseUrl } from "../api/test/test-db.js";
import { PASSWORD } from "./env.js";

// Banco limpo e semeado a cada execução. testDatabaseUrl() recusa qualquer banco que não seja local e _test.
const pool = createPool(testDatabaseUrl());
try {
  await resetSchema(pool);
  await pool.query("CREATE EXTENSION IF NOT EXISTS unaccent");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await migrate(pool);
  await seed(pool, createPasswordHasher(), { password: PASSWORD, nodeEnv: "test" });
} finally {
  await pool.end();
}
