import { createHash } from "node:crypto";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { createDatabase, createPool } from "../src/lib/db.js";
import { createLogger } from "../src/lib/logger.js";
import { createAuth, type AuthOptions } from "../src/modules/auth/index.js";
import { createPasswordHasher, type PasswordHasher } from "../src/modules/auth/password.js";
import { createUser } from "../src/modules/auth/users.js";
import { capture } from "./helpers.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

const pool: pg.Pool = createPool(testDatabaseUrl());
const hasher = createPasswordHasher({ N: 1024, r: 8, p: 1 });
const PASSWORD = "senha-de-teste-123";
const HOST = "nexus.test";

beforeEach(async () => {
  await resetSchema(pool);
  await migrate(pool);
  await createUser(pool, hasher, { email: "ana@exemplo.local", displayName: "Ana", role: "technician", password: PASSWORD });
  await createUser(pool, hasher, { email: "bia@exemplo.local", displayName: "Bia", role: "requester", password: PASSWORD });
});

afterAll(async () => {
  await pool.end();
});

function build(options: Partial<AuthOptions> = {}, logger = createLogger("silent")) {
  const auth = createAuth({ pool, hasher, secureCookie: false, ...options });
  return createApp({ db: createDatabase(pool), logger, auth });
}

type App = ReturnType<typeof build>;

function cookieHeader(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const line = (Array.isArray(raw) ? raw : [raw ?? ""]).find((c) => c.startsWith("nexus_sid="));
  if (!line) throw new Error("sem cookie de sessão na resposta");
  return line.split(";")[0] ?? "";
}

function login(app: App, email = "ana@exemplo.local", password = PASSWORD) {
  return request(app).post("/api/v1/auth/login").set("Host", HOST).send({ email, password });
}

async function loggedIn(app: App, email = "ana@exemplo.local") {
  const res = await login(app, email);
  expect(res.status).toBe(200);
  const cookie = cookieHeader(res);
  const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
  return { cookie, csrf: String(me.body.csrfToken) };
}

async function sessionCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM sessions");
  return Number(rows[0]?.n);
}

describe("login (FR-01)", () => {
  it("autentica e devolve só os dados públicos do usuário", async () => {
    const res = await login(build());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: expect.any(String), email: "ana@exemplo.local", displayName: "Ana", role: "technician" },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt/i);
  });

  it("aceita o e-mail com caixa diferente e espaços", async () => {
    const res = await login(build(), "  ANA@Exemplo.Local ");
    expect(res.status).toBe(200);
  });

  it("emite cookie HttpOnly, SameSite=Lax, Path=/ com validade absoluta, sem Secure fora de produção", async () => {
    const res = await login(build());
    const line = String(([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("nexus_sid=")));
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=43200/);
    expect(line).not.toMatch(/Secure/);
  });

  it("marca o cookie como Secure em produção", async () => {
    const res = await login(build({ secureCookie: true }));
    expect(String(res.headers["set-cookie"])).toMatch(/Secure/);
  });

  it("guarda no banco só o hash do token, nunca o token", async () => {
    const token = cookieHeader(await login(build())).slice("nexus_sid=".length);
    const { rows } = await pool.query<{ id_hash: string }>("SELECT id_hash FROM sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(rows[0]?.id_hash).not.toBe(token);
  });

  it("responde igual para senha errada, e-mail inexistente e usuário inativo", async () => {
    const app = build();
    await pool.query("UPDATE users SET active = false WHERE email = 'bia@exemplo.local'");
    const wrong = await login(app, "ana@exemplo.local", "senha-errada-123");
    const unknown = await login(app, "ninguem@exemplo.local");
    const inactive = await login(app, "bia@exemplo.local");
    for (const res of [wrong, unknown, inactive]) {
      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
    expect(unknown.body).toEqual(wrong.body);
    expect(inactive.body).toEqual(wrong.body);
    expect(await sessionCount()).toBe(0);
  });

  it("gasta uma verificação de senha em todos os casos, para o tempo não revelar a conta", async () => {
    const seen: string[] = [];
    const counting: PasswordHasher = {
      ...hasher,
      verify: (password, stored) => {
        seen.push(stored);
        return hasher.verify(password, stored);
      },
    };
    const app = build({ hasher: counting });
    await pool.query("UPDATE users SET active = false WHERE email = 'bia@exemplo.local'");

    for (const [email, password] of [
      ["ana@exemplo.local", PASSWORD],
      ["ana@exemplo.local", "senha-errada-123"],
      ["ninguem@exemplo.local", PASSWORD],
      ["bia@exemplo.local", PASSWORD],
    ] as const) {
      seen.length = 0;
      await login(app, email, password);
      expect(seen, `${email}`).toHaveLength(1);
      // Tem de ser um hash de verdade, com o custo atual: senão o scrypt não roda e o tempo denuncia a conta.
      expect(seen[0], `${email}`).toMatch(/^scrypt\$1024\$8\$1\$/);
    }
  });

  it("refaz o hash no login quando os parâmetros do hasher mudaram", async () => {
    const stronger = createPasswordHasher({ N: 2048, r: 8, p: 1 });
    const res = await login(build({ hasher: stronger }));
    expect(res.status).toBe(200);
    const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'ana@exemplo.local'");
    expect(rows[0]?.password_hash).toMatch(/^scrypt\$2048\$/);
    expect((await login(build({ hasher: stronger }))).status).toBe(200);
  });

  it("valida o corpo com schema estrito (T-03)", async () => {
    const app = build();
    const bodies: unknown[] = [
      {},
      { email: "ana@exemplo.local" },
      { email: "ana@exemplo.local", password: PASSWORD, role: "technician" },
      { email: "ana@exemplo.local", password: 12345678 },
      { email: ["ana@exemplo.local"], password: PASSWORD },
      { email: "ana@exemplo.local", password: "x".repeat(300) },
      { email: `${"a".repeat(300)}@exemplo.local`, password: PASSWORD },
    ];
    for (const body of bodies) {
      const res = await request(app).post("/api/v1/auth/login").set("Host", HOST).send(body as object);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    const form = await request(app).post("/api/v1/auth/login").type("form").send("email=ana@exemplo.local&password=x");
    expect(form.status).toBe(400);
    expect(await sessionCount()).toBe(0);
  });

  it("login repetido cria sessão nova e apaga a anterior (fixação de sessão)", async () => {
    const app = build();
    const first = cookieHeader(await login(app));
    const second = await request(app).post("/api/v1/auth/login").set("Host", HOST).set("Cookie", first).send({ email: "ana@exemplo.local", password: PASSWORD });
    const next = cookieHeader(second);
    expect(next).not.toBe(first);
    expect(await sessionCount()).toBe(1);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", first)).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", next)).status).toBe(200);
  });

  it("remove sessões vencidas de qualquer usuário ao autenticar", async () => {
    const app = build();
    await loggedIn(app, "bia@exemplo.local");
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    await login(app);
    expect(await sessionCount()).toBe(1);
  });
});

