import type { Consulta, Gold } from "./dados.js";
import {
  avaliarLimiar, calibrarLimiar, compararHit5, contar, posicao,
  type AvaliacaoLimiar, type Comparacao, type Contagem, type Ponto, type Resultado,
} from "./metricas.js";

export const METODOS = ["lexical", "vetorial", "hibrida"] as const;
export type Metodo = (typeof METODOS)[number];
export type Rankings = Record<Metodo, Resultado[]>;

export interface LinhaConsulta {
  id: string;
  tipo: Consulta["tipo"];
  categoria: string;
  esperado: string[];
  posicao: Record<Metodo, number | null>;
  top5: Record<Metodo, string[]>;
  esperadasNoTop5: Record<Metodo, number>; // relevante nas ambíguas (2+ causas)
  vetorialVsLexical: Comparacao | null;
  hibridaVsLexical: Comparacao | null;
}

export interface Abstencao {
  calibracao: AvaliacaoLimiar | null;
  validacao: AvaliacaoLimiar | null;
}

export interface Analise {
  porConsulta: LinhaConsulta[];
  porTipo: Record<string, Record<Metodo, Contagem>>;
  porCategoria: Record<string, Record<Metodo, Contagem>>;
  comparacao: Record<"vetorial" | "hibrida", Record<string, Record<Comparacao, number>>>;
  abstencao: Record<Metodo, Abstencao>;
}

function agrupar(linhas: LinhaConsulta[], chave: (l: LinhaConsulta) => string) {
  const grupos: Record<string, Record<Metodo, Contagem>> = {};
  const nomes = [...new Set(linhas.map(chave))].sort();
  for (const nome of nomes) {
    const doGrupo = linhas.filter((l) => chave(l) === nome);
    grupos[nome] = {
      lexical: contar(doGrupo.map((l) => l.posicao.lexical)),
      vetorial: contar(doGrupo.map((l) => l.posicao.vetorial)),
      hibrida: contar(doGrupo.map((l) => l.posicao.hibrida)),
    };
  }
  return grupos;
}

function placar(linhas: LinhaConsulta[], campo: "vetorialVsLexical" | "hibridaVsLexical") {
  const out: Record<string, Record<Comparacao, number>> = {};
  for (const l of linhas) {
    const c = l[campo];
    if (!c) continue;
    // Por categoria só diretas e paráfrases: é sobre elas que o critério olha concentração de perdas.
    const grupos = [`tipo:${l.tipo}`];
    if (l.tipo === "direta" || l.tipo === "parafrase") grupos.push(`categoria:${l.categoria}`);
    for (const grupo of grupos) {
      out[grupo] ??= { ganha: 0, empata: 0, perde: 0 };
      out[grupo][c]++;
    }
  }
  return out;
}

export function analisar(consultas: Consulta[], gold: Gold, rankings: Map<string, Rankings>): Analise {
  const porConsulta: LinhaConsulta[] = consultas.map((c) => {
    const r = rankings.get(c.id);
    if (!r) throw new Error(`Sem ranking para ${c.id}`);
    const esperado = gold[c.id] ?? [];
    const pos = {
      lexical: posicao(r.lexical, esperado),
      vetorial: posicao(r.vetorial, esperado),
      hibrida: posicao(r.hibrida, esperado),
    };
    const respondivel = esperado.length > 0;
    return {
      id: c.id,
      tipo: c.tipo,
      categoria: c.categoria,
      esperado,
      posicao: pos,
      top5: {
        lexical: r.lexical.slice(0, 5).map((x) => x.id),
        vetorial: r.vetorial.slice(0, 5).map((x) => x.id),
        hibrida: r.hibrida.slice(0, 5).map((x) => x.id),
      },
      esperadasNoTop5: {
        lexical: esperado.filter((id) => r.lexical.slice(0, 5).some((x) => x.id === id)).length,
        vetorial: esperado.filter((id) => r.vetorial.slice(0, 5).some((x) => x.id === id)).length,
        hibrida: esperado.filter((id) => r.hibrida.slice(0, 5).some((x) => x.id === id)).length,
      },
      vetorialVsLexical: respondivel ? compararHit5(pos.lexical, pos.vetorial) : null,
      hibridaVsLexical: respondivel ? compararHit5(pos.lexical, pos.hibrida) : null,
    };
  });

  const respondiveis = porConsulta.filter((l) => l.esperado.length > 0);
  const abstencao = {} as Record<Metodo, Abstencao>;
  for (const m of METODOS) {
    const pontos = (grupo: "calibracao" | "validacao"): Ponto[] =>
      consultas
        .filter((c) => c.grupo === grupo)
        .map((c) => ({
          score: rankings.get(c.id)?.[m][0]?.score ?? 0,
          temResposta: (gold[c.id] ?? []).length > 0,
        }));
    const calibracao = calibrarLimiar(pontos("calibracao"));
    const validacao = calibracao ? avaliarLimiar(pontos("validacao"), calibracao.limiar) : null;
    abstencao[m] = { calibracao, validacao };
  }

  return {
    porConsulta,
    porTipo: agrupar(respondiveis, (l) => l.tipo),
    porCategoria: agrupar(respondiveis, (l) => l.categoria),
    comparacao: {
      vetorial: placar(porConsulta, "vetorialVsLexical"),
      hibrida: placar(porConsulta, "hibridaVsLexical"),
    },
    abstencao,
  };
}

