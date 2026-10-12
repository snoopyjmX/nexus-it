import { z } from "zod";
import { SUMMARY_FORMAT, type SummaryProvider } from "./summary.js";

// Formato conferido em docs.ollama.com/api/chat e em semana0/src/ollama.ts (2026-10-10).
const response = z.looseObject({ message: z.looseObject({ content: z.string() }) });

export interface OllamaSummaryOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

// Mesmos parâmetros da medição da Semana 0 (temperatura 0, seed 42, num_ctx 8192, sem "pensar").
export function createOllamaSummaryProvider({ baseUrl, model, timeoutMs }: OllamaSummaryOptions): SummaryProvider {
  return {
    model,
    async complete({ system, user }) {
      const res = await fetch(new URL("/api/chat", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: false,
          format: SUMMARY_FORMAT,
          think: false,
          keep_alive: "10m",
          options: { temperature: 0, seed: 42, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Ollama /api/chat respondeu ${res.status}`);
      return response.parse(await res.json()).message.content;
    },
  };
}
