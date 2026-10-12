import { describe, expect, it } from "vitest";
import { can, scopeTicketsFor } from "../src/policy/index.js";
import { TICKET_VISIBILITY } from "../src/policy/visibility-matrix.js";

const tech = { id: "t1", role: "technician" as const };
const ana = { id: "r1", role: "requester" as const };
const bia = { id: "r2", role: "requester" as const };
const ticketOfAna = { requesterId: "r1" };

describe("política de autorização (T-01, T-02, FR-02)", () => {
  it("só solicitante abre chamado", () => {
    expect(can(ana, "ticket:create")).toBe(true);
    expect(can(tech, "ticket:create")).toBe(false);
  });

  it("solicitante lê, comenta e edita só o próprio chamado; técnico qualquer um", () => {
    for (const action of ["ticket:read", "ticket:comment", "ticket:update"] as const) {
      expect(can(ana, action, ticketOfAna), action).toBe(true);
      expect(can(bia, action, ticketOfAna), action).toBe(false);
      expect(can(tech, action, ticketOfAna), action).toBe(true);
    }
  });

  it("nega por padrão: ação desconhecida ou chamado ausente", () => {
    expect(can(ana, "ticket:apagar" as "ticket:read", ticketOfAna)).toBe(false);
    expect(can(ana, "ticket:read")).toBe(false);
  });

  it("escopo de listagem: solicitante é filtrado pelo dono, técnico não", () => {
    expect(scopeTicketsFor(ana, 3)).toEqual({ clause: "t.requester_id = $3", params: ["r1"] });
    expect(scopeTicketsFor(tech, 3)).toEqual({ clause: "TRUE", params: [] });
  });

  it("a matriz de visibilidade concorda com can() para cada célula", () => {
    const viewers = { "requester-owner": ana, "requester-other": bia, technician: tech };
    for (const [resource, row] of Object.entries(TICKET_VISIBILITY)) {
      for (const [viewer, visible] of Object.entries(row)) {
        const actor = viewers[viewer as keyof typeof viewers];
        expect(can(actor, "ticket:read", ticketOfAna), `${resource} / ${viewer}`).toBe(visible);
      }
    }
  });
});
