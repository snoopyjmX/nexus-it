import type pg from "pg";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/lib/db.js";
import { api, buildApp, loginAs, seedUsers, type App, type Session } from "./app-helpers.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

const pool: pg.Pool = createPool(testDatabaseUrl());
let app: App;
let ana: Session;
let bia: Session;
let tecnico: Session;
let tecnico2: Session;

beforeEach(async () => {
  await resetSchema(pool);
  await migrate(pool);
  await seedUsers(pool);
  app = buildApp(pool);
  [ana, bia, tecnico, tecnico2] = await Promise.all([loginAs(app, "ana"), loginAs(app, "bia"), loginAs(app, "tecnico"), loginAs(app, "tecnico2")]);
});

afterAll(async () => {
  await pool.end();
});

const NEW_TICKET = { title: "Impressora não imprime", description: "Fila trava no setor 3.", category: "hardware" };

async function openTicket(as: Session = ana, body: object = NEW_TICKET): Promise<string> {
  const res = await api(app, as).post("/tickets", body);
  expect(res.status).toBe(201);
  return String(res.body.id);
}

// Leva o chamado até o estado pedido, usando só a API.
async function advance(id: string, to: "in_progress" | "waiting_requester" | "resolved" | "closed") {
  const t = api(app, tecnico);
  expect((await t.post(`/tickets/${id}/transitions`, { to: "in_progress" })).status).toBe(200);
  if (to === "waiting_requester") expect((await t.post(`/tickets/${id}/transitions`, { to, comment: "Qual o patrimônio?" })).status).toBe(200);
  if (to === "resolved" || to === "closed") expect((await t.post(`/tickets/${id}/transitions`, { to: "resolved", resolutionNote: "Cabo trocado." })).status).toBe(200);
  if (to === "closed") expect((await t.post(`/tickets/${id}/transitions`, { to: "closed" })).status).toBe(200);
}

