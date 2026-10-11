import pino, { type Logger } from "pino";
import type { DestinationStream } from "pino";

// Redaction é a defesa padrão: mesmo que alguém logue o objeto inteiro,
// estes caminhos saem como [REDACTED]. Corpo de requisição nunca é logado.
const REDACT_PATHS = [
  "password",
  "token",
  "*.password",
  "*.token",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body",
  "res.headers['set-cookie']",
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = { level, redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
