import type { GenerationResult } from "./generation.js";
import type { Counts, ThresholdEval } from "./metrics.js";
import type { EvalResult } from "./result.js";

const counts = (c: Counts) => `${c.hit1}/${c.n} · ${c.hit5}/${c.n} · ${c.mrr.toFixed(3)}`;
const threshold = (label: string, e: ThresholdEval | null) =>
  e
    ? `- ${label} (limiar ${Number(e.threshold.toFixed(4))}): abstém ${e.abstainedUnanswerable}/${e.totalUnanswerable} sem resposta; perde ${e.lostAnswerable}/${e.totalAnswerable} respondíveis`
    : `- ${label}: não avaliado`;

function formatGeneration(g: GenerationResult): string[] {
  const verdict = (met: boolean | null) => (met === null ? "sem dados" : met ? "atende" : "NÃO atende");
  const counts = Object.entries(g.summary.statusCounts).map(([status, n]) => `${status} ${n}`).join(", ");
  return [
    "## Geração (resumo do modelo)",
    "",
    `Modelo ${g.model} · prompt ${g.promptVersion} · ${g.rounds} rodadas · casos ${g.casesVersion}`,
    `Tempos: 1ª chamada ${g.firstCallMs ?? "—"} ms (fria se o modelo não estava carregado) · p50 aquecido ${g.warmP50Ms ?? "—"} ms · p95 aquecido ${g.warmP95Ms ?? "—"} ms`,
    `Desfechos das chamadas: ${counts || "nenhuma"} · ${g.summary.discardedCitations} citações descartadas pelo servidor`,
    `Sem resposta que o diagnóstico abstém sem chamar o modelo: ${g.summary.abstainedUnanswerable.n} de ${g.summary.abstainedUnanswerable.of}`,
    `Injection: o trecho plantado chegou ao modelo em ${g.summary.injectionReachedModel.n} de ${g.summary.injectionReachedModel.of} casos; só esses testam a resistência do modelo.`,
    "",
    "Critérios automáticos (criterios.md):",
    ...g.criteria.map((c) => `- ${c.name}: ${c.value} (${c.rule}): ${verdict(c.met)}`),
    "",
    g.humanReview,
    "",
  ];
}

// Contagens, não percentuais: com ~30 casos, 1 ou 2 consultas de diferença é ruído (docs/AI_EVALUATION.md).
export function formatReport(r: EvalResult): string {
  const lines = [
    `# Avaliação · conjunto ${r.set} (${r.datasetVersion}) · busca ${r.searchMode}${r.embeddingModel ? ` (${r.embeddingModel})` : ""}`,
    "",
    `Ambiente: ${r.environment.date} · commit ${r.environment.commit} · ${r.environment.cpu} · ${r.environment.memoryGb} GB · ${r.environment.os} · node ${r.environment.node}`,
    `Consultas: ${r.suite.queryCount}`,
  ];
  if (r.suite.degradedQueries > 0) lines.push(`Atenção: ${r.suite.degradedQueries} consulta(s) degradada(s): a busca semântica não respondeu e o resultado delas é lexical.`);
  for (const [title, groups] of [["Por tipo", r.suite.byType], ["Por categoria", r.suite.byCategory]] as const) {
    lines.push("", `## ${title}`, "", "Cada célula: Hit@1 · Hit@5 · MRR (só consultas com resposta)", "");
    for (const [name, c] of Object.entries(groups)) lines.push(`- ${name}: ${counts(c)}`);
  }
  lines.push(
    "",
    "## Abstenção (score do 1º resultado)",
    "",
    threshold("Calibração", r.suite.abstention.calibration),
    threshold("Validação", r.suite.abstention.validation),
    threshold("Limiar configurado", r.suite.abstention.configured),
    "",
  );
  if (r.generation) lines.push(...formatGeneration(r.generation));
  return lines.join("\n");
}
