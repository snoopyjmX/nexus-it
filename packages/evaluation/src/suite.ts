import type { Dataset, EvalQuery } from "./dataset.js";
import { calibrateThreshold, count, evaluateThreshold, position, type Counts, type Ranked, type ScorePoint, type ThresholdEval } from "./metrics.js";

export interface SearchResult {
  mode: "lexical" | "vector";
  // A busca semântica estava ligada mas não respondeu: o resultado daquela consulta é lexical (FR-13).
  degraded: boolean;
  ranking: Ranked[];
}
export type SearchFn = (query: string) => Promise<SearchResult>;

export interface QueryRow {
  id: string;
  type: EvalQuery["tipo"];
  category: string;
  group: EvalQuery["grupo"] | null;
  expected: string[];
  position: number | null;
  top5: string[];
  expectedInTop5: number;
  topScore: number;
}

export interface SuiteSummary {
  queryCount: number;
  degradedQueries: number;
  modes: Partial<Record<SearchResult["mode"], number>>;
  byType: Record<string, Counts>;
  byCategory: Record<string, Counts>;
  abstention: { calibration: ThresholdEval | null; validation: ThresholdEval | null; configured: ThresholdEval | null };
  rows: QueryRow[];
}

function group(rows: QueryRow[], key: (row: QueryRow) => string): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const name of [...new Set(rows.map(key))].sort()) out[name] = count(rows.filter((r) => key(r) === name).map((r) => r.position));
  return out;
}

const points = (rows: QueryRow[]): ScorePoint[] => rows.map((r) => ({ score: r.topScore, answerable: r.expected.length > 0 }));

// `configuredThreshold`: o limiar que a aplicação usaria (VECTOR_MIN_SCORE); avaliado em todas as consultas.
export async function runSuite(dataset: Dataset, search: SearchFn, options: { configuredThreshold?: number } = {}): Promise<SuiteSummary> {
  const rows: QueryRow[] = [];
  const modes: SuiteSummary["modes"] = {};
  let degradedQueries = 0;
  for (const query of dataset.queries) {
    const result = await search(query.texto);
    const expected = dataset.gold[query.id] ?? [];
    const top5 = result.ranking.slice(0, 5).map((r) => r.id);
    modes[result.mode] = (modes[result.mode] ?? 0) + 1;
    if (result.degraded) degradedQueries++;
    rows.push({
      id: query.id,
      type: query.tipo,
      category: query.categoria,
      group: query.grupo ?? null,
      expected,
      position: position(result.ranking, expected),
      top5,
      expectedInTop5: expected.filter((id) => top5.includes(id)).length,
      topScore: result.ranking[0]?.score ?? 0,
    });
  }

  const answerable = rows.filter((r) => r.expected.length > 0);
  const calibration = calibrateThreshold(points(rows.filter((r) => r.group === "calibracao")));
  const validationRows = rows.filter((r) => r.group === "validacao");
  return {
    queryCount: rows.length,
    degradedQueries,
    modes,
    byType: group(answerable, (r) => r.type),
    byCategory: group(answerable, (r) => r.category),
    abstention: {
      calibration,
      validation: calibration && validationRows.length > 0 ? evaluateThreshold(points(validationRows), calibration.threshold) : null,
      configured: options.configuredThreshold === undefined ? null : evaluateThreshold(points(rows), options.configuredThreshold),
    },
    rows,
  };
}
