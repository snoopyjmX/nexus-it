import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./demo/recorded.json";
import { renderApp } from "./test-utils";

// Usa a gravação de verdade (apps/web/src/demo/recorded.json, feita por `pnpm demo:record`): se alguém regravar algo
// incompleto, estes testes quebram. Nada aqui depende do conteúdo dos textos, só da cobertura.
const responses = recorded as unknown as Record<string, { status: number; body: unknown }>;
const body = <T,>(key: string) => responses[key]?.body as T;

interface Item {
  id: string;
  title: string;
  status: string;
}

const tickets = body<{ items: Item[] }>("GET /tickets").items;
const articles = body<{ items: Item[] }>("GET /articles?limit=50").items;

beforeEach(() => {
  vi.stubEnv("VITE_DEMO", "true");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a gravação da demonstração", () => {
  it("entra como técnico e tem fila e base", () => {
    expect(body<{ user: { role: string } }>("GET /auth/me").user.role).toBe("technician");
    expect(tickets.length).toBeGreaterThan(0);
    expect(articles.length).toBeGreaterThan(0);
  });

  it("todo chamado da fila tem detalhe, comentários e eventos", () => {
    for (const { id } of tickets) {
      for (const key of [`GET /tickets/${id}`, `GET /tickets/${id}/comments`, `GET /tickets/${id}/events`]) expect(responses[key], key).toBeDefined();
    }
  });

  it("todo artigo da lista tem detalhe", () => {
    for (const { id } of articles) expect(responses[`GET /articles/${id}`], id).toBeDefined();
  });

  it("os chamados abertos têm diagnóstico gravado, com as fontes e sem nenhum campo de pontuação", () => {
    const open = tickets.filter((ticket) => ticket.status === "open");
    expect(open.length).toBeGreaterThan(0);
    for (const { id } of open) {
      const diagnosis = responses[`POST /tickets/${id}/diagnosis`];
      expect(diagnosis?.status, id).toBe(201);
      expect(JSON.stringify(diagnosis?.body)).not.toMatch(/"score"/);
    }
  });

  it("não leva credencial, caminho local nem e-mail fora do domínio fictício", () => {
    // O arquivo é público: uma regravação futura não pode trazer nada disso sem este teste cair.
    const text = JSON.stringify(recorded);
    expect(text).not.toMatch(/password|passwd|senha_hash|postgres:\/\//i);
    expect(text).not.toMatch(/\/Users\/|\/home\/|\/private\/|127\.0\.0\.1|localhost|eyJ|Bearer |set-cookie/i);
    for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email).toMatch(/@exemplo\.local$/);
    expect(body<{ csrfToken: string }>("GET /auth/me").csrfToken).toBe("demo");
  });

  it("nenhum diagnóstico gravado traz texto de modelo (seria dado público sem revisão)", () => {
    for (const [key, answer] of Object.entries(responses)) {
      if (key.endsWith("/diagnosis")) expect((answer.body as { llm?: string }).llm, key).toBe("off");
    }
  });
});

describe("as telas com a gravação real", () => {
  it("fila: lista todos os chamados gravados, com o aviso de demonstração", async () => {
    renderApp("/chamados");
    expect(await screen.findByRole("link", { name: tickets[0]?.title ?? "" })).toBeDefined();
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/chamados/") && link.getAttribute("href") !== "/chamados/novo")).toHaveLength(tickets.length);
    expect(screen.getByRole("note").textContent).toMatch(/gravad/i);
  });

  it("detalhe de um chamado aberto: gera o diagnóstico gravado, com as fontes", async () => {
    const open = tickets.find((ticket) => ticket.status === "open");
    renderApp(`/chamados/${open?.id}`);
    await userEvent.click(await screen.findByRole("button", { name: "Gerar diagnóstico" }));
    const sources = await screen.findByRole("region", { name: "Fontes" });
    expect(within(sources).getAllByRole("link").length).toBeGreaterThan(0);
  });

  it("base: lista os artigos e abre um", async () => {
    renderApp("/base");
    await userEvent.click(await screen.findByRole("link", { name: articles[0]?.title ?? "" }));
    expect(await screen.findByRole("heading", { level: 1, name: articles[0]?.title ?? "" })).toBeDefined();
  });

  it("laboratório: mostra as execuções gravadas", async () => {
    renderApp("/laboratorio");
    expect(await screen.findByRole("table", { name: "Execuções" })).toBeDefined();
  });
});
