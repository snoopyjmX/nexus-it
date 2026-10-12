import type { Analise, Metodo } from "./analise.js";

export type EntradaEscolha = Pick<Analise, "porTipo" | "comparacao">;

// Aplica a linha "busca vetorial/híbrida" de dados/criterios.md só para escolher de qual busca
// vem o contexto da geração. O veredito oficial continua em decisao.md.
// "Supera em ≥ 2 consultas" é lido literalmente: pelo menos 2 paráfrases em que a variante ganha.
export function escolherMetodo(a: EntradaEscolha): { metodo: Metodo; motivo: string } {
  const parafrases = a.porTipo.parafrase;
  if (!parafrases) return { metodo: "lexical", motivo: "sem paráfrases na análise" };

  // Melhor variante: maior Hit@5 nas paráfrases; empate, maior MRR (criterios.md, termo 1).
  // Empate também no MRR não tem regra no protocolo; fica a vetorial, a primeira citada ali.
  const [melhor] = (["vetorial", "hibrida"] as const)
    .map((m) => ({ m, h: parafrases[m] }))
    .sort((x, y) => y.h.hit5 - x.h.hit5 || y.h.mrr - x.h.mrr);
  if (!melhor) return { metodo: "lexical", motivo: "sem variantes" };

  const placar = a.comparacao[melhor.m];
  const ganhasParafrases = placar["tipo:parafrase"]?.ganha ?? 0;
  const perdasDiretas = placar["tipo:direta"]?.perde ?? 0;
  // Perdas concentradas: 2 ou mais na mesma categoria (só diretas e paráfrases entram aqui).
  const concentradas = Object.entries(placar)
    .filter(([grupo, v]) => grupo.startsWith("categoria:") && v.perde >= 2)
    .map(([grupo]) => grupo.slice("categoria:".length));

  const resumo = `melhor variante: ${melhor.m} (Hit@5 ${melhor.h.hit5} nas paráfrases); ganha em ${ganhasParafrases} paráfrases (precisa ≥ 2), perde ${perdasDiretas} nas diretas (máx. 1), categorias com 2+ perdas: ${concentradas.length === 0 ? "nenhuma" : concentradas.join(", ")}`;
  const cumpre = ganhasParafrases >= 2 && perdasDiretas <= 1 && concentradas.length === 0;
  return cumpre ? { metodo: melhor.m, motivo: resumo } : { metodo: "lexical", motivo: `${resumo} → não cumpre, fica a lexical` };
}
