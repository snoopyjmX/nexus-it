import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, createPool } from "../src/lib/db.js";
import { testDatabaseUrl } from "./test-db.js";

const pool = createPool(testDatabaseUrl());
afterAll(async () => {
  await pool.end();
});

describe("ping do banco (FR-14)", () => {
  it("resolve quando o banco responde", async () => {
    await expect(createDatabase(pool).ping()).resolves.toBeUndefined();
  });

  it("rejeita quando o banco não está acessível", async () => {
    const unreachable = createPool("postgres://nexus:x@127.0.0.1:1/nexus_test");
    await expect(createDatabase(unreachable).ping()).rejects.toThrow();
    await unreachable.end();
  });
});
