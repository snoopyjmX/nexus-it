import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/lib/db.js";
import { createLogger } from "../src/lib/logger.js";
import { backfill } from "../src/modules/embeddings/backfill.js";
import type { Embeddings } from "../src/modules/embeddings/index.js";
import { createOllamaProvider } from "../src/modules/embeddings/provider.js";
import { api, buildApp, loginAs, seedUsers, type App, type Session } from "./app-helpers.js";
import { createFakeProvider, vectorFor, type FakeProvider } from "./fake-embeddings.js";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

const pool: pg.Pool = createPool(testDatabaseUrl());
let provider: FakeProvider;
let embeddings: Embeddings;
let app: App;
let ana: Session;
let bia: Session;
let tecnico: Session;

beforeEach(async () => {
  await resetSchema(pool);
  await migrate(pool);
  await seedUsers(pool);
  provider = createFakeProvider();
  embeddings = { provider, minScore: 0.2, logger: createLogger("silent") };
  app = buildApp(pool, embeddings);
  [ana, bia, tecnico] = await Promise.all([loginAs(app, "ana"), loginAs(app, "bia"), loginAs(app, "tecnico")]);
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await pool.end();
});

const ARTICLE = {
  title: "Impressora de rede não imprime",
  symptom: "Os trabalhos entram na fila e ficam parados.",
  environment: "Windows 11, impressora de rede do setor.",
  procedure: "1. Reinicie o serviço de spooler.\n2. Limpe a fila de impressão.",
  expectedResult: "O documento sai na impressora.",
  tags: ["impressora"],
};

async function newArticle(body: object = {}): Promise<string> {
  const res = await api(app, tecnico).post("/articles", { ...ARTICLE, ...body });
  return String(res.body.id);
}
const publish = (id: string) => api(app, tecnico).post(`/articles/${id}/publish`);
const state = async (table: "kb_articles" | "tickets", id: string) => {
  const { rows } = await pool.query<{ has: boolean; model: string | null }>(`SELECT embedding IS NOT NULL AS has, embedding_model AS model FROM ${table} WHERE id = $1`, [id]);
  return rows[0];
};

async function solvedTicket(owner: Session, body: object = {}): Promise<string> {
  const created = await api(app, owner).post("/tickets", { title: "Monitor sem sinal", description: "O monitor externo fica preto.", category: "hardware", ...body });
  const id = String(created.body.id);
  await api(app, tecnico).post(`/tickets/${id}/transitions`, { to: "in_progress" });
  const done = await api(app, tecnico).post(`/tickets/${id}/transitions`, { to: "resolved", resolutionNote: "Cabo HDMI trocado." });
  expect(done.status).toBe(200);
  return id;
}

describe("adaptador do Ollama (ADR-007)", () => {
  const ok = (vectors: number[][]) => vi.fn(async () => new Response(JSON.stringify({ model: "bge-m3", embeddings: vectors }), { status: 200 }));
  const make = () => createOllamaProvider({ baseUrl: "http://ollama.test:11434", model: "bge-m3", timeoutMs: 1000 });

  it("chama /api/embed com modelo, entrada e sem truncar", async () => {
    const fetchMock = ok([vectorFor("a b c"), vectorFor("d e f")]);
    vi.stubGlobal("fetch", fetchMock);
    const result = await make().embed(["um", "dois"]);
    expect(result).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://ollama.test:11434/api/embed");
    expect(JSON.parse(String(init.body))).toEqual({ model: "bge-m3", input: ["um", "dois"], truncate: false });
  });

  it("recusa resposta de erro, quantidade errada e dimensão errada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));
    await expect(make().embed(["x"])).rejects.toThrow("500");
    vi.stubGlobal("fetch", ok([vectorFor("a")]));
    await expect(make().embed(["x", "y"])).rejects.toThrow("número de vetores");
    vi.stubGlobal("fetch", ok([[0.1, 0.2]]));
    await expect(make().embed(["x"])).rejects.toThrow("dimensão");
  });
});

