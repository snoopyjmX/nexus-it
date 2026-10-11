import pg from "pg";
import { analisar, relatorio, type Rankings } from "./analise.js";
import { buscarLexical, buscarVetorial, conferirUrl, indexar, textoCompleto } from "./banco.js";
import { carregar } from "./dados.js";
import { rrf } from "./metricas.js";
import { criarOllama } from "./ollama.js";
import { ambiente, argumento, carimbo, salvar } from "./registro.js";

const dir = argumento("dados", "dados");
const modelo = argumento("modelo", "bge-m3");
const saida = argumento("saida", "resultados");
const ollama = criarOllama(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
const pool = new pg.Pool({ connectionString: conferirUrl(process.env.DATABASE_URL) });

try {
  const { documentos, consultas, gold, avisos, versao } = await carregar(dir);
  for (const a of avisos) process.stderr.write(`aviso: ${a}\n`);

  const inicio = performance.now();
  const vetoresDoc = await ollama.embed(modelo, documentos.map(textoCompleto));
  const vetoresConsulta = await ollama.embed(modelo, consultas.map((c) => c.texto));
  const embedMs = Math.round(performance.now() - inicio);
  await indexar(pool, documentos, vetoresDoc);

  const rankings = new Map<string, Rankings>();
  for (const [i, c] of consultas.entries()) {
    const lexical = await buscarLexical(pool, c.texto);
    const vetorial = await buscarVetorial(pool, vetoresConsulta[i] ?? []);
    rankings.set(c.id, { lexical, vetorial, hibrida: rrf([lexical, vetorial], 60).slice(0, 20) });
  }

  const analise = analisar(consultas, gold, rankings);
  const nome = `${carimbo()}-busca`;
  const bruto = {
    ambiente: ambiente(),
    versaoDados: versao,
    parametros: { modeloEmbedding: modelo, dimensao: vetoresDoc[0]?.length, rrfK: 60, topK: 20, embedMs },
    avisos,
    documentos: documentos.length,
    consultas: consultas.length,
    rankings: Object.fromEntries(rankings),
    analise,
  };
  const json = await salvar(saida, `${nome}.json`, JSON.stringify(bruto, null, 2));
  const md = await salvar(saida, `${nome}.md`, relatorio(analise));
  process.stdout.write(`Salvo:\n  ${json}\n  ${md}\n`);
} finally {
  await pool.end();
}
