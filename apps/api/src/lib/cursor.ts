import { HttpError } from "./errors.js";

export interface Cursor {
  createdAt: string;
  id: string;
}

// created_at vem como texto do Postgres (`created_at::text`), com a precisão completa.
const PATTERN = /^(\d{4}-\d{2}-\d{2} [\d:.]+[+-]\d{2}(?::\d{2})?)\|([0-9a-f-]{36})$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  const match = PATTERN.exec(Buffer.from(raw, "base64url").toString());
  if (!match) throw new HttpError(400, "Cursor inválido.");
  return { createdAt: match[1] as string, id: match[2] as string };
}
