import { describe, expect, it } from "vitest";
import { can, scopeArticlesFor, scopeTicketsFor } from "../src/policy/index.js";
import { ARTICLE_VISIBILITY, DIAGNOSIS_VISIBILITY, TICKET_VISIBILITY } from "../src/policy/visibility-matrix.js";

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

describe("política da base de conhecimento (FR-06, FR-15)", () => {
  const draft = { status: "draft" as const };
  const published = { status: "published" as const };

  it("só técnico escreve na base", () => {
    expect(can(tech, "article:write")).toBe(true);
    expect(can(ana, "article:write")).toBe(false);
  });

  it("solicitante lê só artigo publicado; técnico lê qualquer um", () => {
    expect(can(ana, "article:read", published)).toBe(true);
    expect(can(ana, "article:read", draft)).toBe(false);
    expect(can(tech, "article:read", draft)).toBe(true);
    expect(can(tech, "article:read", published)).toBe(true);
    expect(can(ana, "article:read")).toBe(false);
  });

  it("escopo de listagem e busca: solicitante só publicado, técnico todos", () => {
    expect(scopeArticlesFor(ana)).toBe("a.status = 'published'");
    expect(scopeArticlesFor(tech)).toBe("TRUE");
  });

  it("a matriz de visibilidade concorda com can() para cada célula", () => {
    const viewers = { requester: ana, technician: tech };
    const states = { rascunho: draft, publicado: published };
    for (const [state, row] of Object.entries(ARTICLE_VISIBILITY)) {
      for (const [viewer, visible] of Object.entries(row)) {
        expect(can(viewers[viewer as keyof typeof viewers], "article:read", states[state as keyof typeof states]), `${state} / ${viewer}`).toBe(visible);
      }
    }
  });
});

describe("política do diagnóstico (FR-02, FR-09, FR-11)", () => {
  it("só técnico pede diagnóstico e avalia a execução", () => {
    for (const action of ["diagnosis:run", "diagnosis:feedback"] as const) {
      expect(can(tech, action), action).toBe(true);
      expect(can(ana, action), action).toBe(false);
    }
  });

  it("a matriz de visibilidade concorda com can() para cada célula", () => {
    const viewers = { requester: ana, technician: tech };
    for (const [resource, row] of Object.entries(DIAGNOSIS_VISIBILITY)) {
      for (const [viewer, visible] of Object.entries(row)) {
        expect(can(viewers[viewer as keyof typeof viewers], "diagnosis:run"), `${resource} / ${viewer}`).toBe(visible);
        expect(can(viewers[viewer as keyof typeof viewers], "diagnosis:feedback"), `${resource} / ${viewer}`).toBe(visible);
      }
    }
  });
});
