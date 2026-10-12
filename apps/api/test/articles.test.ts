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
let tecnico: Session;
let tecnico2: Session;

beforeEach(async () => {
  await resetSchema(pool);
  await migrate(pool);
  await seedUsers(pool);
  app = buildApp(pool);
  [ana, tecnico, tecnico2] = await Promise.all([loginAs(app, "ana"), loginAs(app, "tecnico"), loginAs(app, "tecnico2")]);
});

afterAll(async () => {
  await pool.end();
});

const ARTICLE = {
  title: "Impressora de rede não imprime",
  symptom: "Os trabalhos entram na fila e ficam parados, sem sair papel.",
  environment: "Windows 11, impressora de rede do setor.",
  procedure: "1. Reinicie o serviço de spooler.\n2. Limpe a fila de impressão.\n3. Reenvie o documento.",
  expectedResult: "O documento sai na impressora.",
  tags: ["impressora", "rede"],
};

async function createArticle(body: object = {}, as: Session = tecnico): Promise<string> {
  const res = await api(app, as).post("/articles", { ...ARTICLE, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return String(res.body.id);
}

async function publish(id: string, as: Session = tecnico) {
  const res = await api(app, as).post(`/articles/${id}/publish`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

describe("escrita só do técnico (FR-02, FR-06)", () => {
  it("exige sessão e CSRF", async () => {
    expect((await request(app).get("/api/v1/articles")).status).toBe(401);
    expect((await request(app).get("/api/v1/search?q=teste")).status).toBe(401);
    expect((await request(app).post("/api/v1/articles").set("Cookie", tecnico.cookie).send(ARTICLE)).status).toBe(403);
  });

  it("solicitante recebe 403 em toda rota de escrita", async () => {
    const id = await createArticle();
    const as = api(app, ana);
    expect((await as.post("/articles", ARTICLE)).status).toBe(403);
    expect((await as.patch(`/articles/${id}`, { version: 1, title: "Outro" })).status).toBe(403);
    expect((await as.post(`/articles/${id}/publish`)).status).toBe(403);
    expect((await as.post(`/articles/${id}/unpublish`)).status).toBe(403);
    expect((await api(app, tecnico).get(`/articles/${id}`)).body).toMatchObject({ title: ARTICLE.title, status: "draft", version: 1 });
  });

  it("toda rota que altera exige CSRF", async () => {
    const id = await createArticle();
    const bare = (path: string, method: "post" | "patch" = "post") => request(app)[method](`/api/v1${path}`).set("Cookie", tecnico.cookie);
    expect((await bare(`/articles/${id}`, "patch").send({ version: 1, title: "X" })).status).toBe(403);
    expect((await bare(`/articles/${id}/publish`).send({})).status).toBe(403);
    expect((await bare(`/articles/${id}/unpublish`).send({})).status).toBe(403);
  });
});

describe("criação e edição", () => {
  it("cria como rascunho, autor é a sessão e as tags são normalizadas", async () => {
    const res = await api(app, tecnico).post("/articles", { ...ARTICLE, tags: ["Impressora", " rede ", "impressora"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "draft", version: 1, author: { id: tecnico.id }, tags: ["impressora", "rede"] });
  });

  it("recusa campo extra, campo vazio, tags demais e tag inválida (400)", async () => {
    const bad: object[] = [
      { status: "published" },
      { authorId: ana.id },
      { title: "" },
      { procedure: "   " },
      { title: "x".repeat(161) },
      { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { tags: ["com espaço e <b>"] },
      { tags: "impressora" },
    ];
    for (const extra of bad) expect((await api(app, tecnico).post("/articles", { ...ARTICLE, ...extra })).status, JSON.stringify(extra)).toBe(400);
  });

  it("PATCH altera campos e troca as tags; a versão sobe", async () => {
    const id = await createArticle();
    const res = await api(app, tecnico2).patch(`/articles/${id}`, { version: 1, title: "Impressora do setor 3", tags: ["spooler"] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Impressora do setor 3", tags: ["spooler"], version: 2, status: "draft" });
  });

  it("versão desatualizada → 409 e nada muda", async () => {
    const id = await createArticle();
    await api(app, tecnico).patch(`/articles/${id}`, { version: 1, title: "Primeira" });
    expect((await api(app, tecnico2).patch(`/articles/${id}`, { version: 1, title: "Velha" })).status).toBe(409);
    expect((await api(app, tecnico).get(`/articles/${id}`)).body.title).toBe("Primeira");
  });

  it("PATCH sem versão, vazio, com status ou com campo extra → 400", async () => {
    const id = await createArticle();
    for (const bad of [{ title: "X" }, { version: 1 }, { version: 1, status: "published" }, { version: 1, authorId: ana.id }, { version: 1, title: "Novo", status: "published" }, { version: 1, title: "Novo", authorId: ana.id }]) {
      expect((await api(app, tecnico).patch(`/articles/${id}`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("editar artigo publicado mantém o status e sobe a versão", async () => {
    const id = await createArticle();
    await publish(id);
    const res = await api(app, tecnico).patch(`/articles/${id}`, { version: 2, expectedResult: "Sai na impressora certa." });
    expect(res.body).toMatchObject({ status: "published", version: 3, expectedResult: "Sai na impressora certa." });
  });

  it("id que não é UUID ou não existe → 404", async () => {
    expect((await api(app, tecnico).get("/articles/nada")).status).toBe(404);
    expect((await api(app, tecnico).get("/articles/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api(app, tecnico).patch("/articles/00000000-0000-4000-8000-000000000000", { version: 1, title: "X" })).status).toBe(404);
    expect((await api(app, tecnico).post("/articles/00000000-0000-4000-8000-000000000000/publish")).status).toBe(404);
  });
});

describe("publicar e despublicar (FR-06, FR-15)", () => {
  it("rascunho: 404 para o solicitante, igual a um id inexistente", async () => {
    const id = await createArticle();
    const foreign = await api(app, ana).get(`/articles/${id}`);
    const missing = await api(app, ana).get("/articles/00000000-0000-4000-8000-000000000000");
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it("publicado fica legível pelo solicitante; despublicar volta a 404", async () => {
    const id = await createArticle();
    await publish(id);
    expect((await api(app, ana).get(`/articles/${id}`)).body).toMatchObject({ id, status: "published", procedure: ARTICLE.procedure });
    const un = await api(app, tecnico).post(`/articles/${id}/unpublish`);
    expect(un.body).toMatchObject({ status: "draft", version: 3 });
    expect((await api(app, ana).get(`/articles/${id}`)).status).toBe(404);
  });

  it("publicar duas vezes ou despublicar rascunho → 422", async () => {
    const id = await createArticle();
    expect((await api(app, tecnico).post(`/articles/${id}/unpublish`)).status).toBe(422);
    await publish(id);
    expect((await api(app, tecnico).post(`/articles/${id}/publish`)).status).toBe(422);
  });

  it("duas publicações simultâneas: só uma vence", async () => {
    const id = await createArticle();
    const [a, b] = await Promise.all([api(app, tecnico).post(`/articles/${id}/publish`), api(app, tecnico2).post(`/articles/${id}/publish`)]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect((await api(app, tecnico).get(`/articles/${id}`)).body.version).toBe(2);
  });
});

describe("listagem com escopo do servidor (FR-06)", () => {
  it("solicitante só vê publicados, mesmo pedindo status=draft; técnico vê tudo e filtra", async () => {
    const draft = await createArticle({ title: "Rascunho de VPN" });
    const live = await createArticle({ title: "VPN não conecta", tags: ["vpn"] });
    await publish(live);
    const ids = async (s: Session, qs = "") => ((await api(app, s).get(`/articles${qs}`)).body.items as { id: string }[]).map((a) => a.id).sort();
    expect(await ids(ana)).toEqual([live]);
    expect(await ids(ana, "?status=draft")).toEqual([]);
    expect(await ids(tecnico)).toEqual([draft, live].sort());
    expect(await ids(tecnico, "?status=draft")).toEqual([draft]);
    expect(await ids(tecnico, "?tag=vpn")).toEqual([live]);
  });

  it("a listagem não traz o procedimento", async () => {
    await publish(await createArticle());
    const [item] = (await api(app, ana).get("/articles")).body.items;
    expect(item).toMatchObject({ title: ARTICLE.title, symptom: ARTICLE.symptom, tags: ["impressora", "rede"] });
    expect(item).not.toHaveProperty("procedure");
  });

  it("filtro desconhecido ou inválido → 400; pagina por cursor sem repetir", async () => {
    for (const qs of ["status=nada", "authorId=x", "limit=0", "limit=101", "cursor=lixo"]) {
      expect((await api(app, tecnico).get(`/articles?${qs}`)).status, qs).toBe(400);
    }
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) created.push(await createArticle({ title: `Artigo ${i}` }));
    const seen: string[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page += 1) {
      const res = await api(app, tecnico).get(`/articles?limit=2${cursor}`);
      seen.push(...res.body.items.map((a: { id: string }) => a.id));
      if (!res.body.nextCursor) break;
      cursor = `&cursor=${encodeURIComponent(res.body.nextCursor)}`;
    }
    expect([...seen].sort()).toEqual([...created].sort());
  });
});

describe("busca lexical (FR-07, FR-15)", () => {
  const search = (s: Session, q: string, extra = "") => api(app, s).get(`/search?q=${encodeURIComponent(q)}${extra}`);
  const titles = (res: request.Response) => (res.body.items as { title: string }[]).map((i) => i.title);

  async function corpus() {
    const printer = await createArticle();
    const vpn = await createArticle({ title: "VPN cai ao trocar de rede", symptom: "A conexão VPN desconecta sozinha em redes Wi-Fi.", procedure: "Atualize o cliente e refaça o perfil.", tags: ["vpn"] });
    const draft = await createArticle({ title: "Rascunho sobre impressora fiscal", symptom: "Impressora fiscal rejeita o cupom." });
    await publish(printer);
    await publish(vpn);
    return { printer, vpn, draft };
  }

  it("acha por título e sintoma, e responde com o modo e o score", async () => {
    await corpus();
    const res = await search(ana, "impressora não imprime");
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("lexical");
    expect(titles(res)[0]).toBe(ARTICLE.title);
    expect(res.body.items[0]).toMatchObject({ symptom: ARTICLE.symptom, tags: ["impressora", "rede"] });
    expect(res.body.items[0].score).toBeGreaterThan(0);
  });

  it("rascunho nunca aparece, nem para o técnico (busca só do que está publicado)", async () => {
    await corpus();
    for (const s of [ana, tecnico]) expect(titles(await search(s, "impressora fiscal cupom"))).not.toContain("Rascunho sobre impressora fiscal");
  });

  it("despublicar tira da busca; republicar traz de volta (FR-15)", async () => {
    const { printer } = await corpus();
    await api(app, tecnico).post(`/articles/${printer}/unpublish`);
    expect(titles(await search(ana, "impressora de rede"))).not.toContain(ARTICLE.title);
    await publish(printer);
    expect(titles(await search(ana, "impressora de rede"))[0]).toBe(ARTICLE.title);
  });

  it("ignora acentos e maiúsculas", async () => {
    await corpus();
    expect(titles(await search(ana, "CONEXAO"))).toEqual(["VPN cai ao trocar de rede"]);
    expect(titles(await search(ana, "conexão"))).toEqual(["VPN cai ao trocar de rede"]);
  });

  it("casa por qualquer termo (OR), e o artigo com mais termos vem primeiro", async () => {
    await corpus();
    const res = await search(ana, "vpn impressora rede");
    expect(titles(res)).toEqual(expect.arrayContaining([ARTICLE.title, "VPN cai ao trocar de rede"]));
    expect(res.body.items[0].score).toBeGreaterThanOrEqual(res.body.items[1].score);
  });

  it("resultado é reproduzível: mesma consulta, mesma ordem e mesmos scores", async () => {
    await corpus();
    const a = await search(ana, "rede impressora vpn");
    const b = await search(ana, "rede impressora vpn");
    expect(a.body).toEqual(b.body);
  });

  it("só stop words ou nada encontrado → lista vazia, não erro", async () => {
    await corpus();
    expect((await search(ana, "de a o")).body.items).toEqual([]);
    expect((await search(ana, "zzzzzz")).body.items).toEqual([]);
  });

  it("consulta é dado: aspas e operadores não quebram nem injetam", async () => {
    await corpus();
    for (const q of ["'; DROP TABLE kb_articles; --", "impressora & | ! ( )", '"impressora" <-> rede', "\\"]) {
      expect((await search(ana, q)).status, q).toBe(200);
    }
    expect((await api(app, tecnico).get("/articles")).body.items).toHaveLength(3);
  });

  it("limita o resultado e valida os parâmetros (400)", async () => {
    for (let i = 0; i < 4; i += 1) await publish(await createArticle({ title: `Impressora modelo ${i}` }));
    expect((await search(ana, "impressora", "&limit=2")).body.items).toHaveLength(2);
    for (const qs of ["", "?q=", "?q=%20%20", `?q=${"a".repeat(201)}`, "?q=a&limit=0", "?q=a&limit=21", "?q=a&x=1"]) {
      expect((await api(app, ana).get(`/search${qs}`)).status, qs).toBe(400);
    }
  });
});
