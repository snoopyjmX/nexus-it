import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { App } from "./App";
import { setCsrfToken } from "./api";

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; body?: unknown };
type Handler = Reply | ((call: Call) => Reply);

// `fetch` simulado: cada chave é "MÉTODO /caminho". Rota sem resposta falha o teste.
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = String(input).replace("/api/v1", "");
      const call: Call = {
        method,
        path,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const handler = routes[`${method} ${path.split("?")[0]}`];
      if (!handler) throw new Error(`rota não simulada: ${method} ${path}`);
      const reply = typeof handler === "function" ? handler(call) : handler;
      const status = reply.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status,
        headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
      });
    }),
  );
  return calls;
}

export const TECH = { id: "u-tech", email: "tecnico@exemplo.local", displayName: "Técnico Um", role: "technician" } as const;
export const ANA = { id: "u-ana", email: "ana@exemplo.local", displayName: "Ana", role: "requester" } as const;

export const loggedInAs = (user: typeof TECH | typeof ANA, csrfToken = "csrf-123") => ({ body: { user, csrfToken } });
export const unauthenticated = { status: 401, body: { title: "Unauthorized", status: 401, detail: "Autenticação necessária." } };

export function renderApp(path = "/") {
  setCsrfToken(null);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
