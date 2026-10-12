import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Conjunto de desenvolvimento: os casos da Semana 0, copiados sem alteração. O conjunto de teste
// (dataset/test/) é escrito e congelado só pelo autor e nunca é gravado por código (CLAUDE.md).
export const DEV_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dataset/dev");
export const TEST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dataset/test");

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const DocumentSchema = z
  .object({
    id: Id,
    tipo: z.enum(["artigo", "chamado"]),
    categoria: z.string().min(1),
    titulo: z.string().min(1),
    sintoma: z.string().min(1),
    ambiente: z.string(),
    procedimento: z.string().min(1),
    resultado: z.string(),
    rascunho_llm: z.boolean().default(false),
  })
  .strict();
export type EvalDocument = z.infer<typeof DocumentSchema>;

export const QUERY_TYPES = ["direta", "parafrase", "sem_resposta", "ambigua", "injection"] as const;
export const QuerySchema = z
  .object({
    id: Id,
    texto: z.string().min(1),
    tipo: z.enum(QUERY_TYPES),
    categoria: z.string().min(1),
    // A abstenção é calibrada num grupo e conferida no outro.
    grupo: z.enum(["calibracao", "validacao"]).optional(),
  })
  .strict();
export type EvalQuery = z.infer<typeof QuerySchema>;

// consulta → ids dos documentos que respondem. Lista vazia = sem resposta no corpus.
export const GoldSchema = z.record(Id, z.array(Id));
export type Gold = z.infer<typeof GoldSchema>;

export interface Dataset {
  documents: EvalDocument[];
  queries: EvalQuery[];
  gold: Gold;
  // Hash dos três arquivos, na ordem corpus, consultas, gold: liga cada resultado aos dados medidos.
  version: string;
}

export function validateDataset(documents: EvalDocument[], queries: EvalQuery[], gold: Gold): void {
  const errors: string[] = [];
  const docIds = new Set<string>();
  for (const d of documents) {
    if (docIds.has(d.id)) errors.push(`documento duplicado: ${d.id}`);
    docIds.add(d.id);
  }
  const queryIds = new Set<string>();
  for (const q of queries) {
    if (queryIds.has(q.id)) errors.push(`consulta duplicada: ${q.id}`);
    queryIds.add(q.id);
    const expected = gold[q.id];
    if (!expected) {
      errors.push(`consulta ${q.id} sem entrada em gold`);
      continue;
    }
    for (const id of expected) if (!docIds.has(id)) errors.push(`gold de ${q.id} cita documento inexistente: ${id}`);
    if (q.tipo === "sem_resposta" && expected.length > 0) errors.push(`${q.id} é sem_resposta mas o gold tem fontes`);
    if (q.tipo !== "sem_resposta" && expected.length === 0) errors.push(`${q.id} é ${q.tipo} mas o gold está vazio`);
    if (q.tipo === "ambigua" && expected.length < 2) errors.push(`${q.id} é ambigua e precisa de 2+ fontes no gold`);
  }
  for (const id of Object.keys(gold)) if (!queryIds.has(id)) errors.push(`gold tem consulta inexistente: ${id}`);
  if (errors.length > 0) throw new Error(`Dados inconsistentes:\n- ${errors.join("\n- ")}`);
}

async function readJson<T>(dir: string, file: string, schema: z.ZodType<T>, hash: ReturnType<typeof createHash>): Promise<T> {
  let text: string;
  try {
    text = await readFile(path.join(dir, file), "utf8");
  } catch (error) {
    throw new Error(`Não consegui ler ${path.join(dir, file)}`, { cause: error });
  }
  hash.update(text);
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${file} inválido:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export async function loadDataset(dir: string): Promise<Dataset> {
  const hash = createHash("sha256");
  const documents = await readJson(dir, "corpus.json", z.array(DocumentSchema), hash);
  const queries = await readJson(dir, "consultas.json", z.array(QuerySchema), hash);
  const gold = await readJson(dir, "gold.json", GoldSchema, hash);
  validateDataset(documents, queries, gold);
  return { documents, queries, gold, version: hash.digest("hex").slice(0, 12) };
}