describe("abertura e papéis (FR-02, FR-03)", () => {
  it("exige sessão e token CSRF", async () => {
    expect((await request(app).get("/api/v1/tickets")).status).toBe(401);
    expect((await request(app).post("/api/v1/tickets").set("Cookie", ana.cookie).send(NEW_TICKET)).status).toBe(403);
  });

  it("toda rota que altera exige o token CSRF (403 sem ele)", async () => {
    const id = await openTicket();
    const noCsrf = (method: "post" | "patch", path: string, body: object) => request(app)[method](`/api/v1${path}`).set("Cookie", tecnico.cookie).send(body);
    expect((await noCsrf("patch", `/tickets/${id}`, { version: 1, priority: "high" })).status).toBe(403);
    expect((await noCsrf("post", `/tickets/${id}/transitions`, { to: "in_progress" })).status).toBe(403);
    expect((await noCsrf("post", `/tickets/${id}/comments`, { body: "oi" })).status).toBe(403);
    expect((await api(app, tecnico).get(`/tickets/${id}`)).body).toMatchObject({ status: "open", priority: "medium", version: 1 });
  });

  it("técnico não abre chamado (403)", async () => {
    expect((await api(app, tecnico).post("/tickets", NEW_TICKET)).status).toBe(403);
  });

  it("o dono é a sessão e o status inicial é open; campos extras são recusados", async () => {
    const res = await api(app, ana).post("/tickets", NEW_TICKET);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "open", priority: "medium", version: 1, requester: { id: ana.id }, assignee: null });
    for (const extra of [{ requesterId: bia.id }, { status: "closed" }, { priority: "urgent" }, { assigneeId: tecnico.id }]) {
      expect((await api(app, ana).post("/tickets", { ...NEW_TICKET, ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
  });

  it("valida título, descrição e categoria", async () => {
    for (const bad of [{ title: "" }, { title: "x".repeat(121) }, { description: "" }, { category: "outra" }, { title: 5 }]) {
      expect((await api(app, ana).post("/tickets", { ...NEW_TICKET, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("grava o evento de criação na mesma operação", async () => {
    const id = await openTicket();
    const events = await api(app, ana).get(`/tickets/${id}/events`);
    expect(events.body.items).toHaveLength(1);
    expect(events.body.items[0]).toMatchObject({ type: "created", actor: { id: ana.id }, payload: {} });
  });
});

describe("listagem com escopo do servidor (FR-03)", () => {
  it("solicitante só vê os próprios; técnico vê todos", async () => {
    const a = await openTicket(ana);
    const b = await openTicket(bia);
    const ids = async (s: Session, qs = "") => ((await api(app, s).get(`/tickets${qs}`)).body.items as { id: string }[]).map((t) => t.id).sort();
    expect(await ids(ana)).toEqual([a]);
    expect(await ids(bia)).toEqual([b]);
    expect(await ids(tecnico)).toEqual([a, b].sort());
  });

  it("filtro não vaza o escopo: solicitante filtrando por status de outro dono continua só com os seus", async () => {
    await openTicket(ana);
    await openTicket(bia);
    const res = await api(app, ana).get("/tickets?status=open");
    expect(res.body.items).toHaveLength(1);
  });

  it("filtra por status, prioridade, categoria e responsável", async () => {
    const a = await openTicket(ana);
    await openTicket(bia, { ...NEW_TICKET, category: "network" });
    await advance(a, "in_progress");
    const count = async (qs: string) => (await api(app, tecnico).get(`/tickets?${qs}`)).body.items.length;
    expect(await count("status=in_progress")).toBe(1);
    expect(await count("status=open")).toBe(1);
    expect(await count("category=network")).toBe(1);
    expect(await count("priority=high")).toBe(0);
    expect(await count(`assigneeId=${tecnico.id}`)).toBe(1);
  });

  it("recusa filtro desconhecido ou inválido (400)", async () => {
    for (const qs of ["status=nada", "requesterId=x", "limit=0", "limit=101", "cursor=lixo"]) {
      expect((await api(app, tecnico).get(`/tickets?${qs}`)).status, qs).toBe(400);
    }
  });

  it("pagina por cursor, sem repetir nem perder itens", async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) created.push(await openTicket(ana, { ...NEW_TICKET, title: `Chamado ${i}` }));
    const seen: string[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page += 1) {
      const res = await api(app, ana).get(`/tickets?limit=2${cursor}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((t: { id: string }) => t.id));
      if (!res.body.nextCursor) break;
      cursor = `&cursor=${encodeURIComponent(res.body.nextCursor)}`;
    }
    expect([...seen].sort()).toEqual([...created].sort());
    expect(new Set(seen).size).toBe(5);
  });

  it("a listagem não traz a descrição completa nem o corpo de comentários", async () => {
    await openTicket();
    const [item] = (await api(app, ana).get("/tickets")).body.items;
    expect(item).not.toHaveProperty("description");
  });
});

describe("matriz de isolamento: chamado alheio é 404 em todo endpoint (FR-03, T-01)", () => {
  const endpoints = [
    { name: "GET detalhe", call: (s: Session, id: string) => api(app, s).get(`/tickets/${id}`) },
    { name: "PATCH", call: (s: Session, id: string) => api(app, s).patch(`/tickets/${id}`, { version: 1, title: "Outro título" }) },
    { name: "POST transição", call: (s: Session, id: string) => api(app, s).post(`/tickets/${id}/transitions`, { to: "cancelled" }) },
    { name: "GET comentários", call: (s: Session, id: string) => api(app, s).get(`/tickets/${id}/comments`) },
    { name: "POST comentário", call: (s: Session, id: string) => api(app, s).post(`/tickets/${id}/comments`, { body: "oi" }) },
    { name: "GET eventos", call: (s: Session, id: string) => api(app, s).get(`/tickets/${id}/events`) },
  ];

  for (const endpoint of endpoints) {
    it(`${endpoint.name}: Bia não alcança o chamado da Ana, e a resposta é igual à de um id inexistente`, async () => {
      const id = await openTicket(ana);
      const foreign = await endpoint.call(bia, id);
      const missing = await endpoint.call(bia, "00000000-0000-4000-8000-000000000000");
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
      expect((await endpoint.call(bia, "não-é-uuid")).status).toBe(404);
    });

    it(`${endpoint.name}: o chamado alheio continua intacto depois da tentativa`, async () => {
      const id = await openTicket(ana);
      await endpoint.call(bia, id);
      const after = await api(app, ana).get(`/tickets/${id}`);
      expect(after.body).toMatchObject({ title: NEW_TICKET.title, status: "open", version: 1 });
      expect((await api(app, ana).get(`/tickets/${id}/comments`)).body.items).toHaveLength(0);
      expect((await api(app, ana).get(`/tickets/${id}/events`)).body.items).toHaveLength(1);
    });
  }

  it("técnico alcança qualquer chamado", async () => {
    const id = await openTicket(ana);
    expect((await api(app, tecnico).get(`/tickets/${id}`)).status).toBe(200);
    expect((await api(app, tecnico2).get(`/tickets/${id}/comments`)).status).toBe(200);
    expect((await api(app, tecnico2).get(`/tickets/${id}/events`)).status).toBe(200);
  });
});

describe("edição com versão (FR-04, FR-05)", () => {
  it("solicitante edita título e descrição em open e a versão sobe", async () => {
    const id = await openTicket();
    const res = await api(app, ana).patch(`/tickets/${id}`, { version: 1, title: "Impressora do setor 3" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Impressora do setor 3", version: 2 });
  });

  it("versão desatualizada → 409 e nada muda", async () => {
    const id = await openTicket();
    await api(app, ana).patch(`/tickets/${id}`, { version: 1, title: "Primeira edição" });
    const stale = await api(app, ana).patch(`/tickets/${id}`, { version: 1, title: "Edição velha" });
    expect(stale.status).toBe(409);
    expect((await api(app, ana).get(`/tickets/${id}`)).body.title).toBe("Primeira edição");
  });

  it("versão ausente ou corpo vazio → 400", async () => {
    const id = await openTicket();
    expect((await api(app, ana).patch(`/tickets/${id}`, { title: "Sem versão" })).status).toBe(400);
    expect((await api(app, ana).patch(`/tickets/${id}`, { version: 1 })).status).toBe(400);
  });

  it("solicitante só edita enquanto open (422 depois)", async () => {
    const id = await openTicket();
    await advance(id, "in_progress");
    const res = await api(app, ana).patch(`/tickets/${id}`, { version: 2, title: "Tarde demais" });
    expect(res.status).toBe(422);
  });

  it("chamado encerrado não é mais editado, nem pelo técnico (422)", async () => {
    const id = await openTicket();
    await api(app, ana).post(`/tickets/${id}/transitions`, { to: "cancelled" });
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 2, priority: "high" })).status).toBe(422);
  });

  it("schema por papel: solicitante não manda campo de técnico, técnico não manda título", async () => {
    const id = await openTicket();
    expect((await api(app, ana).patch(`/tickets/${id}`, { version: 1, priority: "urgent" })).status).toBe(400);
    expect((await api(app, ana).patch(`/tickets/${id}`, { version: 1, status: "closed" })).status).toBe(400);
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, title: "Reescrito" })).status).toBe(400);
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, status: "closed" })).status).toBe(400);
    // campo válido junto de um campo proibido também é recusado, e nada muda
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, priority: "high", status: "closed" })).status).toBe(400);
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, priority: "high", title: "Reescrito" })).status).toBe(400);
    expect((await api(app, tecnico).get(`/tickets/${id}`)).body).toMatchObject({ priority: "medium", version: 1 });
  });

  it("técnico muda prioridade, categoria e responsável, e cada mudança vira evento", async () => {
    const id = await openTicket();
    const res = await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, priority: "high", category: "network", assigneeId: tecnico2.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ priority: "high", category: "network", assignee: { id: tecnico2.id }, version: 2, status: "open" });
    const types = (await api(app, tecnico).get(`/tickets/${id}/events`)).body.items.map((e: { type: string }) => e.type);
    expect(types).toEqual(["created", "priority_changed", "category_changed", "assignee_changed"]);
  });

  it("responsável precisa ser um técnico ativo", async () => {
    const id = await openTicket();
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, assigneeId: ana.id })).status).toBe(400);
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, assigneeId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
    await pool.query("UPDATE users SET active = false WHERE id = $1", [tecnico2.id]);
    expect((await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, assigneeId: tecnico2.id })).status).toBe(400);
  });

  it("alteração igual ao valor atual não gera evento nem muda a versão", async () => {
    const id = await openTicket();
    const res = await api(app, tecnico).patch(`/tickets/${id}`, { version: 1, priority: "medium" });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect((await api(app, tecnico).get(`/tickets/${id}/events`)).body.items).toHaveLength(1);
  });
});

describe("transições (FR-04, FR-05)", () => {
  const post = (s: Session, id: string, body: object) => api(app, s).post(`/tickets/${id}/transitions`, body);

  it("percorre o ciclo completo e guarda responsável, nota e data de resolução", async () => {
    const id = await openTicket();
    expect((await post(tecnico, id, { to: "in_progress" })).body).toMatchObject({ status: "in_progress", assignee: { id: tecnico.id } });
    expect((await post(tecnico, id, { to: "waiting_requester", comment: "Qual o patrimônio?" })).body.status).toBe("waiting_requester");
    expect((await post(ana, id, { to: "in_progress" })).body.status).toBe("in_progress");
    const resolved = await post(tecnico, id, { to: "resolved", resolutionNote: "Cabo trocado." });
    expect(resolved.body).toMatchObject({ status: "resolved", resolutionNote: "Cabo trocado." });
    expect(resolved.body.resolvedAt).not.toBeNull();
    expect((await post(ana, id, { to: "in_progress", comment: "Voltou a falhar." })).body.status).toBe("in_progress");
    await post(tecnico, id, { to: "resolved", resolutionNote: "Driver reinstalado." });
    expect((await post(ana, id, { to: "closed" })).body.status).toBe("closed");
  });

  it("início pode indicar outro técnico como responsável", async () => {
    const id = await openTicket();
    const res = await post(tecnico, id, { to: "in_progress", assigneeId: tecnico2.id });
    expect(res.body.assignee.id).toBe(tecnico2.id);
  });

  it("dono cancela o próprio chamado aberto", async () => {
    const id = await openTicket();
    expect((await post(ana, id, { to: "cancelled" })).body.status).toBe("cancelled");
  });

  it("transição fora da tabela → 422 problem+json, sem alterar nada", async () => {
    const id = await openTicket();
    const res = await post(tecnico, id, { to: "closed" });
    expect(res.status).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect((await api(app, tecnico).get(`/tickets/${id}`)).body).toMatchObject({ status: "open", version: 1 });
  });

  it("estado terminal não sai do lugar", async () => {
    const id = await openTicket();
    await post(ana, id, { to: "cancelled" });
    expect((await post(tecnico, id, { to: "in_progress" })).status).toBe(422);
  });

  it("papel errado → 403 (o solicitante dono enxerga o chamado, mas não pode essa transição)", async () => {
    const id = await openTicket();
    expect((await post(ana, id, { to: "in_progress" })).status).toBe(403);
    await advance(id, "in_progress");
    expect((await post(ana, id, { to: "resolved", resolutionNote: "eu mesma resolvi" })).status).toBe(403);
  });

  it("falta de comentário ou nota → 400", async () => {
    const id = await openTicket();
    await advance(id, "in_progress");
    expect((await post(tecnico, id, { to: "waiting_requester" })).status).toBe(400);
    expect((await post(tecnico, id, { to: "resolved" })).status).toBe(400);
  });

  it("corpo inválido ou com campo extra → 400", async () => {
    const id = await openTicket();
    for (const bad of [{}, { to: "inexistente" }, { to: "in_progress", status: "closed" }, { to: "in_progress", assigneeId: "x" }]) {
      expect((await post(tecnico, id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("responsável indicado precisa ser técnico ativo (400)", async () => {
    const id = await openTicket();
    expect((await post(tecnico, id, { to: "in_progress", assigneeId: bia.id })).status).toBe(400);
  });

  it("cada transição grava um evento só com origem e destino, sem o texto do comentário", async () => {
    const id = await openTicket();
    await advance(id, "waiting_requester");
    const events = (await api(app, ana).get(`/tickets/${id}/events`)).body.items;
    expect(events.map((e: { type: string }) => e.type)).toEqual(["created", "transitioned", "assignee_changed", "transitioned"]);
    expect(events[1].payload).toEqual({ from: "open", to: "in_progress" });
    expect(events[3].payload).toEqual({ from: "in_progress", to: "waiting_requester" });
    expect(JSON.stringify(events)).not.toContain("patrimônio");
  });

  it("o comentário exigido pela transição fica registrado na conversa", async () => {
    const id = await openTicket();
    await advance(id, "waiting_requester");
    const comments = (await api(app, ana).get(`/tickets/${id}/comments`)).body.items;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ body: "Qual o patrimônio?", author: { id: tecnico.id } });
  });

  it("duas transições simultâneas: só uma vence (a outra vê o estado novo)", async () => {
    const id = await openTicket();
    const [a, b] = await Promise.all([post(tecnico, id, { to: "in_progress" }), post(tecnico2, id, { to: "in_progress" })]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const events = (await api(app, tecnico).get(`/tickets/${id}/events`)).body.items;
    expect(events.filter((e: { type: string }) => e.type === "transitioned")).toHaveLength(1);
  });
});

describe("comentários (FR-03)", () => {
  it("dono e técnico conversam; a ordem é cronológica", async () => {
    const id = await openTicket();
    expect((await api(app, tecnico).post(`/tickets/${id}/comments`, { body: "Pode reiniciar a fila?" })).status).toBe(201);
    expect((await api(app, ana).post(`/tickets/${id}/comments`, { body: "Reiniciei, sem efeito." })).status).toBe(201);
    const items = (await api(app, ana).get(`/tickets/${id}/comments`)).body.items;
    expect(items.map((c: { body: string }) => c.body)).toEqual(["Pode reiniciar a fila?", "Reiniciei, sem efeito."]);
    expect(items[1].author).toMatchObject({ id: ana.id, displayName: "Ana" });
  });

  it("corpo vazio, longo demais ou com campo extra → 400", async () => {
    const id = await openTicket();
    for (const bad of [{}, { body: "   " }, { body: "x".repeat(5001) }, { body: "ok", authorId: bia.id }]) {
      expect((await api(app, ana).post(`/tickets/${id}/comments`, bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
  });

  it("o texto é guardado como veio (sem interpretar HTML) e o autor é a sessão", async () => {
    const id = await openTicket();
    const res = await api(app, ana).post(`/tickets/${id}/comments`, { body: "<script>alert(1)</script>" });
    expect(res.body).toMatchObject({ body: "<script>alert(1)</script>", author: { id: ana.id } });
  });
});

describe("histórico append-only (FR-05)", () => {
  it("o banco recusa alterar ou apagar eventos", async () => {
    const id = await openTicket();
    await expect(pool.query("UPDATE ticket_events SET event_type = 'x' WHERE ticket_id = $1", [id])).rejects.toThrow();
    await expect(pool.query("DELETE FROM ticket_events WHERE ticket_id = $1", [id])).rejects.toThrow();
  });
});
