import { readdir, readFile } from "node:fs/promises";
import type pg from "pg";

const DEFAULT_DIR = new URL("./migrations/", import.meta.url);
// Número arbitrário e fixo: garante que só um processo migre por vez.
const LOCK_ID = 7_341_001;

// Runner propositalmente simples (ADR-006): arquivos .sql numerados, cada um
// numa transação, registrados em schema_migrations. Sem "down": para desfazer,
// cria-se uma nova migração.
export async function migrate(pool: pg.Pool, dir: URL = DEFAULT_DIR): Promise<string[]> {
  const client = await pool.connect();
  let unlockError: Error | undefined;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    try {
      return await applyPending(client, dir);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch((error: Error) => {
        unlockError = error;
      });
    }
  } finally {
    // Se o unlock falhou, a conexão ainda segura o lock: descarta em vez de devolver ao pool.
    client.release(unlockError);
  }
}

async function applyPending(client: pg.PoolClient, dir: URL): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((row) => row.name));
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), "utf8");
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
}