describe("configuração (ADR-007)", () => {
  const base = { DATABASE_URL: "postgres://u:p@localhost/db" };
  it("busca vetorial vem desligada, com o limiar da Semana 0", () => {
    expect(loadConfig(base)).toMatchObject({ EMBEDDINGS_ENABLED: false, EMBEDDING_MODEL: "bge-m3", VECTOR_MIN_SCORE: 0.5393, OLLAMA_BASE_URL: "http://127.0.0.1:11434" });
  });
  it("liga com 'true' e recusa valor fora do esperado ou limiar fora de 0–1", () => {
    expect(loadConfig({ ...base, EMBEDDINGS_ENABLED: "true" }).EMBEDDINGS_ENABLED).toBe(true);
    expect(() => loadConfig({ ...base, EMBEDDINGS_ENABLED: "sim" })).toThrow("EMBEDDINGS_ENABLED");
    expect(() => loadConfig({ ...base, VECTOR_MIN_SCORE: "1.5" })).toThrow("VECTOR_MIN_SCORE");
  });
});

describe("o banco garante a consistência do índice (FR-15)", () => {
  it("recusa vetor em artigo em rascunho, vetor sem modelo e chamado não resolvido", async () => {
    const id = await newArticle();
    const literal = `[${vectorFor("x").join(",")}]`;
    await expect(pool.query("UPDATE kb_articles SET embedding = $2::vector, embedding_model = 'm' WHERE id = $1", [id, literal])).rejects.toThrow();
    provider.down = true;
    await publish(id);
    await expect(pool.query("UPDATE kb_articles SET embedding = $2::vector WHERE id = $1", [id, literal])).rejects.toThrow();
    const ticket = String((await api(app, ana).post("/tickets", { title: "T", description: "D", category: "other" })).body.id);
    await expect(pool.query("UPDATE tickets SET embedding = $2::vector, embedding_model = 'm' WHERE id = $1", [ticket, literal])).rejects.toThrow();
  });
});

