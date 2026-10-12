import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  413: "Content Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

// Erro esperado, com status e texto seguros para o cliente. Qualquer outro erro
// vira 500 genérico.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? `HTTP ${status}`);
  }
}

function sendProblem(res: Parameters<RequestHandler>[1], status: number, detail?: string) {
  res
    .status(status)
    .type("application/problem+json")
    .json({ type: "about:blank", title: TITLES[status] ?? "Error", status, ...(detail ? { detail } : {}) });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendProblem(res, 404);
};

function bodyParserType(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "type" in error ? String(error.type) : undefined;
}

// Só os erros conhecidos do body-parser viram 4xx (identificados pelo `type`,
// não só pelo `status`). Todo o resto é 500 genérico e vai para o log.
// O cliente nunca recebe stack trace nem mensagem interna.
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    if (error instanceof HttpError) {
      res.set(error.headers);
      return sendProblem(res, error.status, error.detail);
    }
    const type = bodyParserType(error);
    if (type === "entity.parse.failed") return sendProblem(res, 400, "Corpo da requisição inválido.");
    if (type === "entity.too.large") return sendProblem(res, 413);

    logger.error({ err: error, requestId: res.locals.requestId, path: req.path }, "erro não tratado");
    return sendProblem(res, 500);
  };
}