describe("sessão e /auth/me (ADR-004)", () => {
  it("sem cookie, com cookie inválido ou malformado → 401", async () => {
    const app = build();
    for (const cookie of [undefined, "nexus_sid=nao-existe", "nexus_sid=%E0%A4%A", "nexus_sid=", "outro=1", "nexus_sid"]) {
      const req = request(app).get("/api/v1/auth/me");
      const res = await (cookie === undefined ? req : req.set("Cookie", cookie));
      expect(res.status, String(cookie)).toBe(401);
      expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    }
  });

  it("devolve o usuário e o token CSRF", async () => {
    const app = build();
    const { cookie } = await loggedIn(app);
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "ana@exemplo.local", role: "technician" });
    expect(res.body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.body)).not.toContain(cookie.slice("nexus_sid=".length));
  });

  it("o token CSRF é estável na sessão e diferente entre sessões", async () => {
    const app = build();
    const a = await loggedIn(app);
    const again = await request(app).get("/api/v1/auth/me").set("Cookie", a.cookie);
    expect(again.body.csrfToken).toBe(a.csrf);
    const b = await loggedIn(app, "bia@exemplo.local");
    expect(b.csrf).not.toBe(a.csrf);
  });

  it("expira por inatividade e apaga a linha", async () => {
    const app = build();
    const { cookie } = await loggedIn(app);
    await pool.query("UPDATE sessions SET idle_expires_at = now() - interval '1 second'");
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });

  it("expira pelo limite absoluto mesmo com atividade", async () => {
    const app = build();
    const { cookie } = await loggedIn(app);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });

  it("renova a inatividade a cada uso, sem passar do limite absoluto", async () => {
    const app = build();
    const { cookie } = await loggedIn(app);
    await pool.query("UPDATE sessions SET idle_expires_at = now() + interval '1 minute'");
    await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    const { rows } = await pool.query<{ renovada: boolean; limitada: boolean }>(
      "SELECT idle_expires_at > now() + interval '25 minutes' AS renovada, idle_expires_at <= expires_at AS limitada FROM sessions",
    );
    expect(rows[0]).toEqual({ renovada: true, limitada: true });
  });

  it("usuário desativado perde a sessão na hora", async () => {
    const app = build();
    const { cookie } = await loggedIn(app);
    await pool.query("UPDATE users SET active = false WHERE email = 'ana@exemplo.local'");
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
  });
});

