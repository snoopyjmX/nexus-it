import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { formatDate } from "../labels";
import { download, exportName, toCsv } from "../lab-export";
import type { EvalCounts, EvalRun, EvalThreshold } from "../types";
import { Badge, Button, ErrorMessage, Loading } from "../ui";

const number = (value: number, digits: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// O resultado vem de JSON gravado pelo runner. Uma linha que não tenha a forma esperada é mostrada como ilegível
// em vez de derrubar a tela.
function readable(run: EvalRun): boolean {
  const suite = run.result?.suite;
  return Boolean(suite && suite.byType && suite.byCategory && suite.abstention && Array.isArray(suite.rows) && run.result.environment);
}

function CountsTable({ label, groups }: { label: string; groups: Record<string, EvalCounts> }) {
  return (
    <table aria-label={label} className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-slate-400">
          <th scope="col" className="py-1 pr-4">Grupo</th>
          <th scope="col" className="py-1 pr-4">Hit@1</th>
          <th scope="col" className="py-1 pr-4">Hit@5</th>
          <th scope="col" className="py-1">MRR</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(groups).map(([name, c]) => (
          <tr key={name} className="border-b border-slate-200">
            <th scope="row" className="py-1 pr-4 font-normal">{name}</th>
            <td className="py-1 pr-4">{c.hit1}/{c.n}</td>
            <td className="py-1 pr-4">{c.hit5}/{c.n}</td>
            <td className="py-1">{number(c.mrr, 3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ThresholdLine({ label, value }: { label: string; value: EvalThreshold | null }) {
  if (!value) return <li>{label}: não avaliado.</li>;
  return (
    <li>
      {label} (limiar {number(value.threshold, 2)}): abstém {value.abstainedUnanswerable} de {value.totalUnanswerable} sem resposta; perde {value.lostAnswerable} de {value.totalAnswerable} respondíveis.
    </li>
  );
}

function Detail({ run }: { run: EvalRun }) {
  const { suite, environment } = run.result;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Execução de {formatDate(run.createdAt)}</h2>
        <Badge>{run.set === "dev" ? "Conjunto dev (exploratório)" : "Conjunto de teste"}</Badge>
        <Button type="button" onClick={() => download(exportName(run, "json"), JSON.stringify(run.result, null, 2), "application/json")}>
          Exportar JSON
        </Button>
        <Button type="button" onClick={() => download(exportName(run, "csv"), toCsv(suite.rows), "text/csv")}>
          Exportar CSV
        </Button>
      </div>
      <p>{suite.queryCount} consultas medidas. Os números são contagens: com tão poucos casos, uma ou duas consultas de diferença são ruído.</p>
      {suite.degradedQueries > 0 && (
        <p role="note" className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-amber-900">
          {suite.degradedQueries} {suite.degradedQueries === 1 ? "consulta degradada" : "consultas degradadas"}: a busca semântica não respondeu e o resultado delas é o da busca por palavras.
        </p>
      )}

      <section aria-labelledby="lab-ambiente">
        <h3 id="lab-ambiente" className="mb-1 font-semibold">Ambiente</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt>Data</dt><dd>{formatDate(environment.date)}</dd>
          <dt>Commit</dt><dd className="font-mono">{environment.commit}</dd>
          <dt>Processador</dt><dd>{environment.cpu}</dd>
          <dt>Memória</dt><dd>{environment.memoryGb} GB</dd>
          <dt>Sistema</dt><dd>{environment.os}</dd>
          <dt>Node</dt><dd className="font-mono">{environment.node}</dd>
        </dl>
      </section>

      <section aria-labelledby="lab-tipo">
        <h3 id="lab-tipo" className="mb-1 font-semibold">Recuperação por tipo de consulta</h3>
        <p className="mb-2 text-sm">Cada célula: acertos sobre o total de consultas com resposta.</p>
        <CountsTable label="Por tipo de consulta" groups={suite.byType} />
      </section>

      <section aria-labelledby="lab-categoria">
        <h3 id="lab-categoria" className="mb-1 font-semibold">Recuperação por categoria</h3>
        <CountsTable label="Por categoria" groups={suite.byCategory} />
      </section>

      <section aria-labelledby="lab-abstencao">
        <h3 id="lab-abstencao" className="mb-1 font-semibold">Abstenção</h3>
        <p className="mb-2 text-sm">Sobre o score do primeiro resultado. O limiar é uma regra empírica deste conjunto de documentos; não é uma probabilidade.</p>
        <ul className="list-disc space-y-1 pl-5">
          <ThresholdLine label="Calibração" value={suite.abstention.calibration} />
          <ThresholdLine label="Validação" value={suite.abstention.validation} />
          <ThresholdLine label="Limiar configurado" value={suite.abstention.configured} />
        </ul>
      </section>

      <details>
        <summary className="cursor-pointer font-semibold">Consultas uma a uma</summary>
        <table aria-label="Consultas" className="mt-2 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-400">
              <th scope="col" className="py-1 pr-3">Consulta</th>
              <th scope="col" className="py-1 pr-3">Tipo</th>
              <th scope="col" className="py-1 pr-3">Posição</th>
              <th scope="col" className="py-1 pr-3">Esperadas no top-5</th>
              <th scope="col" className="py-1">Top-5</th>
            </tr>
          </thead>
          <tbody>
            {suite.rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-200 align-top">
                <th scope="row" className="py-1 pr-3 font-normal">{row.id}</th>
                <td className="py-1 pr-3">{row.type}</td>
                <td className="py-1 pr-3">{row.position ?? "—"}</td>
                <td className="py-1 pr-3">{row.expectedInTop5}/{row.expected.length}</td>
                <td className="py-1 font-mono">{row.top5.join(" ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// Laboratório (ARCHITECTURE §7): só leitura. Quem grava as execuções é o runner por CLI (`pnpm eval`, ADR-012).
export function Lab() {
  const { user } = useAuth();
  const technician = user?.role === "technician";
  const runs = useQuery({ queryKey: ["eval-runs"], queryFn: () => api<{ items: EvalRun[] }>("GET", "/eval/runs"), enabled: technician });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Só técnico; a API também recusa (403).
  if (!technician) return <Navigate to="/" replace />;

  const items = runs.data?.items ?? [];
  const selected = items.find((run) => run.id === selectedId && readable(run)) ?? items.find(readable);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Laboratório</h1>
      <p>Métricas da suíte de avaliação, somente leitura. Cada execução fica ligada à versão do conjunto de dados, ao modelo e ao ambiente em que rodou.</p>
      {runs.isPending && <Loading />}
      {runs.isError && <ErrorMessage>Não foi possível carregar as execuções. Tente de novo.</ErrorMessage>}
      {runs.isSuccess && items.length === 0 && (
        <p>
          Nenhuma execução registrada. Rode <code className="font-mono">pnpm eval</code> no servidor para gerar uma.
        </p>
      )}
      {items.length > 0 && (
        <table aria-label="Execuções" className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-400">
              <th scope="col" className="py-1 pr-4">Data</th>
              <th scope="col" className="py-1 pr-4">Conjunto</th>
              <th scope="col" className="py-1 pr-4">Versão</th>
              <th scope="col" className="py-1 pr-4">Busca</th>
              <th scope="col" className="py-1 pr-4">Modelo de linguagem</th>
              <th scope="col" className="py-1"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((run) =>
              readable(run) ? (
                <tr key={run.id} className="border-b border-slate-200">
                  <td className="py-1 pr-4">{formatDate(run.createdAt)}</td>
                  <td className="py-1 pr-4">{run.set}</td>
                  <td className="py-1 pr-4 font-mono">{run.datasetVersion}</td>
                  <td className="py-1 pr-4">{run.searchMode}{run.embeddingModel ? ` (${run.embeddingModel})` : ""}</td>
                  <td className="py-1 pr-4">{run.llmModel ? `${run.llmModel} · ${run.promptVersion}` : "—"}</td>
                  <td className="py-1">
                    <Button type="button" aria-label={`Ver detalhes da execução de ${formatDate(run.createdAt)}`} aria-pressed={selected?.id === run.id} disabled={selected?.id === run.id} onClick={() => setSelectedId(run.id)}>
                      Ver detalhes
                    </Button>
                  </td>
                </tr>
              ) : (
                <tr key={run.id} className="border-b border-slate-200">
                  <td className="py-1 pr-4">{formatDate(run.createdAt)}</td>
                  <td colSpan={5} className="py-1">Resultado ilegível: o formato gravado não é o esperado.</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {selected && <Detail run={selected} />}
    </div>
  );
}
