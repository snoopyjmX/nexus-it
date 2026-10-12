import { describe, expect, it } from "vitest";
import { checkTransition, STATUSES, type Actor, type Status } from "../src/modules/tickets/transitions.js";

// Cada linha da tabela do ARCHITECTURE §3 é um teste (FR-04).
const tech: Actor = { id: "t1", role: "technician" };
const owner: Actor = { id: "r1", role: "requester" };
const stranger: Actor = { id: "r2", role: "requester" };

const ticket = (status: Status, assigneeId: string | null = null) => ({ status, requesterId: "r1", assigneeId });

describe("tabela de transições do chamado (FR-04)", () => {
  const allowed: { from: Status; to: Status; who: Actor[]; extra?: object }[] = [
    { from: "open", to: "in_progress", who: [tech] },
    { from: "open", to: "cancelled", who: [owner, tech] },
    { from: "in_progress", to: "waiting_requester", who: [tech], extra: { comment: "Falta o número do patrimônio." } },
    { from: "waiting_requester", to: "in_progress", who: [owner, tech] },
    { from: "in_progress", to: "resolved", who: [tech], extra: { resolutionNote: "Cabo trocado." } },
    { from: "resolved", to: "in_progress", who: [owner], extra: { comment: "O erro voltou hoje cedo." } },
    { from: "resolved", to: "closed", who: [owner, tech] },
  ];

  for (const row of allowed) {
    for (const actor of row.who) {
      it(`${row.from} → ${row.to} permitido para ${actor.role === "technician" ? "técnico" : "dono"}`, () => {
        const result = checkTransition(actor, ticket(row.from), { to: row.to, ...row.extra });
        expect(result.ok).toBe(true);
      });
    }
  }

  it("todo par fora da tabela é recusado como transição inválida", () => {
    const edges = new Set(allowed.map((row) => `${row.from}>${row.to}`));
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (edges.has(`${from}>${to}`)) continue;
        const result = checkTransition(tech, ticket(from), { to, comment: "x", resolutionNote: "x" });
        expect(result, `${from} → ${to}`).toMatchObject({ ok: false, kind: "not-allowed" });
      }
    }
  });

  it("closed e cancelled são terminais", () => {
    for (const from of ["closed", "cancelled"] as const) {
      for (const to of STATUSES) {
        expect(checkTransition(tech, ticket(from), { to, comment: "x", resolutionNote: "x" })).toMatchObject({ ok: false, kind: "not-allowed" });
      }
    }
  });

  it("recusa por papel quando a aresta existe mas o ator não pode usá-la", () => {
    expect(checkTransition(owner, ticket("open"), { to: "in_progress" })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(checkTransition(owner, ticket("in_progress"), { to: "resolved", resolutionNote: "x" })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(checkTransition(tech, ticket("resolved"), { to: "in_progress", comment: "x" })).toMatchObject({ ok: false, kind: "forbidden" });
  });

  it("solicitante que não é dono nunca pode, mesmo na aresta aberta ao dono", () => {
    expect(checkTransition(stranger, ticket("open"), { to: "cancelled" })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(checkTransition(stranger, ticket("resolved"), { to: "closed" })).toMatchObject({ ok: false, kind: "forbidden" });
  });

  it("exige comentário ao pedir informação e ao reabrir", () => {
    expect(checkTransition(tech, ticket("in_progress"), { to: "waiting_requester" })).toMatchObject({ ok: false, kind: "missing" });
    expect(checkTransition(tech, ticket("in_progress"), { to: "waiting_requester", comment: "   " })).toMatchObject({ ok: false, kind: "missing" });
    expect(checkTransition(owner, ticket("resolved"), { to: "in_progress" })).toMatchObject({ ok: false, kind: "missing" });
  });

  it("exige nota de resolução", () => {
    expect(checkTransition(tech, ticket("in_progress"), { to: "resolved" })).toMatchObject({ ok: false, kind: "missing" });
    expect(checkTransition(tech, ticket("in_progress"), { to: "resolved", resolutionNote: "  " })).toMatchObject({ ok: false, kind: "missing" });
  });

  it("ao iniciar, o responsável padrão é o próprio técnico, e pode ser outro", () => {
    expect(checkTransition(tech, ticket("open"), { to: "in_progress" })).toMatchObject({ ok: true, assigneeId: "t1" });
    expect(checkTransition(tech, ticket("open"), { to: "in_progress", assigneeId: "t2" })).toMatchObject({ ok: true, assigneeId: "t2" });
  });

  it("devolve os textos já aparados para quem grava", () => {
    expect(checkTransition(tech, ticket("in_progress"), { to: "resolved", resolutionNote: "  Cabo trocado.  " })).toMatchObject({
      ok: true,
      resolutionNote: "Cabo trocado.",
    });
  });
});
