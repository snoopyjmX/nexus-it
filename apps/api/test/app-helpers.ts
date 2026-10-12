import type pg from "pg";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/lib/db.js";
import { createLogger } from "../src/lib/logger.js";
import { createAuth } from "../src/modules/auth/index.js";
import { createPasswordHasher } from "../src/modules/auth/password.js";
import { createUser, type Role } from "../src/modules/auth/users.js";
import { createTicketsRouter } from "../src/modules/tickets/routes.js";

// Custo baixo só nos testes; o custo real é o do ADR-009.
export const hasher = createPasswordHasher({ N: 1024, r: 8, p: 1 });
export const PASSWORD = "senha-de-teste-123";

export const USERS = {
  tecnico: { email: "tecnico@exemplo.local", displayName: "Técnico Um", role: "technician" },
  tecnico2: { email: "tecnico2@exemplo.local", displayName: "Técnico Dois", role: "technician" },
  ana: { email: "ana@exemplo.local", displayName: "Ana", role: "requester" },
  bia: { email: "bia@exemplo.local", displayName: "Bia", role: "requester" },
} as const satisfies Record<string, { email: string; displayName: string; role: Role }>;

export type UserKey = keyof typeof USERS;

export async function seedUsers(pool: pg.Pool): Promise<void> {
  for (const user of Object.values(USERS)) await createUser(pool, hasher, { ...user, password: PASSWORD });
}

export function buildApp(pool: pg.Pool) {
  const auth = createAuth({ pool, hasher, secureCookie: false });
  const tickets = createTicketsRouter({ pool, auth });
  return createApp({ db: createDatabase(pool), logger: createLogger("silent"), auth, tickets });
}

export type App = ReturnType<typeof buildApp>;

export interface Session {
  id: string;
  cookie: string;
  csrf: string;
}

export async function loginAs(app: App, key: UserKey): Promise<Session> {
  const login = await request(app).post("/api/v1/auth/login").send({ email: USERS[key].email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login de ${key} falhou: ${login.status}`);
  const line = ([] as string[]).concat(login.headers["set-cookie"] ?? []).find((c) => c.startsWith("nexus_sid="));
  const cookie = String(line).split(";")[0] ?? "";
  const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
  return { id: String(login.body.user.id), cookie, csrf: String(me.body.csrfToken) };
}

// Cliente de teste: já manda cookie e token CSRF, como o navegador faria.
export function api(app: App, session: Session) {
  const base = "/api/v1";
  return {
    get: (path: string) => request(app).get(base + path).set("Cookie", session.cookie),
    post: (path: string, body?: object) => request(app).post(base + path).set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).send(body ?? {}),
    patch: (path: string, body?: object) => request(app).patch(base + path).set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).send(body ?? {}),
  };
}
