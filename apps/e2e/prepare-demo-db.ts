import "../api/test/setup.js";
import { readdirSync, readFileSync } from "node:fs";
import { seed } from "../api/src/cli/seed.js";
import { migrate } from "../api/src/db/migrate.js";
import { createPool } from "../api/src/lib/db.js";
import { createPasswordHasher } from "../api/src/modules/auth/password.js";
import { insertTicket } from "../api/src/modules/tickets/store.js";
import { resetSchema, testDatabaseUrl } from "../api/test/test-db.js";
import { DEV_DIR, loadDataset } from "../../packages/evaluation/src/dataset.js";
import type { EvalResult } from "../../packages/evaluation/src/result.js";
import { saveResult, seedCorpus, TICKET_CATEGORY } from "../../packages/evaluation/src/runner.js";
import { demoQueries } from "./demo/scenario.js";
import { PASSWORD, USERS } from "./env.js";

// Banco para gravar a demonstração (ADR-003): usuários do seed, o corpus dev como base publicada e chamados resolvidos,
// quatro chamados abertos com texto de consultas dev e as execuções de avaliação que já estão em packages/evaluation/results.
// testDatabaseUrl() recusa qualquer banco que não seja local e _test.
const pool = createPool(testDatabaseUrl());
try {
  await resetSchema(pool);
  await pool.query("CREATE EXTENSION IF NOT EXISTS unaccent");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await migrate(pool);
  await seed(pool, createPasswordHasher(), { password: PASSWORD, nodeEnv: "test" });

  await seedCorpus(pool, (await loadDataset(DEV_DIR)).documents);

  const requester = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [USERS.requester1]);
  const requesterId = requester.rows[0]?.id;
  if (!requesterId) throw new Error("O seed não criou o solicitante");
  for (const query of demoQueries()) {
    await insertTicket(pool, requesterId, { title: query.texto, description: query.texto, category: TICKET_CATEGORY[query.categoria] ?? "other" });
  }

  const results = new URL("../../packages/evaluation/results/", import.meta.url);
  for (const file of readdirSync(results).filter((name) => name.endsWith(".json")).sort()) {
    await saveResult(pool, JSON.parse(readFileSync(new URL(file, results), "utf8")) as EvalResult);
  }
} finally {
  await pool.end();
}
