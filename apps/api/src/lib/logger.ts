import pino, { type DestinationStream, type Logger } from "pino";

// Defesa em profundidade: nunca logar req/res crus; e, se algo escapar, estes
// caminhos (até dois níveis) saem como [REDACTED]. Corpo nunca é logado.
const SECRET_KEYS = ["password", "token", "sessionToken", "authorization", "cookie", "body"];
const REDACT_PATHS = SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]).concat([
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
]);

// Erros de terceiros (ex.: pg) carregam `detail`, `cause` e stack com dados
// sensíveis. O log guarda só o necessário para diagnosticar.
function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = "code" in error ? String(error.code) : undefined;
  return { type: error.name, message: error.message, ...(code ? { code } : {}) };
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: { err: serializeError },
  };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
