import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "deve começar com postgres:// ou postgresql://"),
  // Busca vetorial (ADR-007). Desligada por padrão: sem Ollama tudo funciona só com a busca por palavras.
  EMBEDDINGS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  EMBEDDING_MODEL: z.string().min(1).default("bge-m3"),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
  // Limiar medido na Semana 0 (ADR-007); ponto de partida, recalibrar na base real.
  VECTOR_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5393),
  // Diagnóstico (ADR-011): true aplica o corte do limiar quando a busca é vetorial. O padrão é false até a
  // recalibração na base real ser registrada (ADR-007): fontes rotuladas "evidência não verificada" (FR-10).
  DIAGNOSIS_THRESHOLD_TRUSTED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Resumo opcional por modelo (ADR-008, opção B). Desligado até a re-medição da Fase 4 (p50 de até 20 s).
  LLM_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  LLM_MODEL: z.string().min(1).default("gemma3:4b"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(60_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

// Falha na inicialização em vez de falhar no primeiro uso. A mensagem cita
// só o nome da variável e o motivo, nunca o valor (pode conter senha).
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Configuração inválida:\n${problems.join("\n")}`);
  }
  return result.data;
}
