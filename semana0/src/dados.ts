import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "use só letras, números, _ e -");

export const Documento = z
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
export type Documento = z.infer<typeof Documento>;

export const TIPOS_CONSULTA = ["direta", "parafrase", "sem_resposta", "ambigua", "injection"] as const;
export type TipoConsulta = (typeof TIPOS_CONSULTA)[number];

export const Consulta = z
  .object({
    id: Id,
    texto: z.string().min(1),
    tipo: z.enum(TIPOS_CONSULTA),
    categoria: z.string().min(1),
    // Grupo da abstenção: o limiar é escolhido em "calibracao" e conferido em "validacao".
    grupo: z.enum(["calibracao", "validacao"]).optional(),
  })
  .strict();
export type Consulta = z.infer<typeof Consulta>;

// consulta → IDs de documentos que respondem. Lista vazia = sem resposta no corpus.
export const Gold = z.record(Id, z.array(Id));
export type Gold = z.infer<typeof Gold>;

export interface Dados {
  documentos: Documento[];
  consultas: Consulta[];
  gold: Gold;
  avisos: string[];
  versao: string; // hash dos três arquivos: amarra cada resultado aos dados medidos
}

async function lerJson(arquivo: string, hash: ReturnType<typeof createHash>): Promise<unknown> {
  try {
    const texto = await readFile(arquivo, "utf8");
    hash.update(texto);
    return JSON.parse(texto);
  } catch (error) {
    throw new Error(`Não consegui ler ${arquivo}`, { cause: error });
  }
}

function parse<T>(schema: z.ZodType<T>, valor: unknown, arquivo: string): T {
  const r = schema.safeParse(valor);
  if (!r.success) throw new Error(`${arquivo} inválido:\n${z.prettifyError(r.error)}`);
  return r.data;
}

// Erros de consistência impedem a medição; desvios do protocolo só viram aviso.
export function validar(documentos: Documento[], consultas: Consulta[], gold: Gold): string[] {
  const erros: string[] = [];
  const avisos: string[] = [];
  const idsDoc = new Set<string>();
  for (const d of documentos) {
    if (idsDoc.has(d.id)) erros.push(`documento duplicado: ${d.id}`);
    idsDoc.add(d.id);
  }
  const idsConsulta = new Set<string>();
  for (const c of consultas) {
    if (idsConsulta.has(c.id)) erros.push(`consulta duplicada: ${c.id}`);
    idsConsulta.add(c.id);
    const esperado = gold[c.id];
    if (!esperado) {
      erros.push(`consulta ${c.id} sem entrada em gold.json`);
      continue;
    }
    for (const id of esperado) if (!idsDoc.has(id)) erros.push(`gold de ${c.id} cita documento inexistente: ${id}`);
    if (c.tipo === "sem_resposta" && esperado.length > 0) erros.push(`${c.id} é sem_resposta mas o gold tem fontes`);
    if (c.tipo !== "sem_resposta" && esperado.length === 0) erros.push(`${c.id} é ${c.tipo} mas o gold está vazio`);
    if (c.tipo === "ambigua" && esperado.length < 2) erros.push(`${c.id} é ambigua e precisa de 2+ fontes no gold`);
    if (c.tipo === "sem_resposta" && !c.grupo) erros.push(`${c.id} é sem_resposta e precisa de grupo`);
  }
  for (const id of Object.keys(gold)) if (!idsConsulta.has(id)) erros.push(`gold.json tem consulta inexistente: ${id}`);
  if (erros.length > 0) throw new Error(`Dados inconsistentes:\n- ${erros.join("\n- ")}`);

  const esperado: Record<TipoConsulta, number> = { direta: 8, parafrase: 10, sem_resposta: 8, ambigua: 2, injection: 2 };
  for (const tipo of TIPOS_CONSULTA) {
    const n = consultas.filter((c) => c.tipo === tipo).length;
    if (n !== esperado[tipo]) avisos.push(`${tipo}: ${n} consultas (protocolo pede ${esperado[tipo]})`);
  }
  const semResposta = consultas.filter((c) => c.tipo === "sem_resposta");
  const calib = semResposta.filter((c) => c.grupo === "calibracao").length;
  if (calib !== semResposta.length - calib) avisos.push(`sem_resposta: ${calib} calibram e ${semResposta.length - calib} validam (protocolo pede 4/4)`);
  for (const grupo of ["calibracao", "validacao"] as const) {
    if (!consultas.some((c) => c.tipo !== "sem_resposta" && c.grupo === grupo)) {
      avisos.push(`nenhuma respondível no grupo ${grupo}: a abstenção não mede quantas respondíveis o limiar perderia ali`);
    }
  }
  return avisos;
}

export async function carregar(dir: string): Promise<Dados> {
  const hash = createHash("sha256");
  const documentos = parse(z.array(Documento), await lerJson(path.join(dir, "corpus.json"), hash), "corpus.json");
  const consultas = parse(z.array(Consulta), await lerJson(path.join(dir, "consultas.json"), hash), "consultas.json");
  const gold = parse(Gold, await lerJson(path.join(dir, "gold.json"), hash), "gold.json");
  const avisos = validar(documentos, consultas, gold);
  return { documentos, consultas, gold, avisos, versao: hash.digest("hex").slice(0, 12) };
}
