import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANA, TECH, loggedInAs, mockApi, renderApp, unauthenticated } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("acesso (FR-01, FR-02)", () => {
  it("sem sessão, qualquer página leva ao login", async () => {
    mockApi({ "GET /auth/me": unauthenticated });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Entrar no NEXUS IT" })).toBeTruthy();
  });

  it("login correto mostra a página inicial e envia as credenciais como JSON", async () => {
    let logged = false;
    const calls = mockApi({
      "GET /auth/me": () => (logged ? loggedInAs(ANA) : unauthenticated),
      "POST /auth/login": () => {
        logged = true;
        return { body: { user: ANA } };
      },
    });
    renderApp("/");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@exemplo.local");
    await user.type(screen.getByLabelText("Senha"), "senha-longa-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Olá, Ana" })).toBeTruthy();
    expect(screen.getByText("Você está como solicitante.")).toBeTruthy();
    const login = calls.find((c) => c.path === "/auth/login");
    expect(login?.body).toEqual({ email: "ana@exemplo.local", password: "senha-longa-123" });
  });

  it("senha errada mostra mensagem genérica e continua no formulário", async () => {
    mockApi({
      "GET /auth/me": unauthenticated,
      "POST /auth/login": { status: 401, body: { detail: "Credenciais inválidas." } },
    });
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@exemplo.local");
    await user.type(screen.getByLabelText("Senha"), "errada");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("E-mail ou senha incorretos.");
    expect(screen.getByRole("heading", { name: "Entrar no NEXUS IT" })).toBeTruthy();
  });

  it("limite de tentativas (429) tem mensagem própria", async () => {
    mockApi({
      "GET /auth/me": unauthenticated,
      "POST /auth/login": { status: 429, body: { detail: "Muitas tentativas." } },
    });
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@exemplo.local");
    await user.type(screen.getByLabelText("Senha"), "qualquer");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Muitas tentativas");
  });

  it("sair envia o token CSRF e volta ao login", async () => {
    let logged = true;
    const calls = mockApi({
      "GET /auth/me": () => (logged ? loggedInAs(TECH, "csrf-do-tecnico") : unauthenticated),
      "POST /auth/login": { status: 401, body: {} },
      "POST /auth/logout": () => {
        logged = false;
        return { status: 204 };
      },
    });
    renderApp("/");
    const user = userEvent.setup();
    expect(await screen.findByText("Você está como técnico.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("heading", { name: "Entrar no NEXUS IT" })).toBeTruthy();
    const logout = calls.find((c) => c.path === "/auth/logout");
    expect(logout?.headers["X-CSRF-Token"]).toBe("csrf-do-tecnico");

    // Depois de sair, o token antigo não acompanha o próximo login.
    await user.type(screen.getByLabelText("E-mail"), "outra@exemplo.local");
    await user.type(screen.getByLabelText("Senha"), "x");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByRole("alert");
    expect(calls.filter((c) => c.path === "/auth/login").every((c) => !("X-CSRF-Token" in c.headers))).toBe(true);
    // O token vive só em memória (ADR-010).
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("falha inesperada do servidor mostra aviso genérico, sem texto do servidor", async () => {
    mockApi({
      "GET /auth/me": unauthenticated,
      "POST /auth/login": { status: 500, body: { detail: "stack interno" } },
    });
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@exemplo.local");
    await user.type(screen.getByLabelText("Senha"), "qualquer");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível entrar agora. Tente de novo.");
  });

  it("quem já está logado não vê o formulário de login", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA) });
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: "Olá, Ana" })).toBeTruthy();
  });

  it("depois do login volta para a página que foi pedida", async () => {
    let logged = false;
    mockApi({
      "GET /auth/me": () => (logged ? loggedInAs(ANA) : unauthenticated),
      "POST /auth/login": () => {
        logged = true;
        return { body: { user: ANA } };
      },
    });
    renderApp("/nao-existe");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@exemplo.local");
    await user.type(screen.getByLabelText("Senha"), "senha-longa-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeTruthy();
  });
});

describe("estrutura e acessibilidade (NFR-06)", () => {
  it("tem link para pular ao conteúdo, navegação com nome e uma região principal", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA) });
    renderApp("/");
    await screen.findByRole("heading", { name: "Olá, Ana" });
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" }).getAttribute("href")).toBe("#conteudo");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("página inexistente mostra aviso com caminho de volta", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA) });
    renderApp("/qualquer-coisa");
    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href")).toBe("/");
  });

  it("o formulário de login mostra o carregamento sem deixar enviar duas vezes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = mockApi({ "GET /auth/me": unauthenticated, "POST /auth/login": { status: 401, body: {} } });
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith("/auth/login")) await gate;
      return inner(input, init);
    }));
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "a@b.c");
    await user.type(screen.getByLabelText("Senha"), "x");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    const busy = await screen.findByRole("button", { name: "Entrando…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(original.filter((c) => c.path === "/auth/login")).toHaveLength(1);
  });
});
