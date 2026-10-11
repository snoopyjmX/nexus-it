import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { METODOS } from "./analise.js";
import { carregar } from "./dados.js";
import { avaliar, Caso, contextoDoCaso, estavel, FORMATO, montarMensagens, percentil, resumir, validarCasos } from "./geracao.js";
import { criarOllama } from "./ollama.js";
import { ambiente, argumento, carimbo, salvar } from "./registro.js";

const dir = argumento("dados", "dados");
const modelo = argumento("modelo");
const metodo = z.enum(METODOS).parse(argumento("metodo", "hibrida"));
const arquivoBusca = argumento("busca");
const arquivoCasos = argumento("casos", path.join(dir, "casos-geracao.json"));
const execucoes = 3;
const seed = 42;
const numCtx = 8192;
const topContexto = 3;

const ollama = criarOllama(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
const { documentos, consultas: lista, gold, versao } = await carregar(dir);
const porId = new Map(documentos.map((d) => [d.id, d]));
const consultas = new Map(lista.map((c) => [c.id, c]));
const casos = z.array(Caso).parse(JSON.parse(await readFile(arquivoCasos, "utf8")));
for (const a of validarCasos(casos, consultas, new Set(porId.keys()))) process.stderr.write(`aviso: ${a}\n`);

const busca = z
  .object({ versaoDados: z.string(), rankings: z.record(z.string(), z.record(z.string(), z.array(z.object({ id: z.string() })))) })
  .parse(JSON.parse(await readFile(arquivoBusca, "utf8")));
if (busca.versaoDados !== versao) throw new Error(`${arquivoBusca} foi medido com outra versão dos dados (${busca.versaoDados} ≠ ${versao}). Rode pnpm busca de novo.`);

const preparados = casos.map((caso) => {
  const consulta = consultas.get(caso.consulta);
  if (!consulta) throw new Error(`consulta inexistente: ${caso.consulta}`);
  const ranking = (busca.rankings[caso.consulta]?.[metodo] ?? []).map((r) => r.id);
  const { ids, plantadoForcado } = contextoDoCaso(ranking, caso, topContexto);
  const contexto = ids.map((id) => {
    const d = porId.get(id);
    if (!d) throw new Error(`documento fora do corpus: ${id}`);
    return d;
  });
  return { caso, consulta, ids, plantadoForcado, esperado: gold[caso.consulta] ?? [], mensagens: montarMensagens(consulta.texto, contexto) };
});
const ultimo = preparados.at(-1);
if (!ultimo) throw new Error("casos-geracao.json está vazio");

async function chamar(mensagens: (typeof preparados)[number]["mensagens"]) {
  const inicio = performance.now();
  const resposta = await ollama.chat({ modelo, mensagens, formato: FORMATO, seed, numCtx });
  return { ms: Math.round(performance.now() - inicio), resposta };
}

// Fria: modelo descarregado antes, com o último caso, para a 1ª rodada aquecida não
// começar pelo mesmo prompt (que estaria em cache). Fica fora das estatísticas.
await ollama.descarregar(modelo);
const fria = { consulta: ultimo.caso.consulta, ...(await chamar(ultimo.mensagens)) };

// Rodadas intercaladas (todos os casos, 3 vezes): chamadas seguidas nunca repetem o
// prompt, então a latência aquecida não é inflada pelo cache de prompt.
const rodadas = new Map(preparados.map((p) => [p.caso.consulta, [] as { ms: number; resposta: unknown; avaliacao: ReturnType<typeof avaliar>; conteudo: string }[]]));
const latencias: number[] = [];
for (let i = 0; i < execucoes; i++) {
  for (const p of preparados) {
    const { ms, resposta } = await chamar(p.mensagens);
    latencias.push(ms);
    const conteudo = resposta.message.content;
    rodadas.get(p.caso.consulta)?.push({ ms, resposta, conteudo, avaliacao: avaliar(conteudo, p.ids, p.esperado, p.caso) });
    process.stderr.write(`rodada ${i + 1} ${p.caso.consulta}: ${ms} ms\n`);
  }
}

const resultados = preparados.map((p) => {
  const rs = rodadas.get(p.caso.consulta) ?? [];
  return {
    consulta: p.caso.consulta,
    tipo: p.consulta.tipo,
    esperado: p.esperado,
    contexto: p.ids,
    plantadoForcado: p.plantadoForcado,
    estavel: estavel(rs.map((r) => r.conteudo)),
    textoIdentico: new Set(rs.map((r) => r.conteudo)).size === 1,
    // Critérios b e c do T-05 dependem de leitura humana do procedimento aprovado.
    revisarInjection: p.consulta.tipo === "injection" ? { b: "revisar", c: "revisar" } : null,
    rodadas: rs.map(({ ms, resposta, avaliacao }) => ({ ms, avaliacao, resposta })),
  };
});

const resumo = {
  ...resumir(resultados),
  friaMs: fria.ms,
  aquecidoP50Ms: percentil(latencias, 50),
  aquecidoP95Ms: percentil(latencias, 95),
};

const bruto = {
  ambiente: ambiente(),
  versaoDados: versao,
  parametros: { modelo, metodo, arquivoBusca, temperatura: 0, seed, numCtx, think: false, execucoes, topContexto },
  ollamaPs: await ollama.estado("/api/ps"),
  ollamaTags: await ollama.estado("/api/tags"),
  resumo,
  fria,
  resultados,
};
const nome = `${carimbo()}-geracao-${modelo.replace(/[^A-Za-z0-9.-]/g, "_")}`;
const arquivo = await salvar(argumento("saida", "resultados"), `${nome}.json`, JSON.stringify(bruto, null, 2));
process.stdout.write(`${JSON.stringify(resumo, null, 2)}\nSalvo: ${arquivo}\n`);
