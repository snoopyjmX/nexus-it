import { z } from "zod";

// Formatos conferidos em docs.ollama.com/api/chat e /api/embed (2026-10-10).
const EmbedResposta = z.object({ model: z.string(), embeddings: z.array(z.array(z.number())) });

// looseObject: valida o que usamos e preserva o resto (thinking, prompt_eval_duration...)
// para o resultado guardar a resposta bruta, como pede o passo 7.
const ChatResposta = z.looseObject({
  model: z.string(),
  message: z.looseObject({ role: z.string(), content: z.string() }),
  load_duration: z.number().optional(),
  prompt_eval_duration: z.number().optional(),
});
export type ChatResposta = z.infer<typeof ChatResposta>;

export interface Mensagem {
  role: "system" | "user";
  content: string;
}

export interface OpcoesChat {
  modelo: string;
  mensagens: Mensagem[];
  formato: object; // JSON Schema
  seed: number;
  numCtx: number;
}

export function criarOllama(baseUrl: string, timeoutMs = 300_000) {
  async function post(rota: string, corpo: object): Promise<unknown> {
    const res = await fetch(new URL(rota, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama ${rota} respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  return {
    async embed(modelo: string, textos: string[]): Promise<number[][]> {
      const r = EmbedResposta.parse(await post("/api/embed", { model: modelo, input: textos, truncate: false }));
      if (r.embeddings.length !== textos.length) throw new Error("Ollama devolveu número de vetores diferente do enviado");
      return r.embeddings;
    },

    async chat(o: OpcoesChat): Promise<ChatResposta> {
      return ChatResposta.parse(
        await post("/api/chat", {
          model: o.modelo,
          messages: o.mensagens,
          stream: false,
          format: o.formato,
          think: false,
          keep_alive: "10m",
          options: { temperature: 0, seed: o.seed, num_ctx: o.numCtx },
        }),
      );
    },

    // /api/ps e /api/tags guardados crus no resultado (memória, CPU/GPU, digest do modelo).
    async estado(rota: "/api/ps" | "/api/tags"): Promise<unknown> {
      const res = await fetch(new URL(rota, baseUrl), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Ollama ${rota} respondeu ${res.status}`);
      return res.json();
    },

    // Descarrega o modelo para medir a chamada fria.
    async descarregar(modelo: string): Promise<void> {
      await post("/api/chat", { model: modelo, messages: [], keep_alive: 0 });
    },
  };
}
export type Ollama = ReturnType<typeof criarOllama>;
