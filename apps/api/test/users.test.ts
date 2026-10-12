import type pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../src/cli/seed.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/lib/db.js";
import { createPasswordHasher } from "../src/modules/auth/password.js";
import { createUser } from "../src/modules/auth/users.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

const pool: pg.Pool = createPool(testDatabaseUrl());
const hasher = createPasswordHasher({ N: 1024, r: 8, p: 1 });
const PASSWORD = "senha-de-teste-123";

beforeEach(async () => {
  await resetSchema(pool);
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("criação de usuário (FR-16)", () => {
  it("grava e-mail em minúsculas e só o hash da senha", async () => {
    const user = await createUser(pool, hasher, {
      email: "  Ana@Exemplo.LOCAL ",
      displayName: "Ana",
      role: "technician",
      password: PASSWORD,
    });
    expect(user).toMatchObject({ email: "ana@exemplo.local", displayName: "Ana", role: "technician" });
    expect(JSON.stringify(user)).not.toContain("password");

    const { rows } = await pool.query<{ password_hash: string; active: boolean }>(
      "SELECT password_hash, active FROM users WHERE id = $1",
      [user.id],
    );
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(rows[0]?.password_hash).not.toContain(PASSWORD);
  });

  it("recusa senha com menos de 12 caracteres", async () => {
    await expect(
      createUser(pool, hasher, { email: "a@exemplo.local", displayName: "A", role: "requester", password: "curta-123" }),
    ).rejects.toThrow(/12 caracteres/);
  });

  it("recusa papel inválido e e-mail inválido", async () => {
    await expect(
      createUser(pool, hasher, { email: "a@exemplo.local", displayName: "A", role: "admin" as "requester", password: PASSWORD }),
    ).rejects.toThrow(/papel/i);
    await expect(
      createUser(pool, hasher, { email: "nao-e-email", displayName: "A", role: "requester", password: PASSWORD }),
    ).rejects.toThrow(/e-mail/i);
  });

  it("recusa e-mail repetido, mesmo com caixa diferente", async () => {
    const input = { displayName: "A", role: "requester" as const, password: PASSWORD };
    await createUser(pool, hasher, { ...input, email: "a@exemplo.local" });
    await expect(createUser(pool, hasher, { ...input, email: "A@EXEMPLO.LOCAL" })).rejects.toThrow(/já existe/);
  });

  it("o banco só aceita os dois papéis", async () => {
    await expect(
      pool.query("INSERT INTO users (email, display_name, password_hash, role) VALUES ('x@y.z', 'X', 'h', 'admin')"),
    ).rejects.toThrow();
  });
});

describe("seed (FR-16)", () => {
  it("cria o cenário fictício: 1 técnico e 2 solicitantes", async () => {
    const result = await seed(pool, hasher, { password: PASSWORD, nodeEnv: "development" });
    expect(result.created).toHaveLength(3);
    const { rows } = await pool.query<{ role: string; n: string }>("SELECT role, count(*) AS n FROM users GROUP BY role ORDER BY role");
    expect(rows).toEqual([
      { role: "requester", n: "2" },
      { role: "technician", n: "1" },
    ]);
  });

  it("é repetível: segunda execução não duplica nem falha", async () => {
    await seed(pool, hasher, { password: PASSWORD, nodeEnv: "development" });
    const again = await seed(pool, hasher, { password: PASSWORD, nodeEnv: "development" });
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(3);
    const { rows } = await pool.query("SELECT 1 FROM users");
    expect(rows).toHaveLength(3);
  });

  it("recusa rodar em produção", async () => {
    await expect(seed(pool, hasher, { password: PASSWORD, nodeEnv: "production" })).rejects.toThrow(/produção/);
    const { rows } = await pool.query("SELECT 1 FROM users");
    expect(rows).toHaveLength(0);
  });

  it("exige a senha do seed, sem valor padrão", async () => {
    await expect(seed(pool, hasher, { password: undefined, nodeEnv: "development" })).rejects.toThrow(/SEED_PASSWORD/);
    await expect(seed(pool, hasher, { password: "curta", nodeEnv: "development" })).rejects.toThrow(/12 caracteres/);
  });
});
