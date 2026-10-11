export interface Resultado {
  id: string;
  score: number;
}

// Posição (1-based) da primeira fonte esperada; null se não aparece.
export function posicao(ranking: Resultado[], esperado: string[]): number | null {
  const i = ranking.findIndex((r) => esperado.includes(r.id));
  return i === -1 ? null : i + 1;
}

export function rrf(listas: Resultado[][], k = 60): Resultado[] {
  const soma = new Map<string, number>();
  for (const lista of listas) {
    lista.forEach((r, i) => soma.set(r.id, (soma.get(r.id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...soma.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export interface Contagem {
  n: number;
  hit1: number;
  hit5: number;
  mrr: number;
}

export function contar(posicoes: (number | null)[]): Contagem {
  let hit1 = 0;
  let hit5 = 0;
  let rr = 0;
  for (const p of posicoes) {
    if (p === 1) hit1++;
    if (p !== null && p <= 5) hit5++;
    if (p !== null) rr += 1 / p;
  }
  const n = posicoes.length;
  return { n, hit1, hit5, mrr: n === 0 ? 0 : Number((rr / n).toFixed(3)) };
}

export type Comparacao = "ganha" | "empata" | "perde";

// O critério de adoção usa Hit@5; o desempate por posição fica só no detalhe.
export function compararHit5(base: number | null, outro: number | null): Comparacao {
  const b = base !== null && base <= 5;
  const o = outro !== null && outro <= 5;
  if (o === b) return "empata";
  return o ? "ganha" : "perde";
}

export interface Ponto {
  score: number; // score do 1º resultado (0 se a busca não devolveu nada)
  temResposta: boolean;
}

export interface AvaliacaoLimiar {
  limiar: number;
  abstemSemResposta: number;
  totalSemResposta: number;
  perdeRespondivel: number;
  totalRespondivel: number;
}

// Abstém quando o melhor score fica abaixo do limiar.
export function avaliarLimiar(pontos: Ponto[], limiar: number): AvaliacaoLimiar {
  const sem = pontos.filter((p) => !p.temResposta);
  const com = pontos.filter((p) => p.temResposta);
  return {
    limiar,
    abstemSemResposta: sem.filter((p) => p.score < limiar).length,
    totalSemResposta: sem.length,
    perdeRespondivel: com.filter((p) => p.score < limiar).length,
    totalRespondivel: com.length,
  };
}

// Regra fixada antes dos dados: maximiza (abstenções certas − respondíveis perdidas);
// empate → menos respondíveis perdidas → menor limiar. Candidatos ficam entre scores
// observados, para não depender de um número arbitrário.
export function calibrarLimiar(pontos: Ponto[]): AvaliacaoLimiar | null {
  const scores = [...new Set(pontos.map((p) => p.score))].sort((a, b) => a - b);
  if (scores.length === 0) return null;
  // Primeiro candidato = menor score: não abstém nunca (linha de base).
  const candidatos = [scores[0] ?? 0, ...scores.slice(0, -1).map((s, i) => (s + (scores[i + 1] ?? s)) / 2)];
  candidatos.push((scores.at(-1) ?? 0) + 1e-9);
  let melhor: AvaliacaoLimiar | null = null;
  const valor = (a: AvaliacaoLimiar) => a.abstemSemResposta - a.perdeRespondivel;
  for (const limiar of candidatos) {
    const a = avaliarLimiar(pontos, limiar);
    if (
      !melhor ||
      valor(a) > valor(melhor) ||
      (valor(a) === valor(melhor) && a.perdeRespondivel < melhor.perdeRespondivel)
    ) {
      melhor = a;
    }
  }
  return melhor;
}
