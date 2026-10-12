import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://nexus:pw@127.0.0.1:5432/nexus_test",
};

describe("loadConfig (inicialização falha cedo)", () => {
  it("aceita configuração válida e converte PORT para número", () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("recusa a inicialização sem DATABASE_URL e diz qual variável falta", () => {
    const { DATABASE_URL: _omitted, ...semBanco } = valid;
    expect(() => loadConfig(semBanco)).toThrow(/DATABASE_URL/);
  });

  it("recusa DATABASE_URL que não é postgres", () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("não inclui o valor da DATABASE_URL na mensagem de erro", () => {
    const comSenha = { ...valid, DATABASE_URL: "postgres://u:SENHA_SECRETA@h/db", PORT: "abc" };
    expect(() => loadConfig(comSenha)).toThrow(/PORT/);
    try {
      loadConfig(comSenha);
    } catch (error) {
      expect(String(error)).not.toContain("SENHA_SECRETA");
    }
  });

  it("DIAGNOSIS_THRESHOLD_TRUSTED vale false por padrão (limiar sem recalibração) e aceita só true ou false", () => {
    expect(loadConfig(valid).DIAGNOSIS_THRESHOLD_TRUSTED).toBe(false);
    expect(loadConfig({ ...valid, DIAGNOSIS_THRESHOLD_TRUSTED: "true" }).DIAGNOSIS_THRESHOLD_TRUSTED).toBe(true);
    expect(() => loadConfig({ ...valid, DIAGNOSIS_THRESHOLD_TRUSTED: "talvez" })).toThrow(/DIAGNOSIS_THRESHOLD_TRUSTED/);
  });
});
