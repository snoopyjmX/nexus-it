import { describe, expect, it } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import { capture } from "./helpers.js";

describe("logger com redaction (NFR-05, T-11)", () => {
  it("não grava segredos no nível raiz nem um ou dois níveis abaixo", () => {
    const sink = capture();
    const logger = createLogger("info", sink.stream);

    logger.info(
      {
        password: "segredo-1",
        token: "segredo-2",
        sessionToken: "segredo-3",
        headers: { authorization: "Bearer segredo-4", cookie: "sid=segredo-5" },
        req: { headers: { authorization: "segredo-6", cookie: "segredo-7" }, body: { x: "segredo-8" } },
        body: { description: "segredo-9" },
        user: { password: "segredo-10", credentials: { password: "segredo-11", token: "segredo-12" } },
      },
      "evento",
    );

    const output = sink.read();
    for (let i = 1; i <= 12; i++) expect(output).not.toContain(`segredo-${i}`);
  });

  it("serializa erro só com tipo, código e mensagem — sem cause, detail ou stack", () => {
    const sink = capture();
    const logger = createLogger("info", sink.stream);
    const error = Object.assign(new Error("duplicate key", { cause: new Error("postgres://u:SENHA@h/db") }), {
      code: "23505",
      detail: "Key (email)=(ana@exemplo.com) already exists.",
    });

    logger.error({ err: error }, "falhou");

    const output = sink.read();
    expect(output).toContain("duplicate key");
    expect(output).toContain("23505");
    for (const leaked of ["SENHA", "ana@exemplo.com", "at "]) expect(output).not.toContain(leaked);
  });
});
