import { describe, expect, it } from "vitest";
import { createPasswordHasher, DEFAULT_PARAMS } from "../src/modules/auth/password.js";

// Custo baixo só nos testes; o custo real é DEFAULT_PARAMS (ADR-009).
const cheap = createPasswordHasher({ N: 1024, r: 8, p: 1 });

describe("hash de senha (FR-01, ADR-009)", () => {
  it("guarda algoritmo, parâmetros e sal no próprio hash, sem a senha", async () => {
    const stored = await cheap.hash("uma-senha-longa-123");
    expect(stored).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain("uma-senha-longa-123");
  });

  it("usa sal diferente a cada hash", async () => {
    const [a, b] = await Promise.all([cheap.hash("mesma-senha-123"), cheap.hash("mesma-senha-123")]);
    expect(a).not.toBe(b);
  });

  it("aceita a senha certa e recusa a errada", async () => {
    const stored = await cheap.hash("senha-correta-123");
    expect(await cheap.verify("senha-correta-123", stored)).toBe(true);
    expect(await cheap.verify("senha-correta-124", stored)).toBe(false);
    expect(await cheap.verify("", stored)).toBe(false);
  });

  it("verifica com os parâmetros do hash, não os do hasher atual", async () => {
    const stored = await cheap.hash("senha-correta-123");
    const other = createPasswordHasher({ N: 2048, r: 8, p: 1 });
    expect(await other.verify("senha-correta-123", stored)).toBe(true);
  });

  it("devolve false, sem lançar, para hash malformado ou de outro algoritmo", async () => {
    for (const stored of ["", "lixo", "bcrypt$10$abc", "scrypt$1024$8$1$so-quatro-partes", "scrypt$x$8$1$AAAA$BBBB"]) {
      expect(await cheap.verify("qualquer-coisa-123", stored)).toBe(false);
    }
  });

  it("recusa parâmetros absurdos no hash em vez de gastar memória (DoS)", async () => {
    const hostile = "scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(await cheap.verify("qualquer-coisa-123", hostile)).toBe(false);
  });

  it("indica refazer o hash quando os parâmetros mudaram", async () => {
    const stored = await cheap.hash("senha-correta-123");
    expect(cheap.needsRehash(stored)).toBe(false);
    expect(createPasswordHasher({ N: 2048, r: 8, p: 1 }).needsRehash(stored)).toBe(true);
    expect(cheap.needsRehash("lixo")).toBe(true);
  });

  it("os parâmetros padrão seguem o ADR-009", () => {
    expect(DEFAULT_PARAMS).toEqual({ N: 2 ** 16, r: 8, p: 2 });
  });
});
