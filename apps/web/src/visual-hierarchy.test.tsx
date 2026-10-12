import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIORITY_TONE, STATUS_TONE } from "./labels";
import type { Ticket } from "./types";
import { ANA, TECH, loggedInAs, mockApi, renderApp } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    title: "Impressora não imprime",
    description: "Fila trava no setor 3.",
    category: "hardware",
    priority: "medium",
    status: "open",
    requester: { id: ANA.id, displayName: ANA.displayName },
    assignee: null,
    resolutionNote: null,
    version: 1,
    createdAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
    ...over,
  };
}

const detailRoutes = (t: Ticket) => ({
  [`GET /tickets/${t.id}`]: { body: t },
  [`GET /tickets/${t.id}/comments`]: { body: { items: [] } },
  [`GET /tickets/${t.id}/events`]: { body: { items: [] } },
});

// NFR-06: a cor reforça, nunca é a única pista; o texto do selo continua dizendo o valor.
describe("hierarquia visual (NFR-06)", () => {
  it("só o que pede atenção ganha tom; o resto fica neutro", () => {
    expect(PRIORITY_TONE).toEqual({ low: "neutral", medium: "neutral", high: "warn", urgent: "danger" });
    expect(STATUS_TONE.open).toBe("info");
    expect(STATUS_TONE.waiting_requester).toBe("warn");
    expect(STATUS_TONE.resolved).toBe("success");
    expect([STATUS_TONE.in_progress, STATUS_TONE.closed, STATUS_TONE.cancelled]).toEqual(["neutral", "neutral", "neutral"]);
  });

  it("fila: o selo urgente é vermelho e o selo de prioridade baixa não", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "GET /tickets": { body: { items: [ticket({ id: "t-1", title: "Um", priority: "urgent" }), ticket({ id: "t-2", title: "Dois", priority: "low" })], nextCursor: null } },
    });
    renderApp("/chamados");
    await screen.findByRole("link", { name: "Um" });
    expect(screen.getByText("Urgente", { selector: "span" }).className).toContain("bg-red-50");
    expect(screen.getByText("Baixa", { selector: "span" }).className).not.toContain("bg-red-50");
  });

  it("detalhe: cancelar chamado não usa o estilo da ação principal", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), ...detailRoutes(ticket()) });
    renderApp("/chamados/t-1");
    const cancel = await screen.findByRole("button", { name: "Cancelar chamado" });
    expect(cancel.className).not.toContain("bg-blue-700");
    expect(cancel.className).toContain("text-red-800");
  });

  it("cabeçalho: sair não compete com a ação da página", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /tickets": { body: { items: [], nextCursor: null } } });
    renderApp("/chamados");
    expect((await screen.findByRole("button", { name: "Sair" })).className).not.toContain("bg-blue-700");
  });
});
