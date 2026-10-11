import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../src/lib/errors.js";
import { createLogger } from "../src/lib/logger.js";
import { capture } from "./helpers.js";

function appThatThrows(error: unknown) {
  const sink = capture();
  const app = express();
  app.get("/", () => {
    throw error;
  });
  app.use(errorHandler(createLogger("info", sink.stream)));
  return { app, read: sink.read };
}

describe("errorHandler", () => {
  it("só trata como 400 o erro de parse do body-parser", async () => {
    const { app } = appThatThrows(Object.assign(new Error("x"), { status: 400, type: "entity.parse.failed" }));
    const res = await request(app).get("/");
    expect(res.status).toBe(400);
  });

  it("erro interno que por acaso tem status 400 vira 500 e é registrado", async () => {
    const { app, read } = appThatThrows(Object.assign(new Error("bug interno"), { status: 400 }));
    const res = await request(app).get("/");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ type: "about:blank", title: "Internal Server Error", status: 500 });
    expect(read()).toContain("bug interno");
  });

  it("valor lançado que não é Error vira 500 genérico", async () => {
    const { app } = appThatThrows("string solta");
    const res = await request(app).get("/");
    expect(res.status).toBe(500);
  });
});