describe("logout e CSRF (FR-01, T-16)", () => {
  it("sem token CSRF → 403 e a sessão continua valendo", async () => {
    const app = build();
    const { cookie } = await loggedIn(app);
    const res = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(await sessionCount()).toBe(1);
  });

  it("token CSRF errado, de outra sessão ou com tamanho diferente → 403", async () => {
    const app = build();
    const a = await loggedIn(app);
    const b = await loggedIn(app, "bia@exemplo.local");
    for (const csrf of [b.csrf, "0".repeat(64), "curto", ""]) {
      const res = await request(app).post("/api/v1/auth/logout").set("Cookie", a.cookie).set("X-CSRF-Token", csrf);
      expect(res.status, csrf.slice(0, 8)).toBe(403);
    }
    expect(await sessionCount()).toBe(2);
  });

  it("com o token certo invalida a sessão no servidor e limpa o cookie", async () => {
    const app = build();
    const { cookie, csrf } = await loggedIn(app);
    const res = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie).set("X-CSRF-Token", csrf);
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/nexus_sid=;.*Max-Age=0/);
    expect(await sessionCount()).toBe(0);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("logout sem sessão → 401", async () => {
    const res = await request(build()).post("/api/v1/auth/logout").set("X-CSRF-Token", "0".repeat(64));
    expect(res.status).toBe(401);
  });

  it("recusa mutação com Origin de outro host, inclusive no login", async () => {
    const app = build();
    const cross = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", HOST)
      .set("Origin", "http://evil.example")
      .send({ email: "ana@exemplo.local", password: PASSWORD });
    expect(cross.status).toBe(403);
    expect(await sessionCount()).toBe(0);

    const same = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", HOST)
      .set("Origin", `http://${HOST}`)
      .send({ email: "ana@exemplo.local", password: PASSWORD });
    expect(same.status).toBe(200);
  });

  it("recusa Origin ilegível em vez de deixar passar", async () => {
    const res = await request(build())
      .post("/api/v1/auth/login")
      .set("Host", HOST)
      .set("Origin", "isto não é uma url")
      .send({ email: "ana@exemplo.local", password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe("rate limit do login (T-04)", () => {
  it("bloqueia a conta após 5 falhas, mesmo com a senha certa, e avisa quando tentar de novo", async () => {
    const app = build();
    for (let i = 0; i < 5; i++) expect((await login(app, "ana@exemplo.local", "senha-errada-123")).status).toBe(401);
    const blocked = await login(app);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await login(app, "bia@exemplo.local")).status).toBe(200);
  });

  it("conta falhas também para e-mail inexistente, para não revelar quais contas existem", async () => {
    const app = build();
    for (let i = 0; i < 5; i++) expect((await login(app, "ninguem@exemplo.local")).status).toBe(401);
    expect((await login(app, "ninguem@exemplo.local")).status).toBe(429);
  });

  it("login com sucesso não consome o limite da conta", async () => {
    const app = build();
    for (let i = 0; i < 8; i++) expect((await login(app)).status).toBe(200);
  });

  it("limita por IP, com e-mails diferentes, sem gastar scrypt nas tentativas bloqueadas", async () => {
    let calls = 0;
    const counting: PasswordHasher = {
      ...hasher,
      verify: (password, stored) => {
        calls += 1;
        return hasher.verify(password, stored);
      },
    };
    const app = build({ hasher: counting, limits: { ip: { max: 3, windowMs: 60_000 }, account: { max: 5, windowMs: 60_000 } } });
    for (const email of ["a@exemplo.local", "b@exemplo.local", "c@exemplo.local"]) await login(app, email);
    calls = 0;
    const blocked = await login(app, "d@exemplo.local");
    expect(blocked.status).toBe(429);
    expect(calls).toBe(0);
  });
});

describe("log sem segredos (NFR-05, T-11)", () => {
  it("login, /me, logout e falhas não gravam senha, token, CSRF, hash nem e-mail", async () => {
    const sink = capture();
    const app = build({}, createLogger("debug", sink.stream));

    await login(app, "ninguem@exemplo.local", "senha-errada-secreta-1");
    const ok = await login(app);
    const cookie = cookieHeader(ok);
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    await request(app).post("/api/v1/auth/logout").set("Cookie", cookie).set("X-CSRF-Token", me.body.csrfToken);

    const output = sink.read();
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD, "senha-errada-secreta-1", cookie.slice("nexus_sid=".length), String(me.body.csrfToken), "scrypt$", "ana@exemplo.local", "ninguem@exemplo.local"]) {
      expect(output, secret.slice(0, 12)).not.toContain(secret);
    }
  });
});
