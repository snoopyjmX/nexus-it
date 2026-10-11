import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/lib/db.js";
import { migrate } from "../src/db/migrate.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

let pool: pg.Pool;

beforeAll(async () => {
  pool = createPool(testDatabaseUrl());
  await resetSchema(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("migrações (NFR-02)", () => {
  it("aplica as migrações num banco vazio e instala vector e unaccent", async () => {
    const applied = await migrate(pool);
    expect(applied.length).toBeGreaterThan(0);

    const { rows } = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname",
      [["unaccent", "vector"]],
    );
    expect(rows.map((r) => r.extname)).toEqual(["unaccent", "vector"]);
  });

  it("é idempotente: rodar de novo não reaplica nada", async () => {
    const appliedAgain = await migrate(pool);
    expect(appliedAgain).toEqual([]);
  });

  it("registra cada migração aplicada", async () => {
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows[0]?.name).toBe("0001_extensions.sql");
  });
});

describe("ping do banco (FR-14)", () => {
  it("resolve quando o banco responde", async () => {
    const { createDatabase } = await import("../src/lib/db.js");
    await expect(createDatabase(pool).ping()).resolves.toBeUndefined();
  });
});
