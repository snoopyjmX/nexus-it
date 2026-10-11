import { afterEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test-db.js";

const original = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = original;
});

describe("trava dos testes destrutivos", () => {
  it("recusa banco cujo nome não termina em _test", () => {
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/nexus";
    expect(() => testDatabaseUrl()).toThrow(/_test/);
  });

  it("explica o que fazer quando DATABASE_URL não existe", () => {
    delete process.env.DATABASE_URL;
    expect(() => testDatabaseUrl()).toThrow(/docker compose up -d db/);
  });
});
