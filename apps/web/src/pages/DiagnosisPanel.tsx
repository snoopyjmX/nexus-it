import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../api";
import type { Diagnosis, DiagnosisSource } from "../types";
import { Badge, Button, ErrorMessage, Field, focusRing, inputClass } from "../ui";

const errorText = (error: unknown, fallback: string) => (error instanceof ApiError && error.detail ? error.detail : fallback);

function Feedback({ runId }: { runId: string }) {
  const [useful, setUseful] = useState<boolean | null>(null);
  const send = useMutation({
    mutationFn: (body: { useful: boolean; correction?: string }) => api("POST", `/diagnosis-runs/${runId}/feedback`, body),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (useful === null) return;
    const correction = String(new FormData(event.currentTarget).get("correction") ?? "").trim();
    send.mutate({ useful, ...(correction ? { correction } : {}) });
  }

  if (send.isSuccess) return <p role="status">Avaliação registrada.</p>;
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-slate-300 pt-3">
      <fieldset>
        <legend className="mb-1 font-medium">Este diagnóstico ajudou?</legend>
        <div className="flex gap-4">
          {([[true, "Ajudou"], [false, "Não ajudou"]] as const).map(([value, label]) => (
            <label key={label} className="flex items-center gap-2">
              <input type="radio" name="useful" checked={useful === value} onChange={() => setUseful(value)} className={focusRing} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="O que estava errado? (opcional)" id="correction">
        <textarea id="correction" name="correction" rows={3} maxLength={1000} className={inputClass} />
      </Field>
      <p className="text-sm text-slate-700">A avaliação fica registrada na execução; ela não altera a base de conhecimento nem o chamado.</p>
      {send.isError && <ErrorMessage>{errorText(send.error, "Não foi possível registrar a avaliação. Tente de novo.")}</ErrorMessage>}
      <Button type="submit" disabled={useful === null || send.isPending}>
        Enviar avaliação
      </Button>
    </form>
  );
}

function SourceItem({ source }: { source: DiagnosisSource }) {
  const article = source.kind === "article";
  return (
    <li className="space-y-1 p-3">
      <Link to={article ? `/base/${source.id}` : `/chamados/${source.id}`} className={`font-medium text-blue-800 underline ${focusRing}`}>
        {source.title}
      </Link>{" "}
      <Badge>{article ? "Artigo" : "Chamado resolvido"}</Badge>
      <p>{article ? source.symptom : source.summary}</p>
    </li>
  );
}

// O texto do modelo entra como texto puro (T-05). Os links vêm só de ids que o servidor já validou e que estão entre as fontes.
function Summary({ summary, sources }: { summary: NonNullable<Diagnosis["summary"]>; sources: DiagnosisSource[] }) {
  const cited = sources.filter((source) => summary.sourceIds.includes(source.id));
  return (
    <section aria-labelledby="diag-resumo" className="space-y-2 rounded border border-slate-300 p-3">
      <h3 id="diag-resumo" className="font-semibold">
        Resumo gerado por IA
      </h3>
      <p className="text-sm">Texto escrito por um modelo a partir das fontes abaixo; pode conter erros. Confira nas fontes.</p>
      <p className="whitespace-pre-wrap">{summary.text}</p>
      <ul className="flex flex-wrap gap-x-4 text-sm">
        {cited.map((source) => (
          <li key={`${source.kind}-${source.id}`}>
            <Link to={source.kind === "article" ? `/base/${source.id}` : `/chamados/${source.id}`} className={`text-blue-800 underline ${focusRing}`}>
              {source.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Result({ diagnosis }: { diagnosis: Diagnosis }) {
  if (diagnosis.abstained) {
    return (
      <div className="space-y-2">
        <Badge>Evidência insuficiente</Badge>
        <p>A base não tem fonte que sustente um diagnóstico para este chamado.</p>
      </div>
    );
  }

  const titles = new Map(diagnosis.sources.map((source) => [source.id, source.title]));
  // Os passos já vêm na ordem das fontes; agrupa por artigo mantendo essa ordem.
  const groups: [string, string[]][] = [];
  for (const { articleId, text } of diagnosis.steps) {
    const group = groups.find(([id]) => id === articleId);
    if (group) group[1].push(text);
    else groups.push([articleId, [text]]);
  }
  return (
    <div className="space-y-4">
      {diagnosis.evidence === "threshold" ? (
        <div className="space-y-1">
          <Badge>Acima do limiar de similaridade</Badge>
          <p className="text-sm">O limiar é uma regra empírica deste conjunto de documentos; não é uma probabilidade de acerto.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <Badge>Evidência não verificada</Badge>
          <p className="text-sm">Nenhum limiar de similaridade confiável foi aplicado a esta busca. Confira as fontes antes de seguir os passos.</p>
        </div>
      )}
      {diagnosis.degraded && (
        <p role="note" className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-amber-900">
          A busca semântica está indisponível no momento; as fontes abaixo vêm da busca por palavras.
        </p>
      )}

      {diagnosis.llm === "unavailable" && (
        <p role="note" className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-amber-900">
          O resumo por modelo não está disponível agora; o diagnóstico abaixo não depende dele.
        </p>
      )}
      {diagnosis.summary && <Summary summary={diagnosis.summary} sources={diagnosis.sources} />}

      <section aria-labelledby="diag-fontes">
        <h3 id="diag-fontes" className="mb-1 font-semibold">
          Fontes
        </h3>
        <ul className="divide-y divide-slate-300 rounded border border-slate-300">
          {diagnosis.sources.map((source) => (
            <SourceItem key={`${source.kind}-${source.id}`} source={source} />
          ))}
        </ul>
      </section>

      {groups.length > 0 && (
        <section aria-labelledby="diag-passos">
          <h3 id="diag-passos" className="mb-1 font-semibold">
            Próximos testes
          </h3>
          <p className="mb-2 text-sm">Vêm do procedimento de cada artigo, sem alteração. Confira na fonte.</p>
          {groups.map(([articleId, steps]) => {
            const title = titles.get(articleId) ?? "artigo";
            return (
              <div key={articleId} className="mb-3">
                <p className="font-medium">{title}</p>
                <ol aria-label={`Passos de ${title}`} className="list-decimal space-y-1 pl-6">
                  {steps.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ol>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

// Painel do técnico ao lado do chamado (ARCHITECTURE §7). A API é quem decide papel e escopo; aqui só se mostra.
export function DiagnosisPanel({ ticketId }: { ticketId: string }) {
  const run = useMutation({ mutationFn: () => api<Diagnosis>("POST", `/tickets/${ticketId}/diagnosis`) });
  return (
    <aside aria-labelledby="diagnostico" className="mt-6 space-y-3 lg:mt-0">
      <h2 id="diagnostico" className="text-lg font-semibold">
        Diagnóstico
      </h2>
      <p className="text-sm">Sugere fontes da base e passos dos procedimentos. Não executa nada nem substitui o seu julgamento.</p>
      <Button type="button" disabled={run.isPending} onClick={() => run.mutate()}>
        Gerar diagnóstico
      </Button>
      {run.isPending && <p role="status">Gerando diagnóstico…</p>}
      {run.isError && <ErrorMessage>{errorText(run.error, "Não foi possível gerar o diagnóstico. Tente de novo.")}</ErrorMessage>}
      <div aria-live="polite">
        {run.data && (
          <>
            <Result diagnosis={run.data} />
            <Feedback key={run.data.runId} runId={run.data.runId} />
          </>
        )}
      </div>
    </aside>
  );
}
