import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setCsrfToken } from "./api";
import { createQueryClient, ME_KEY } from "./queryClient";
import { mockApi } from "./test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("cliente da API", () => {
  it("manda o token CSRF só em requisições que alteram", async () => {
    const calls = mockApi({ "GET /x": {}, "POST /x": {}, "PATCH /x": {} });
    setCsrfToken("tok");
    await api("GET", "/x");
    await api("POST", "/x", {});
    await api("PATCH", "/x", { a: 1 });
    expect(calls.map((c) => c.headers["X-CSRF-Token"])).toEqual([undefined, "tok", "tok"]);
  });

  it("não manda token que não existe", async () => {
    const calls = mockApi({ "POST /x": {} });
    await api("POST", "/x", {});
    expect(calls[0]?.headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("erro vira ApiError com status e o detalhe seguro da API", async () => {
    mockApi({ "GET /x": { status: 409, body: { detail: "O chamado foi alterado." } } });
    await expect(api("GET", "/x")).rejects.toMatchObject({ status: 409, detail: "O chamado foi alterado." });
  });

  it("erro sem corpo JSON ainda vira ApiError, sem vazar o texto bruto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>erro interno</html>", { status: 502 })));
    const error = await api("GET", "/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toBeUndefined();
  });

  it("resposta 204 devolve vazio", async () => {
    mockApi({ "POST /x": { status: 204 } });
    expect(await api("POST", "/x")).toBeUndefined();
  });
});

describe("sessão encerrada no meio do uso", () => {
  it("um 401 em qualquer consulta ou mutação derruba o usuário em memória", async () => {
    const client = createQueryClient();
    client.setQueryData(ME_KEY, { id: "1" });
    await client.fetchQuery({ queryKey: ["x"], queryFn: () => Promise.reject(new ApiError(401)), retry: false }).catch(() => undefined);
    // fetchQuery não passa pelo cache de erros de observadores; usa o mutation cache também.
    await client.getMutationCache().build(client, { mutationFn: () => Promise.reject(new ApiError(401)) }).execute(undefined).catch(() => undefined);
    expect(client.getQueryData(ME_KEY)).toBeNull();
  });

  it("outros erros não derrubam a sessão", async () => {
    const client = createQueryClient();
    client.setQueryData(ME_KEY, { id: "1" });
    await client.getMutationCache().build(client, { mutationFn: () => Promise.reject(new ApiError(500)) }).execute(undefined).catch(() => undefined);
    expect(client.getQueryData(ME_KEY)).toEqual({ id: "1" });
  });
});
