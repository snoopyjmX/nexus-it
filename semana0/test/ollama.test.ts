import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarOllama } from "../src/ollama.js";

const recebidos: { url: string; corpo: Record<string, unknown> }[] = [];
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: {} };
let server: Server;
let base: string;

async function ler(req: IncomingMessage): Promise<string> {
  let s = "";
  for await (const parte of req) s += parte;
  return s;
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const texto = await ler(req);
    recebidos.push({ url: req.url ?? "", corpo: texto ? JSON.parse(texto) : {} });
    res.writeHead(resposta.status, { "content-type": "application/json" }).end(JSON.stringify(resposta.corpo));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe("cliente Ollama", () => {
  it("chat envia temperatura 0, seed, schema em format, think=false e sem streaming", async () => {
    resposta = { status: 200, corpo: { model: "m", message: { role: "assistant", content: "{}" }, total_duration: 1 } };
    const formato = { type: "object" };
    const r = await criarOllama(base).chat({ modelo: "m", mensagens: [{ role: "user", content: "oi" }], formato, seed: 7, numCtx: 4096 });
    expect(r.message.content).toBe("{}");
    expect(recebidos.at(-1)).toMatchObject({
      url: "/api/chat",
      corpo: { model: "m", stream: false, think: false, format: formato, options: { temperature: 0, seed: 7, num_ctx: 4096 } },
    });
  });

  it("embed envia a lista de textos e devolve um vetor por texto", async () => {
    resposta = { status: 200, corpo: { model: "bge-m3", embeddings: [[0.1], [0.2]] } };
    expect(await criarOllama(base).embed("bge-m3", ["a", "b"])).toEqual([[0.1], [0.2]]);
    expect(recebidos.at(-1)).toMatchObject({ url: "/api/embed", corpo: { model: "bge-m3", input: ["a", "b"], truncate: false } });
  });

  it("embed recusa resposta com número de vetores diferente", async () => {
    resposta = { status: 200, corpo: { model: "bge-m3", embeddings: [[0.1]] } };
    await expect(criarOllama(base).embed("bge-m3", ["a", "b"])).rejects.toThrow(/número de vetores/);
  });

  it("descarregar pede keep_alive 0 com mensagens vazias", async () => {
    resposta = { status: 200, corpo: {} };
    await criarOllama(base).descarregar("m");
    expect(recebidos.at(-1)).toMatchObject({ url: "/api/chat", corpo: { model: "m", messages: [], keep_alive: 0 } });
  });

  it("erro HTTP vira exceção com o status", async () => {
    resposta = { status: 404, corpo: { error: "model not found" } };
    await expect(criarOllama(base).chat({ modelo: "x", mensagens: [], formato: {}, seed: 1, numCtx: 1 })).rejects.toThrow(/404/);
  });

  it("resposta fora do formato esperado é rejeitada", async () => {
    resposta = { status: 200, corpo: { model: "m" } };
    await expect(criarOllama(base).chat({ modelo: "m", mensagens: [], formato: {}, seed: 1, numCtx: 1 })).rejects.toThrow();
  });
});
