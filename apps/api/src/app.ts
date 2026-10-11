import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import type { Logger } from "pino";
import type { Database } from "./lib/db.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

interface AppDeps {
  db: Database;
  logger: Logger;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    // Respostas da API nunca devem ficar em cache (importa a partir da autenticação).
    "Cache-Control": "no-store",
  });
  next();
};

// Aceita o id recebido só se for um UUID, para que texto arbitrário
// (ex.: quebras de linha) nunca chegue ao log.
const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const id = incoming && UUID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.set("X-Request-Id", id);
  next();
};

function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      logger.info({
        requestId: res.locals.requestId,
        method: req.method,
        route: req.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - start),
      });
    });
    next();
  };
}

export function createApp({ db, logger }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders, requestId, requestLog(logger));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health/live", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/v1/health/ready", async (_req, res) => {
    try {
      await db.ping();
      res.json({ status: "ok", checks: { database: "ok" } });
    } catch (error) {
      logger.warn({ err: error, requestId: res.locals.requestId }, "banco indisponível no readiness");
      res.status(503).json({ status: "unavailable", checks: { database: "unavailable" } });
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
