import type { EvalQueryRow, EvalRun } from "./types";

function cell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // Planilhas executam texto que começa com = + - @ (injeção de fórmula); números não passam por aqui.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADER = ["id", "tipo", "categoria", "grupo", "esperadas", "posicao", "top5", "esperadas_no_top5", "score_top1"];

export function toCsv(rows: EvalQueryRow[]): string {
  const lines = rows.map((r) => [r.id, r.type, r.category, r.group, r.expected.join(" "), r.position, r.top5.join(" "), r.expectedInTop5, r.topScore].map(cell).join(","));
  return `${[HEADER.join(","), ...lines].join("\r\n")}\r\n`;
}

export function exportName(run: EvalRun, extension: "json" | "csv"): string {
  const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, "_");
  return `avaliacao-${safe(run.set)}-${safe(run.datasetVersion)}-${safe(run.searchMode)}-${safe(run.createdAt.slice(0, 10))}.${extension}`;
}

export function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
