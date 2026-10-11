import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/lib/logger.js";

function capture() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  return { stream, read: () => output };
}

describe("logger com redaction (NFR-05, T-11)", () => {
  it("nunca grava senha, token, cookie, authorization nem corpo de requisição", () => {
    const sink = capture();
    const logger = createLogger("info", sink.stream);

    logger.info(
      {
        password: "senha-1",
        token: "token-2",
        req: {
          headers: { authorization: "Bearer token-3", cookie: "sid=cookie-4" },
          body: { description: "texto-do-chamado-5" },
        },
        user: { password: "senha-6" },
      },
      "evento",
    );

    const output = sink.read();
    for (const secret of ["senha-1", "token-2", "token-3", "cookie-4", "texto-do-chamado-5", "senha-6"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[REDACTED]");
  });
});
