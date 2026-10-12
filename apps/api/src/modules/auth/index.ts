import { randomBytes, timingSafeEqual } from "node:crypto";
import { type RequestHandler, Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { HttpError } from "../../lib/errors.js";
import { createRateLimiter } from "../../lib/rate-limit.js";
import type { PasswordHasher } from "./password.js";
import { ABSOLUTE_SECONDS, COOKIE_NAME, createSessionStore, type ResolvedSession } from "./sessions.js";
import { findForLogin } from "./users.js";

interface Limit {
  max: number;
  windowMs: number;
}

export interface AuthOptions {
  pool: Pick<pg.Pool, "query">;
  hasher: PasswordHasher;
  // Cookie Secure só em produção: em desenvolvimento a API roda em HTTP.
  secureCookie: boolean;
  limits?: { ip: Limit; account: Limit };
}

// Preenchido por requireAuth para as rotas seguintes.
export interface AuthContext extends ResolvedSession {
  token: string;
}

const FIFTEEN_MINUTES = 15 * 60_000;
const DEFAULT_LIMITS = {
  ip: { max: 20, windowMs: FIFTEEN_MINUTES },
  account: { max: 5, windowMs: FIFTEEN_MINUTES },
};

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("=")) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function createAuth({ pool, hasher, secureCookie, limits = DEFAULT_LIMITS }: AuthOptions) {
  const sessions = createSessionStore(pool);
  const ipLimiter = createRateLimiter(limits.ip);
  const accountLimiter = createRateLimiter(limits.account);

  const cookie = (value: string, maxAgeSeconds: number) =>
    `${COOKIE_NAME}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secureCookie ? "; Secure" : ""}`;

  // Hash falso, calculado uma vez com os parâmetros atuais, para que e-mail
  // inexistente gaste o mesmo tempo de uma senha errada (FR-01).
  let dummyHash: Promise<string> | undefined;
  const fakeHash = () => (dummyHash ??= hasher.hash(randomBytes(16).toString("hex")));

  const requireAuth: RequestHandler = async (req, res, next) => {
    const token = readCookie(req.get("cookie"), COOKIE_NAME);
    const session = token ? await sessions.resolve(token) : null;
    if (!token || !session) throw new HttpError(401, "Autenticação necessária.");
    res.locals.auth = { ...session, token } satisfies AuthContext;
    next();
  };

  const requireCsrf: RequestHandler = (req, res, next) => {
    const expected = Buffer.from((res.locals.auth as AuthContext).csrfToken);
    const given = Buffer.from(req.get("x-csrf-token") ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(403, "Token CSRF ausente ou inválido.");
    }
    next();
  };

  const router = Router();

  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Corpo da requisição inválido.");
    const { email, password } = parsed.data;

    const ipKey = req.ip ?? "desconhecido";
    const wait = ipLimiter.retryAfter(ipKey) ?? accountLimiter.retryAfter(email);
    if (wait !== null) {
      throw new HttpError(429, "Muitas tentativas. Tente novamente mais tarde.", { "Retry-After": String(wait) });
    }
    ipLimiter.record(ipKey);

    const user = await findForLogin(pool, email);
    const matches = await hasher.verify(password, user?.passwordHash ?? (await fakeHash()));
    if (!user || !user.active || !matches) {
      // Conta o e-mail informado, exista ou não, para não revelar quais contas existem.
      accountLimiter.record(email);
      throw new HttpError(401, "Credenciais inválidas.");
    }

    if (hasher.needsRehash(user.passwordHash)) {
      await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, await hasher.hash(password)]);
    }

    // ID novo a cada login; a sessão que veio no cookie, se houver, é descartada (fixação).
    const previous = readCookie(req.get("cookie"), COOKIE_NAME);
    if (previous) await sessions.revoke(previous);
    await sessions.purgeExpired();

    const token = await sessions.create(user.id);
    res.set("Set-Cookie", cookie(token, ABSOLUTE_SECONDS));
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
  });

  router.get("/me", requireAuth, (_req, res) => {
    const { user, csrfToken } = res.locals.auth as AuthContext;
    res.json({ user, csrfToken });
  });

  router.post("/logout", requireAuth, requireCsrf, async (_req, res) => {
    await sessions.revoke((res.locals.auth as AuthContext).token);
    res.set("Set-Cookie", cookie("", 0));
    res.status(204).end();
  });

  return { router, requireAuth, requireCsrf };
}

export type Auth = ReturnType<typeof createAuth>;
