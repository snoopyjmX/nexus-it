import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";

const TITLES: Record<number, string> = {
  400: "Bad Request",
  404: "Not Found",
  413: "Content Too Large",
  500: "Internal Server Error",
};

function sendProblem(res: Parameters<RequestHandler>[1], status: number, detail?: string) {
  res
    .status(status)
    .type("application/problem+json")
    .json({ type: "about:blank", title: TITLES[status] ?? "Error", status, ...(detail ? { detail } : {}) });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendProblem(res, 404);
};

// Erros do body-parser trazem `status` e `type`; o resto vira 500 genérico.
// O cliente nunca recebe stack trace nem mensagem interna.
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;

    if (status === 400) return sendProblem(res, 400, "Corpo da requisição inválido.");
    if (status === 413) return sendProblem(res, 413);

    logger.error({ err: error, requestId: res.locals.requestId, path: req.path }, "erro não tratado");
    return sendProblem(res, 500);
  };
}
