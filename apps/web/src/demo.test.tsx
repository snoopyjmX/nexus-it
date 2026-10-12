import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { renderApp } from "./test-utils";

// ADR-003: a demo estática responde com o que foi gravado numa execução local real e nunca chama a rede.
const TECH = { id: "u-1", email: "tecnico@exemplo.local", displayName: "Técnico Demo", role: "technician" };
const PERSON = { id: "u-2", displayName: "Solicitante" };
const TICKET = { id: "t-1", title: "Impressora do andar travada", category: "hardware", priority: "medium", status: "open", requester: PERSON, assignee: null, version: 1, createdAt: "2026-10-12T10:00:00.000Z", updatedAt: "2026-10-12T10:00:00.000Z" };

vi.mock("./demo/recorded.json", () => ({
  default: {
    "GET /ok": { status: 200, body: { valor: 1 } },
    "GET /falha": { status: 409, body: { detail: "Versão antiga." } },
    "POST /gravado": { status: 201, body: { feito: true } },
    "GET /auth/me": { status: 200, body: { user: TECH, csrfToken: "demo" } },
    "GET /tickets": { status: 200, body: { items: [TICKET], nextCursor: null } },
    "GET /tickets/t-1": { status: 200, body: { ...TICKET, description: "Fila travada." } },
    "GET /tickets/t-1/comments": { status: 200, body: { items: [] } },
    "GET /tickets/t-1/events": { status: 200, body: { items: [] } },
  },
}));

let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("VITE_DEMO", "true");
  network = vi.fn();
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("api() em modo demo", () => {
  it("serve a resposta gravada e não chama a rede", async () => {
    expect(await api("GET", "/ok")).toEqual({ valor: 1 });
    expect(await api("POST", "/gravado", {})).toEqual({ feito: true });
    expect(network).not.toHaveBeenCalled();
  });

  it("resposta gravada com erro vira ApiError com o mesmo status e texto", async () => {
    await expect(api("GET", "/falha")).rejects.toMatchObject({ status: 409, detail: "Versão antiga." });
  });

  it("consulta que não foi gravada diz isso (404)", async () => {
    const error = await api("GET", "/outro").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, detail: expect.stringContaining("não foi gravada") });
  });

  it("escrita que não foi gravada é recusada e diz que só vale na versão local (403)", async () => {
    const error = await api("PATCH", "/tickets/t-1", { version: 1 }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 403, detail: expect.stringContaining("só funciona na versão local") });
    expect(network).not.toHaveBeenCalled();
  });
});

describe("telas em modo demo", () => {
  it("mostra o aviso de que tudo é gravado e não oferece sair", async () => {
    renderApp("/chamados");
    expect(await screen.findByRole("link", { name: TICKET.title })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/gravad/i);
    expect(screen.queryByRole("button", { name: "Sair" })).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("uma ação de escrita mostra o motivo em vez de falhar em silêncio", async () => {
    renderApp("/chamados/t-1");
    await userEvent.click(await screen.findByRole("button", { name: "Iniciar atendimento" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/só funciona na versão local/);
  });
});
