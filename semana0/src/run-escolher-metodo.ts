import { readFile } from "node:fs/promises";
import { z } from "zod";
import { escolherMetodo } from "./escolher-metodo.js";

const Contagem = z.object({ n: z.number(), hit1: z.number(), hit5: z.number(), mrr: z.number() });
const PorMetodo = z.object({ lexical: Contagem, vetorial: Contagem, hibrida: Contagem });
const Placar = z.record(z.string(), z.object({ ganha: z.number(), empata: z.number(), perde: z.number() }));
const Busca = z.object({
  analise: z.object({
    porTipo: z.record(z.string(), PorMetodo),
    comparacao: z.object({ vetorial: Placar, hibrida: Placar }),
  }),
});

const arquivo = process.argv[2];
if (!arquivo) throw new Error("Uso: pnpm escolher <resultados/...-busca.json>");
const { analise } = Busca.parse(JSON.parse(await readFile(arquivo, "utf8")));
const { metodo, motivo } = escolherMetodo(analise);
process.stderr.write(`Método de busca para a geração: ${metodo} (${motivo})\n`);
process.stdout.write(`${metodo}\n`);
