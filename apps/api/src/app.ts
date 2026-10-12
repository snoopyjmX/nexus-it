import { randomUUID } from "node:crypto";
import express, { type RequestHandler, type Router } from "express";
import type { Logger } from "pino";
import type { Database } from "./lib/db.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { rejectCrossOrigin } from "./lib/origin.js";
import type { Auth } from "./modules/auth/index.js";

interface AppDeps {
  db: Database;
  logger: Logger;
  // Opcional para os testes de saúde, que não precisam de sessão. O server.ts sempre passa.
  auth?: Auth;
  tickets?: Router;
  knowledge?: { articles: Router; search: Router };
  // Rotas completas sob /api/v1 (/tickets/:id/diagnosis e /diagnosis-runs/...).
  diagnosis?: Router;
  // Laboratório de avaliação, só leitura (FR-12), montado em /api/v1/eval.
  evaluation?: Router;
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

export function createApp({ db, logger, auth, tickets, knowledge, diagnosis, evaluation }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders, requestId, requestLog(logger), rejectCrossOrigin);
  app.use(express.json({ limit: "100kb" }));
  if (auth) app.use("/api/v1/auth", auth.router);
  // Antes do roteador de chamados: /tickets/:id/diagnosis é tratada aqui, com a autenticação da própria rota.
  if (diagnosis) app.use("/api/v1", diagnosis);
  if (evaluation) app.use("/api/v1/eval", evaluation);
  if (tickets) app.use("/api/v1/tickets", tickets);
  if (knowledge) {
    app.use("/api/v1/articles", knowledge.articles);
    app.use("/api/v1/search", knowledge.search);
  }

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
