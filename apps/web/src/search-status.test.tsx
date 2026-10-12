import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANA, TECH, loggedInAs, mockApi, renderApp } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noArticles = { body: { items: [], nextCursor: null } };
const hit = { kind: "article", id: "a-1", title: "Impressora offline", symptom: "Fila parada.", tags: [], score: 0.9 };

async function searchFor(term: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Buscar na base"), term);
  await user.click(screen.getByRole("button", { name: "Buscar" }));
}

describe("aviso do modo da busca (FR-13)", () => {
  it("busca vetorial: diz que é semântica e não avisa de degradação", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles, "GET /search": { body: { mode: "vector", degraded: false, items: [hit] } } });
    renderApp("/base");
    await searchFor("impressora");
    await screen.findByRole("link", { name: "Impressora offline" });
    expect(screen.getByText("Busca semântica")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("busca por palavras sem degradação (semântica desligada): só indica o modo", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles, "GET /search": { body: { mode: "lexical", degraded: false, items: [hit] } } });
    renderApp("/base");
    await searchFor("impressora");
    await screen.findByRole("link", { name: "Impressora offline" });
    expect(screen.getByText("Busca por palavras")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("degradada: avisa que a semântica não respondeu e que o resultado é por palavras", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles, "GET /search": { body: { mode: "lexical", degraded: true, items: [hit] } } });
    renderApp("/base");
    await searchFor("impressora");
    await screen.findByRole("link", { name: "Impressora offline" });
    expect(screen.getByRole("note").textContent).toContain("A busca semântica está indisponível");
    expect(screen.getByRole("note").textContent).toContain("por palavras");
    // O resultado continua na tela: a degradação não derruba a busca.
    expect(screen.getByRole("status").textContent).toContain("1 resultado para");
  });

  it("degradada sem resultado: aviso e 'nada encontrado' aparecem juntos", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles, "GET /search": { body: { mode: "lexical", degraded: true, items: [] } } });
    renderApp("/base");
    await searchFor("zzz");
    expect((await screen.findByRole("status")).textContent).toContain("Nada encontrado");
    expect(screen.getByRole("note").textContent).toContain("indisponível");
  });
});

describe("painel de vetores pendentes (técnico, FR-13)", () => {
  const panel = () => screen.findByRole("region", { name: "Busca semântica" });

  it("ligada: mostra modelo, limiar e pendentes de artigos e chamados", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles": noArticles,
      "GET /search/status": { body: { embeddings: { enabled: true, model: "bge-m3", minScore: 0.5393, pending: { articles: 2, tickets: 1 } } } },
    });
    renderApp("/base");
    const region = within(await panel());
    expect(await region.findByText("bge-m3")).toBeTruthy();
    expect(region.getByText("0,5393")).toBeTruthy();
    expect(region.getByText("2 artigos sem vetor")).toBeTruthy();
    expect(region.getByText("1 chamado sem vetor")).toBeTruthy();
  });

  it("nada pendente: diz que os vetores estão em dia", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles": noArticles,
      "GET /search/status": { body: { embeddings: { enabled: true, model: "bge-m3", minScore: 0.5393, pending: { articles: 0, tickets: 0 } } } },
    });
    renderApp("/base");
    expect(await within(await panel()).findByText("Vetores em dia.")).toBeTruthy();
  });

  it("desligada: diz que só a busca por palavras está ativa", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /articles": noArticles, "GET /search/status": { body: { embeddings: { enabled: false } } } });
    renderApp("/base");
    expect(await within(await panel()).findByText("Desligada: só a busca por palavras está ativa.")).toBeTruthy();
  });

  it("falha ao ler o estado: avisa no painel e a lista de artigos continua", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles": { body: { items: [{ id: "a-1", title: "Impressora offline", symptom: "Fila parada.", tags: [], status: "published", version: 1 }], nextCursor: null } },
      "GET /search/status": { status: 500, body: {} },
    });
    renderApp("/base");
    expect((await within(await panel()).findByRole("alert")).textContent).toContain("Não foi possível ler o estado");
    expect(await screen.findByRole("link", { name: "Impressora offline" })).toBeTruthy();
  });

  it("solicitante não vê o painel e a tela nem chama /search/status", async () => {
    const calls = mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles });
    renderApp("/base");
    await screen.findByRole("heading", { name: "Base de conhecimento" });
    await screen.findByText("Nenhum artigo publicado.");
    expect(screen.queryByRole("region", { name: "Busca semântica" })).toBeNull();
    expect(calls.some((c) => c.path.startsWith("/search/status"))).toBe(false);
  });
});

describe("textos da base (NFR-06)", () => {
  const hit2 = { ...hit, id: "a-2", title: "Impressora sem toner" };

  it("busca com 1 resultado usa o singular", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles, "GET /search": { body: { mode: "lexical", degraded: false, items: [hit] } } });
    renderApp("/base");
    await searchFor("termo");
    await screen.findByRole("link", { name: "Impressora offline" });
    expect(screen.getByRole("status").textContent).toContain("1 resultado para “termo”.");
  });

  it("busca com 2 resultados usa o plural", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": noArticles, "GET /search": { body: { mode: "lexical", degraded: false, items: [hit, hit2] } } });
    renderApp("/base");
    await searchFor("termo");
    await screen.findByRole("link", { name: "Impressora sem toner" });
    expect(screen.getByRole("status").textContent).toContain("2 resultados para “termo”.");
  });

  it("técnico filtra por Rascunho e a lista vem vazia: diz 'Nenhum artigo.', sem 'publicado'", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /articles": noArticles, "GET /search/status": { body: { embeddings: { enabled: false } } } });
    renderApp("/base");
    await userEvent.setup().selectOptions(await screen.findByLabelText("Situação"), "draft");
    expect(await screen.findByText("Nenhum artigo.")).toBeTruthy();
    expect(screen.queryByText("Nenhum artigo publicado.")).toBeNull();
  });

  it("técnico com filtro Todos e lista vazia: 'Nenhum artigo.'", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /articles": noArticles, "GET /search/status": { body: { embeddings: { enabled: false } } } });
    renderApp("/base");
    expect(await screen.findByText("Nenhum artigo.")).toBeTruthy();
    expect(screen.queryByText("Nenhum artigo publicado.")).toBeNull();
  });
});
