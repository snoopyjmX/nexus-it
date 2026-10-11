import { readdir, readFile } from "node:fs/promises";
import type pg from "pg";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);
// Número arbitrário e fixo: garante que só um processo migre por vez.
const LOCK_ID = 7_341_001;

// Runner propositalmente simples: arquivos .sql numerados, cada um numa
// transação, registrados em schema_migrations. Sem "down": para desfazer,
// cria-se uma nova migração.
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();

    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migração ${file}`, { cause: error });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