const fmt = (c: Contagem) => `${c.hit1}/${c.n} · ${c.hit5}/${c.n} · ${c.mrr.toFixed(3)}`;
const pos = (p: number | null) => (p === null ? "—" : String(p));

export function relatorio(a: Analise): string {
  const linhas: string[] = ["# Semana 0 — Recuperação", ""];
  const tabela = (titulo: string, grupos: Analise["porTipo"]) => {
    linhas.push(`## ${titulo}`, "", "Cada célula: Hit@1 · Hit@5 · MRR (só consultas com resposta)", "");
    linhas.push("| Grupo | Lexical | Vetorial | Híbrida |", "| --- | --- | --- | --- |");
    for (const [nome, c] of Object.entries(grupos)) {
      linhas.push(`| ${nome} | ${fmt(c.lexical)} | ${fmt(c.vetorial)} | ${fmt(c.hibrida)} |`);
    }
    linhas.push("");
  };
  tabela("Por tipo de consulta", a.porTipo);
  tabela("Por categoria", a.porCategoria);

  linhas.push("## Contra a lexical, por Hit@5 (ganha / empata / perde)", "");
  linhas.push("| Grupo | Vetorial | Híbrida |", "| --- | --- | --- |");
  const grupos = [...new Set([...Object.keys(a.comparacao.vetorial), ...Object.keys(a.comparacao.hibrida)])].sort();
  for (const g of grupos) {
    const v = a.comparacao.vetorial[g];
    const h = a.comparacao.hibrida[g];
    const p = (x?: Record<Comparacao, number>) => (x ? `${x.ganha} / ${x.empata} / ${x.perde}` : "—");
    linhas.push(`| ${g} | ${p(v)} | ${p(h)} |`);
  }
  linhas.push("");

  linhas.push("## Consulta a consulta", "", "Posição da primeira fonte esperada (— = fora do top-20).", "");
  linhas.push("| Consulta | Tipo | Categoria | Lex | Vet | Híb | Vet×Lex | Híb×Lex |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const l of a.porConsulta) {
    linhas.push(
      `| ${l.id} | ${l.tipo} | ${l.categoria} | ${pos(l.posicao.lexical)} | ${pos(l.posicao.vetorial)} | ${pos(l.posicao.hibrida)} | ${l.vetorialVsLexical ?? "—"} | ${l.hibridaVsLexical ?? "—"} |`,
    );
  }
  linhas.push("");

  const ambiguas = a.porConsulta.filter((l) => l.tipo === "ambigua");
  if (ambiguas.length > 0) {
    linhas.push("## Ambíguas: fontes esperadas no top-5", "", "| Consulta | Esperadas | Lex | Vet | Híb |", "| --- | --- | --- | --- | --- |");
    for (const l of ambiguas) {
      const n = l.esperado.length;
      linhas.push(`| ${l.id} | ${n} | ${l.esperadasNoTop5.lexical}/${n} | ${l.esperadasNoTop5.vetorial}/${n} | ${l.esperadasNoTop5.hibrida}/${n} |`);
    }
    linhas.push("");
  }

  linhas.push("## Abstenção por limiar no score do 1º resultado", "");
  linhas.push("Score não é probabilidade. A híbrida (RRF) mede posição, não semelhança: o limiar dela é pouco informativo.", "");
  linhas.push("| Método | Limiar | Calibração: abstém sem-resposta | Calibração: perde respondível | Validação: abstém sem-resposta | Validação: perde respondível |");
  linhas.push("| --- | --- | --- | --- | --- | --- |");
  for (const [m, ab] of Object.entries(a.abstencao)) {
    const c = ab.calibracao;
    const v = ab.validacao;
    if (!c || !v) {
      linhas.push(`| ${m} | — | sem dados | | | |`);
      continue;
    }
    linhas.push(
      `| ${m} | ${c.limiar.toFixed(4)} | ${c.abstemSemResposta}/${c.totalSemResposta} | ${c.perdeRespondivel}/${c.totalRespondivel} | ${v.abstemSemResposta}/${v.totalSemResposta} | ${v.perdeRespondivel}/${v.totalRespondivel} |`,
    );
  }
  linhas.push("", "Este relatório só mede. O veredito (passou / não passou / inconclusivo) vai em decisao.md, comparando com criterios.md.");
  return linhas.join("\n") + "\n";
}
