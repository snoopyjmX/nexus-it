import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/lib/logger.js";
import { Writable } from "node:stream";
import { capture } from "./helpers.js";

const silent = createLogger("silent", new Writable({ write: (_c, _e, cb) => cb() }));
const healthyDb = { ping: async () => undefined };
const brokenDb = {
  ping: async () => {
    throw new Error("connection refused at 10.0.0.5:5432 password=x");
  },
};

describe("health (FR-14)", () => {
  it("live responde 200 sem depender do banco", async () => {
    const app = createApp({ db: brokenDb, logger: silent });
    const res = await request(app).get("/api/v1/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("ready responde 200 quando o banco responde", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const res = await request(app).get("/api/v1/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: "ok" } });
  });

  it("ready responde 503 quando o banco falha, sem expor o erro interno", async () => {
    const app = createApp({ db: brokenDb, logger: silent });
    const res = await request(app).get("/api/v1/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", checks: { database: "unavailable" } });
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|password/);
  });
});

describe("erros em problem+json (RFC 9457)", () => {
  it("rota inexistente responde 404 em problem+json", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const res = await request(app).get("/api/v1/nao-existe");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, title: "Not Found" });
  });

  it("JSON malformado responde 400 sem stack trace", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const res = await request(app)
      .post("/api/v1/health/live")
      .set("content-type", "application/json")
      .send('{"quebrado":');
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|stack/i);
  });

  it("corpo acima do limite responde 413", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const res = await request(app)
      .post("/api/v1/health/live")
      .set("content-type", "application/json")
      .send(JSON.stringify({ x: "a".repeat(200_000) }));
    expect(res.status).toBe(413);
  });
});

describe("cabeçalhos de segurança e correlação", () => {
  it("não revela o framework e envia cabeçalhos de segurança", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const res = await request(app).get("/api/v1/health/live");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("devolve um x-request-id e reaproveita um id válido recebido", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const gerado = await request(app).get("/api/v1/health/live");
    expect(gerado.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const id = "8f14e45f-ceea-4672-9b0c-6a7c8e9d1b2a";
    const reaproveitado = await request(app).get("/api/v1/health/live").set("x-request-id", id);
    expect(reaproveitado.headers["x-request-id"]).toBe(id);
  });

  it("ignora x-request-id que não é UUID (evita texto arbitrário no log)", async () => {
    const app = createApp({ db: healthyDb, logger: silent });
    const res = await request(app)
      .get("/api/v1/health/live")
      .set("x-request-id", '", "level":60, "msg":"falso');
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("log de requisição (NFR-05, NFR-07)", () => {
  it("registra método, rota, status e duração sem corpo, cookie, authorization ou query", async () => {
    const sink = capture();
    const app = createApp({ db: healthyDb, logger: createLogger("info", sink.stream) });

    await request(app)
      .post("/api/v1/health/live?access_token=segredo-query")
      .set("cookie", "sid=segredo-cookie")
      .set("authorization", "Bearer segredo-auth")
      .send({ description: "segredo-corpo" });

    const output = sink.read();
    expect(output).toMatch(/"method":"POST"/);
    expect(output).toMatch(/"route":"\/api\/v1\/health\/live"/);
    expect(output).toMatch(/"durationMs":\d+/);
    for (const leaked of ["segredo-query", "segredo-cookie", "segredo-auth", "segredo-corpo"]) {
      expect(output).not.toContain(leaked);
    }
  });

});