describe("vetor acompanha o ciclo do artigo (ADR-001, FR-15)", () => {
  it("publicar grava vetor e modelo; despublicar apaga", async () => {
    const id = await newArticle();
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
    await publish(id);
    expect(await state("kb_articles", id)).toEqual({ has: true, model: "fake-bge-m3" });
    await api(app, tecnico).post(`/articles/${id}/unpublish`);
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
  });

  it("o vetor é calculado antes da transação, uma vez, com o texto completo do artigo", async () => {
    const id = await newArticle();
    await publish(id);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.[0]).toBe([ARTICLE.title, ARTICLE.symptom, ARTICLE.environment, ARTICLE.procedure, ARTICLE.expectedResult].join("\n"));
  });

  it("editar o texto de um publicado recalcula; editar só as tags, não; editar rascunho não calcula", async () => {
    const id = await newArticle();
    await api(app, tecnico).patch(`/articles/${id}`, { version: 1, title: "Rascunho editado" });
    expect(provider.calls).toHaveLength(0);
    await publish(id);
    provider.calls.length = 0;
    await api(app, tecnico).patch(`/articles/${id}`, { version: 3, tags: ["outra"] });
    expect(provider.calls).toHaveLength(0);
    const edited = await api(app, tecnico).patch(`/articles/${id}`, { version: 4, procedure: "Troque o cabo de rede." });
    expect(edited.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.[0]).toContain("Troque o cabo de rede.");
  });

  it("com o modelo fora do ar, publica mesmo assim, sem vetor (ADR-007)", async () => {
    provider.down = true;
    const id = await newArticle();
    expect((await publish(id)).status).toBe(200);
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
  });

  it("editar texto de publicado com o modelo fora do ar apaga o vetor velho em vez de deixá-lo", async () => {
    const id = await newArticle();
    await publish(id);
    provider.down = true;
    expect((await api(app, tecnico).patch(`/articles/${id}`, { version: 2, procedure: "Outro procedimento." })).status).toBe(200);
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
  });

  it("publicações simultâneas: uma vence e o vetor fica gravado uma vez", async () => {
    const id = await newArticle();
    const [a, b] = await Promise.all([publish(id), publish(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect(await state("kb_articles", id)).toEqual({ has: true, model: "fake-bge-m3" });
  });

  it("artigo editado enquanto o vetor era calculado: a publicação recusa (409) em vez de gravar vetor velho", async () => {
    const id = await newArticle();
    const original = provider.embed.bind(provider);
    provider.embed = async (texts) => {
      await api(app, tecnico).patch(`/articles/${id}`, { version: 1, procedure: "Texto novo, depois da leitura." });
      return original(texts);
    };
    const res = await publish(id);
    expect(res.status).toBe(409);
    expect((await api(app, tecnico).get(`/articles/${id}`)).body.status).toBe("draft");
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
  });

  it("sem busca vetorial configurada, nada é calculado nem gravado", async () => {
    const plain = buildApp(pool);
    const t = await loginAs(plain, "tecnico");
    const id = String((await api(plain, t).post("/articles", ARTICLE)).body.id);
    expect((await api(plain, t).post(`/articles/${id}/publish`)).status).toBe(200);
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("vetor acompanha o ciclo do chamado (ADR-001, FR-15)", () => {
  it("resolver grava; fechar mantém; reabrir apaga", async () => {
    const id = await solvedTicket(ana);
    expect(await state("tickets", id)).toEqual({ has: true, model: "fake-bge-m3" });
    expect(provider.calls[0]?.[0]).toBe("Monitor sem sinal\nO monitor externo fica preto.\nCabo HDMI trocado.");
    await api(app, ana).post(`/tickets/${id}/transitions`, { to: "closed" });
    expect(await state("tickets", id)).toEqual({ has: true, model: "fake-bge-m3" });

    const other = await solvedTicket(ana, { title: "Mouse" });
    const reopened = await api(app, ana).post(`/tickets/${other}/transitions`, { to: "in_progress", comment: "Voltou." });
    expect(reopened.status).toBe(200);
    expect(await state("tickets", other)).toEqual({ has: false, model: null });
  });

  it("chamados que não foram resolvidos nunca chamam o modelo", async () => {
    const id = String((await api(app, ana).post("/tickets", { title: "T", description: "D", category: "other" })).body.id);
    await api(app, tecnico).post(`/tickets/${id}/transitions`, { to: "in_progress" });
    await api(app, ana).post("/tickets", { title: "Outro", description: "D", category: "other" }).then((r) => api(app, ana).post(`/tickets/${r.body.id}/transitions`, { to: "cancelled" }));
    expect(provider.calls).toHaveLength(0);
  });

  it("quem não pode resolver não gasta chamada ao modelo", async () => {
    const id = String((await api(app, ana).post("/tickets", { title: "T", description: "D", category: "other" })).body.id);
    await api(app, tecnico).post(`/tickets/${id}/transitions`, { to: "in_progress" });
    const denied = await api(app, ana).post(`/tickets/${id}/transitions`, { to: "resolved", resolutionNote: "eu mesma" });
    expect(denied.status).toBe(403);
    expect(provider.calls).toHaveLength(0);
  });

  it("chamado alterado enquanto o vetor era calculado: resolve, mas sem gravar vetor possivelmente velho", async () => {
    const id = String((await api(app, ana).post("/tickets", { title: "T", description: "D", category: "other" })).body.id);
    await api(app, tecnico).post(`/tickets/${id}/transitions`, { to: "in_progress" });
    const original = provider.embed.bind(provider);
    provider.embed = async (texts) => {
      await api(app, tecnico).patch(`/tickets/${id}`, { version: 2, priority: "high" });
      return original(texts);
    };
    const res = await api(app, tecnico).post(`/tickets/${id}/transitions`, { to: "resolved", resolutionNote: "Feito." });
    expect(res.status).toBe(200);
    expect(await state("tickets", id)).toEqual({ has: false, model: null });
  });

  it("modelo fora do ar: resolve do mesmo jeito, sem vetor", async () => {
    provider.down = true;
    const id = await solvedTicket(ana);
    expect(await state("tickets", id)).toEqual({ has: false, model: null });
  });
});

describe("busca vetorial (ADR-007, FR-07, FR-13)", () => {
  const search = (s: Session, q: string) => api(app, s).get(`/search?q=${encodeURIComponent(q)}`);

  it("usa o modo vetorial, devolve o cosseno como score e acha artigo e chamado", async () => {
    const article = await newArticle();
    await publish(article);
    await solvedTicket(ana);
    const res = await search(tecnico, "impressora rede fila spooler");
    expect(res.body).toMatchObject({ mode: "vector", degraded: false });
    expect(res.body.items[0]).toMatchObject({ kind: "article", id: article });
    expect(res.body.items[0].score).toBeGreaterThan(0.2);
    expect(res.body.items[0].score).toBeLessThanOrEqual(1);
    const kinds = (await search(tecnico, "monitor hdmi cabo")).body.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain("ticket");
  });

  it("ordena do mais parecido para o menos parecido e o score é o cosseno entre consulta e documento", async () => {
    const printer = await newArticle();
    const vpn = await newArticle({ title: "VPN cai ao trocar de rede", symptom: "Conexão VPN desconecta em Wi-Fi.", environment: "Notebook corporativo.", procedure: "Atualize o cliente VPN.", expectedResult: "Conexão estável." });
    await publish(printer);
    await publish(vpn);
    const query = "impressora fila spooler documento";
    embeddings.minScore = 0;
    const res = await search(ana, query);
    expect(res.body.items).toHaveLength(2);
    const text = (a: typeof ARTICLE) => [a.title, a.symptom, a.environment, a.procedure, a.expectedResult].join("\n");
    const cosine = (x: number[], y: number[]) => x.reduce((sum, value, i) => sum + value * (y[i] ?? 0), 0);
    const expected = cosine(vectorFor(query), vectorFor(text(ARTICLE)));
    expect(res.body.items[0].id).toBe(printer);
    expect(res.body.items[0].score).toBeCloseTo(expected, 4);
    const scores = res.body.items.map((i: { score: number }) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(res.body.items[1].id).toBe(vpn);

    // Com limite 1 é o ORDER BY do SQL (e não a ordenação final) que decide quem sobrevive ao corte.
    const top = await api(app, ana).get(`/search?q=${encodeURIComponent(query)}&limit=1`);
    expect(top.body.items.map((i: { id: string }) => i.id)).toEqual([printer]);
  });

  it("o limiar corta o que está abaixo dele", async () => {
    await publish(await newArticle());
    embeddings.minScore = 0.999;
    expect((await search(ana, "impressora rede fila spooler")).body.items).toEqual([]);
  });

  it("rascunho, despublicado e chamado reaberto não aparecem (FR-15)", async () => {
    const draft = await newArticle({ title: "Rascunho de impressora fiscal" });
    const live = await newArticle();
    await publish(live);
    const ids = async () => (await search(ana, "impressora rede fila spooler")).body.items.map((i: { id: string }) => i.id);
    expect(await ids()).toEqual([live]);
    expect(await ids()).not.toContain(draft);
    await api(app, tecnico).post(`/articles/${live}/unpublish`);
    expect(await ids()).toEqual([]);

    const ticket = await solvedTicket(ana);
    expect((await search(ana, "monitor hdmi cabo")).body.items.map((i: { id: string }) => i.id)).toContain(ticket);
    await api(app, ana).post(`/tickets/${ticket}/transitions`, { to: "in_progress", comment: "Voltou." });
    expect((await search(ana, "monitor hdmi cabo")).body.items.map((i: { id: string }) => i.id)).not.toContain(ticket);
  });

  it("escopo por dono vale na busca vetorial: Bia não acha o chamado da Ana", async () => {
    await solvedTicket(ana);
    expect((await search(bia, "monitor hdmi cabo")).body.items).toEqual([]);
    expect((await search(ana, "monitor hdmi cabo")).body.items).toHaveLength(1);
    expect((await search(tecnico, "monitor hdmi cabo")).body.items).toHaveLength(1);
  });

  it("modelo fora do ar na consulta: cai para a busca por palavras e avisa", async () => {
    await publish(await newArticle());
    provider.down = true;
    const res = await search(ana, "impressora");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "lexical", degraded: true });
    expect(res.body.items).toHaveLength(1);
  });

  it("sem busca vetorial configurada, o modo é lexical e não é 'degradado'", async () => {
    const plain = buildApp(pool);
    const a = await loginAs(plain, "ana");
    const res = await api(plain, a).get("/search?q=impressora");
    expect(res.body).toMatchObject({ mode: "lexical", degraded: false });
  });

  it("artigo publicado sem vetor fica fora da busca vetorial até o backfill, e o status conta o pendente", async () => {
    provider.down = true;
    const id = await newArticle();
    await publish(id);
    provider.down = false;
    expect((await search(ana, "impressora rede fila spooler")).body.items).toEqual([]);
    const status = await api(app, tecnico).get("/search/status");
    expect(status.body).toEqual({ embeddings: { enabled: true, model: "fake-bge-m3", minScore: 0.2, pending: { articles: 1, tickets: 0 } } });

    const result = await backfill(pool, provider);
    expect(result).toEqual({ embedded: 1, failed: 0, remaining: { articles: 0, tickets: 0 } });
    expect((await search(ana, "impressora rede fila spooler")).body.items[0].id).toBe(id);
  });
});

describe("estado da busca vetorial (só técnico)", () => {
  it("solicitante recebe 403; sem sessão, 401; desligada, informa enabled=false", async () => {
    expect((await api(app, ana).get("/search/status")).status).toBe(403);
    expect((await request(app).get("/api/v1/search/status")).status).toBe(401);
    const plain = buildApp(pool);
    const t = await loginAs(plain, "tecnico");
    expect((await api(plain, t).get("/search/status")).body).toEqual({ embeddings: { enabled: false } });
  });
});

describe("backfill", () => {
  it("é idempotente, em lotes, e refaz vetores de outro modelo", async () => {
    provider.down = true;
    const a = await newArticle();
    const b = await newArticle({ title: "VPN cai" });
    await publish(a);
    await publish(b);
    await solvedTicket(ana);
    provider.down = false;
    provider.calls.length = 0;

    expect(await backfill(pool, provider, 1)).toEqual({ embedded: 3, failed: 0, remaining: { articles: 0, tickets: 0 } });
    expect(provider.calls.map((c) => c.length)).toEqual([1, 1, 1]);
    provider.calls.length = 0;
    expect(await backfill(pool, provider)).toEqual({ embedded: 0, failed: 0, remaining: { articles: 0, tickets: 0 } });
    expect(provider.calls).toHaveLength(0);

    const next = createFakeProvider("outro-modelo");
    expect((await backfill(pool, next)).embedded).toBe(3);
    expect(await state("kb_articles", a)).toEqual({ has: true, model: "outro-modelo" });
  });

  it("modelo fora do ar: não lança, conta as falhas e deixa tudo como estava", async () => {
    provider.down = true;
    const id = await newArticle();
    await publish(id);
    const result = await backfill(pool, provider);
    expect(result).toEqual({ embedded: 0, failed: 1, remaining: { articles: 1, tickets: 0 } });
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
  });

  it("não grava vetor em artigo despublicado no meio do caminho", async () => {
    provider.down = true;
    const id = await newArticle();
    await publish(id);
    provider.down = false;
    const original = provider.embed.bind(provider);
    provider.embed = async (texts) => {
      await api(app, tecnico).post(`/articles/${id}/unpublish`);
      return original(texts);
    };
    await backfill(pool, provider);
    expect(await state("kb_articles", id)).toEqual({ has: false, model: null });
  });

  it("um artigo despublicado no meio do lote não impede os outros nem é contado como gravado", async () => {
    provider.down = true;
    const ids = [await newArticle(), await newArticle()];
    for (const id of ids) await publish(id);
    provider.down = false;
    const [gone, kept] = [...ids].sort() as [string, string];
    const original = provider.embed.bind(provider);
    provider.embed = async (texts) => {
      await api(app, tecnico).post(`/articles/${gone}/unpublish`);
      return original(texts);
    };
    const result = await backfill(pool, provider);
    expect(result).toMatchObject({ embedded: 1, failed: 0 });
    expect(await state("kb_articles", kept)).toEqual({ has: true, model: provider.model });
    expect(await state("kb_articles", gone)).toEqual({ has: false, model: null });
  });
});
