import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article } from "./types";
import { ANA, TECH, loggedInAs, mockApi, renderApp } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const article = (over: Partial<Article> = {}): Article => ({
  id: "a-1",
  title: "Impressora de rede não imprime",
  symptom: "Fila parada.",
  environment: "Windows 11.",
  procedure: "1. Reinicie o spooler.",
  expectedResult: "Documento sai.",
  tags: ["impressora", "rede"],
  status: "draft",
  version: 1,
  author: { id: TECH.id, displayName: TECH.displayName },
  updatedAt: "2026-10-11T12:00:00.000Z",
  ...over,
});

describe("gestão da base: lista (FR-06)", () => {
  it("técnico vê rascunhos, o botão de novo artigo e filtra por situação", async () => {
    const calls = mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /articles": { body: { items: [article()], nextCursor: null } }, "GET /search/status": { body: { embeddings: { enabled: false } } } });
    renderApp("/base");
    expect(await screen.findByText("Rascunho")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Novo artigo" }).getAttribute("href")).toBe("/base/novo");
    await userEvent.setup().selectOptions(screen.getByLabelText("Situação"), "draft");
    await waitFor(() => expect(calls.some((c) => c.path.includes("status=draft"))).toBe(true));
  });

  it("solicitante não vê botão de novo artigo nem filtro de situação", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": { body: { items: [article({ status: "published" })], nextCursor: null } } });
    renderApp("/base");
    await screen.findByRole("link", { name: "Impressora de rede não imprime" });
    expect(screen.queryByRole("link", { name: "Novo artigo" })).toBeNull();
    expect(screen.queryByLabelText("Situação")).toBeNull();
    expect(screen.queryByText("Rascunho")).toBeNull();
  });
});

describe("gestão da base: criar e editar", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText("Título"), "  VPN cai  ");
    await user.type(screen.getByLabelText("Sintoma"), "Desconecta sozinha.");
    await user.type(screen.getByLabelText("Ambiente"), "Wi-Fi.");
    await user.type(screen.getByLabelText("Procedimento"), "Atualize o cliente.");
    await user.type(screen.getByLabelText("Resultado esperado"), "Conexão estável.");
  }

  it("cria o artigo; as tags viram lista normalizada e o artigo nasce como rascunho", async () => {
    const created = article({ id: "a-9", title: "VPN cai" });
    const calls = mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "POST /articles": { status: 201, body: created },
      "GET /articles/a-9": { body: created },
    });
    renderApp("/base/novo");
    const user = userEvent.setup();
    await fill(user);
    await user.type(screen.getByLabelText("Tags (separadas por vírgula)"), "VPN, wi-fi , vpn,,");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("heading", { name: "VPN cai" })).toBeTruthy();
    const post = calls.find((c) => c.method === "POST" && c.path === "/articles");
    expect(post?.body).toEqual({ title: "VPN cai", symptom: "Desconecta sozinha.", environment: "Wi-Fi.", procedure: "Atualize o cliente.", expectedResult: "Conexão estável.", tags: ["vpn", "wi-fi"] });
    expect(post?.headers["X-CSRF-Token"]).toBe("csrf-123");
  });

  it("erro 400 da API mostra a regra das tags e mantém o formulário preenchido", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "POST /articles": { status: 400, body: { detail: "Requisição inválida." } } });
    renderApp("/base/novo");
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Tags: até 10");
    expect((screen.getByLabelText("Sintoma") as HTMLTextAreaElement).value).toBe("Desconecta sozinha.");
  });

  it("solicitante que abre a tela de criar ou editar volta para a base", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": { body: { items: [], nextCursor: null } } });
    renderApp("/base/novo");
    expect(await screen.findByRole("heading", { name: "Base de conhecimento" })).toBeTruthy();
    cleanup();
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": { body: { items: [], nextCursor: null } } });
    renderApp("/base/a-1/editar");
    expect(await screen.findByRole("heading", { name: "Base de conhecimento" })).toBeTruthy();
  });

  it("edição carrega os valores, envia a versão e as tags", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles/a-1": { body: article({ version: 3 }) },
      "PATCH /articles/a-1": { body: article({ version: 4 }) },
    });
    renderApp("/base/a-1/editar");
    const user = userEvent.setup();
    const title = await screen.findByLabelText("Título");
    expect((title as HTMLInputElement).value).toBe("Impressora de rede não imprime");
    expect((screen.getByLabelText("Tags (separadas por vírgula)") as HTMLInputElement).value).toBe("impressora, rede");
    await user.clear(title);
    await user.type(title, "Impressora offline");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ version: 3, title: "Impressora offline", tags: ["impressora", "rede"] });
  });

  it("conflito de versão (409) pede para recarregar e não perde o que foi digitado", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles/a-1": { body: article() },
      "PATCH /articles/a-1": { status: 409, body: { detail: "O artigo foi alterado por outra pessoa." } },
    });
    renderApp("/base/a-1/editar");
    const user = userEvent.setup();
    const title = await screen.findByLabelText("Título");
    await user.type(title, " (rev)");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("alterado por outra pessoa");
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toContain("(rev)");
  });

  it("artigo que não existe (404) na edição mostra 'não encontrada'", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /articles/zz": { status: 404, body: {} } });
    renderApp("/base/zz/editar");
    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeTruthy();
  });
});

describe("gestão da base: publicar e despublicar (FR-06, FR-15)", () => {
  it("rascunho mostra Publicar; publicado mostra Despublicar", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles/a-1": () => ({ body: article({ status: calls.some((c) => c.path.endsWith("/publish")) ? "published" : "draft" }) }),
      "POST /articles/a-1/publish": { body: article({ status: "published" }) },
      "POST /articles/a-1/unpublish": { body: article() },
    });
    renderApp("/base/a-1");
    const user = userEvent.setup();
    expect(await screen.findByText("Rascunho")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    expect(await screen.findByRole("button", { name: "Despublicar" })).toBeTruthy();
    expect(screen.queryByText("Rascunho")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Despublicar" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/unpublish"))).toBe(true));
  });

  it("publicar de novo (422) mostra o motivo da API", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /articles/a-1": { body: article() },
      "POST /articles/a-1/publish": { status: 422, body: { detail: "O artigo já está publicado." } },
    });
    renderApp("/base/a-1");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Publicar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("já está publicado");
  });

  it("solicitante lendo artigo publicado não vê editar nem publicar", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles/a-1": { body: article({ status: "published" }) } });
    renderApp("/base/a-1");
    await screen.findByRole("heading", { name: "Impressora de rede não imprime" });
    for (const name of ["Publicar", "Despublicar"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("link", { name: "Editar artigo" })).toBeNull();
  });
});
