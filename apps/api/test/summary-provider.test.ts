import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaSummaryProvider } from "../src/modules/diagnosis/summary-provider.js";

afterEach(() => vi.unstubAllGlobals());

const options = { baseUrl: "http://ollama.exemplo.local:11434", model: "gemma3:4b", timeoutMs: 5000 };
const prompt = { system: "regras", user: "dados" };

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("provedor Ollama do resumo (ADR-008)", () => {
  it("chama /api/chat com o formato medido na Semana 0 e devolve o conteúdo", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ model: "gemma3:4b", message: { role: "assistant", content: '{"resumo":"a","fontes":["F1"]}' }, done: true })));
    const provider = createOllamaSummaryProvider(options);
    expect(provider.model).toBe("gemma3:4b");
    expect(await provider.complete(prompt)).toBe('{"resumo":"a","fontes":["F1"]}');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://ollama.exemplo.local:11434/api/chat");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gemma3:4b",
      messages: [
        { role: "system", content: "regras" },
        { role: "user", content: "dados" },
      ],
      stream: false,
      think: false,
      keep_alive: "10m",
      options: { temperature: 0, seed: 42, num_ctx: 8192 },
      format: { type: "object", required: ["resumo", "fontes"] },
    });
  });

  it("lança em status de erro e em resposta fora do formato, sem repassar o corpo", async () => {
    stubFetch(new Response("modelo não encontrado: segredo-interno", { status: 404 }));
    await expect(createOllamaSummaryProvider(options).complete(prompt)).rejects.toThrow(/404/);
    stubFetch(new Response(JSON.stringify({ message: {} })));
    await expect(createOllamaSummaryProvider(options).complete(prompt)).rejects.toThrow();
    stubFetch(new Response("modelo não encontrado: segredo-interno", { status: 500 }));
    await expect(createOllamaSummaryProvider(options).complete(prompt)).rejects.not.toThrow(/segredo-interno/);
  });

  it("propaga falha de rede", async () => {
    stubFetch(new TypeError("fetch failed"));
    await expect(createOllamaSummaryProvider(options).complete(prompt)).rejects.toThrow("fetch failed");
  });
});
