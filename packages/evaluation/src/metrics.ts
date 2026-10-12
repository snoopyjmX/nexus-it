export interface Ranked {
  id: string;
  score: number;
}

// Posição (1-based) da primeira fonte esperada; null se não aparece.
export function position(ranking: Ranked[], expected: string[]): number | null {
  const i = ranking.findIndex((r) => expected.includes(r.id));
  return i === -1 ? null : i + 1;
}

export interface Counts {
  n: number;
  hit1: number;
  hit5: number;
  mrr: number;
}

export function count(positions: (number | null)[]): Counts {
  let hit1 = 0;
  let hit5 = 0;
  let reciprocal = 0;
  for (const p of positions) {
    if (p === 1) hit1++;
    if (p !== null && p <= 5) hit5++;
    if (p !== null) reciprocal += 1 / p;
  }
  const n = positions.length;
  return { n, hit1, hit5, mrr: n === 0 ? 0 : Number((reciprocal / n).toFixed(3)) };
}

export interface ScorePoint {
  score: number; // score do 1º resultado (0 se a busca não devolveu nada)
  answerable: boolean;
}

export interface ThresholdEval {
  threshold: number;
  abstainedUnanswerable: number;
  totalUnanswerable: number;
  lostAnswerable: number;
  totalAnswerable: number;
}

// Abstém quando o melhor score fica abaixo do limiar.
export function evaluateThreshold(points: ScorePoint[], threshold: number): ThresholdEval {
  const unanswerable = points.filter((p) => !p.answerable);
  const answerable = points.filter((p) => p.answerable);
  return {
    threshold,
    abstainedUnanswerable: unanswerable.filter((p) => p.score < threshold).length,
    totalUnanswerable: unanswerable.length,
    lostAnswerable: answerable.filter((p) => p.score < threshold).length,
    totalAnswerable: answerable.length,
  };
}

// Mesma regra fixada na Semana 0 (semana0/dados/criterios.md, termo 4): maximiza (abstenções certas − respondíveis
// perdidas); empate → menos respondíveis perdidas → menor limiar. Os candidatos ficam entre scores observados.
export function calibrateThreshold(points: ScorePoint[]): ThresholdEval | null {
  const scores = [...new Set(points.map((p) => p.score))].sort((a, b) => a - b);
  if (scores.length === 0) return null;
  // O primeiro candidato é o menor score: nunca abstém (linha de base).
  const candidates = [scores[0] ?? 0, ...scores.slice(0, -1).map((s, i) => (s + (scores[i + 1] ?? s)) / 2), (scores.at(-1) ?? 0) + 1e-9];
  const value = (e: ThresholdEval) => e.abstainedUnanswerable - e.lostAnswerable;
  let best: ThresholdEval | null = null;
  for (const threshold of candidates) {
    const e = evaluateThreshold(points, threshold);
    if (!best || value(e) > value(best) || (value(e) === value(best) && e.lostAnswerable < best.lostAnswerable)) best = e;
  }
  return best;
}
