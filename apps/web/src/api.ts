export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ?? `HTTP ${status}`);
  }
}

// O token CSRF vem de /auth/me e fica só em memória (ADR-004, ADR-010): nunca em localStorage.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type Method = "GET" | "POST" | "PATCH";

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  // Build de demonstração (ADR-003): nunca chama a rede. A comparação fica aqui, inline, para o build normal descartar o ramo.
  if (import.meta.env.VITE_DEMO === "true") return (await import("./demo")).demoApi<T>(method, path);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    // problem+json: só o `detail` (texto seguro, escrito pela API) vai para a tela.
    const problem = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(response.status, typeof problem?.detail === "string" ? problem.detail : undefined);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
