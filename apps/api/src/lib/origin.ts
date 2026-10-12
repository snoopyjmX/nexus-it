import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defesa em profundidade contra CSRF (T-16), somada ao SameSite=Lax e ao token:
// uma mutação que declara um Origin só passa se for o mesmo host da API.
// Sem Origin (curl, testes) passa; o navegador sempre envia em POST de outro site.
export const rejectCrossOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (origin === undefined) return next();

  let host: string | undefined;
  try {
    host = new URL(origin).host;
  } catch {
    host = undefined;
  }
  if (host !== undefined && host === req.get("host")) return next();
  return next(new HttpError(403, "Origem não permitida."));
};
