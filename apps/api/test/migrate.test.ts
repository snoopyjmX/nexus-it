import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/lib/db.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

const pool: pg.Pool = createPool(testDatabaseUrl());

beforeEach(async () => {
  await resetSchema(pool);
});

afterAll(async () => {
  await pool.end();
});

async function migrationsDir(files: Record<string, string>): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), "nexus-migrations-"));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return pathToFileURL(`${dir}/`);
}

async function appliedNames(): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
  return rows.map((row) => row.name);
}

describe("migrações do projeto (NFR-02)", () => {
  it("aplicam num banco vazio, instalam unaccent e são idempotentes", async () => {
    const first = await migrate(pool);
    expect(first).toContain("0001_extensions.sql");

    const { rows } = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'unaccent'");
    expect(rows).toHaveLength(1);

    expect(await migrate(pool)).toEqual([]);
    expect(await appliedNames()).toEqual(first);
  });
});

describe("runner de migrações", () => {
  it("aplica em ordem e registra cada arquivo", async () => {
    const dir = await migrationsDir({
      "0002_b.sql": "CREATE TABLE b (id int);",
      "0001_a.sql": "CREATE TABLE a (id int);",
    });
    expect(await migrate(pool, dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(await appliedNames()).toEqual(["0001_a.sql", "0002_b.sql"]);
  });

  it("desfaz a migração que falha e não a registra", async () => {
    const dir = await migrationsDir({
      "0001_ok.sql": "CREATE TABLE ok (id int);",
      "0002_quebrada.sql": "CREATE TABLE parcial (id int); SELECT coluna_que_nao_existe FROM ok;",
    });

    await expect(migrate(pool, dir)).rejects.toThrow(/0002_quebrada\.sql/);
    expect(await appliedNames()).toEqual(["0001_ok.sql"]);
    const { rows } = await pool.query("SELECT to_regclass('public.parcial') AS t");
    expect(rows[0].t).toBeNull();
  });

  it("libera o lock: uma segunda execução depois de uma falha não trava", async () => {
    const bad = await migrationsDir({ "0001_x.sql": "SELECT 1/0;" });
    await expect(migrate(pool, bad)).rejects.toThrow();
    const good = await migrationsDir({ "0001_y.sql": "SELECT 1;" });
    await expect(migrate(pool, good)).resolves.toEqual(["0001_y.sql"]);
  });
});
