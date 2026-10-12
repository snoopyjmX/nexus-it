import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import type { ArticleSummary, Page, SearchHit } from "../types";
import { Badge, Button, ErrorMessage, Field, Loading, focusRing, inputClass } from "../ui";

export function Knowledge() {
  const { user } = useAuth();
  const technician = user?.role === "technician";
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const searching = term.length > 0;

  const list = useQuery({
    queryKey: ["articles", status],
    queryFn: () => api<Page<ArticleSummary>>("GET", `/articles?limit=50${status ? `&status=${status}` : ""}`),
    enabled: !searching,
  });
  const found = useQuery({ queryKey: ["search", term], queryFn: () => api<{ items: SearchHit[] }>("GET", `/search?q=${encodeURIComponent(term)}`), enabled: searching });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTerm(String(new FormData(event.currentTarget).get("q") ?? "").trim());
  }

  const active = searching ? found : list;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Base de conhecimento</h1>
        {technician && (
          <Link to="/base/novo" className={`rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 ${focusRing}`}>
            Novo artigo
          </Link>
        )}
      </div>
      <form role="search" onSubmit={submit} className="mb-4 flex max-w-xl items-end gap-2">
        <div className="flex-1">
          <Field label="Buscar na base" id="q">
            <input id="q" name="q" type="search" maxLength={200} className={inputClass} />
          </Field>
        </div>
        <Button type="submit">Buscar</Button>
      </form>

      {technician && !searching && (
        <div className="mb-4 max-w-xs">
          <Field label="Situação" id="status">
            <select id="status" value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}>
              <option value="">Todos</option>
              <option value="draft">Rascunho</option>
              <option value="published">Publicado</option>
            </select>
          </Field>
        </div>
      )}

      {active.isPending && <Loading />}
      {active.isError && <ErrorMessage>Não foi possível carregar a base.</ErrorMessage>}

      {!searching && list.data && (list.data.items.length === 0 ? <p>Nenhum artigo publicado.</p> : (
        <ul className="divide-y divide-slate-300 rounded border border-slate-300">
          {list.data.items.map((article) => (
            <li key={article.id} className="space-y-1 p-3">
              <Link to={`/base/${article.id}`} className={`font-medium text-blue-800 underline ${focusRing}`}>
                {article.title}
              </Link>{" "}
              {article.status === "draft" && <Badge>Rascunho</Badge>}
              <p>{article.symptom}</p>
              <div className="flex flex-wrap gap-2">{article.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
            </li>
          ))}
        </ul>
      ))}

      {searching && found.data && (
        <>
          <p className="mb-2" role="status">
            {found.data.items.length === 0 ? `Nada encontrado para “${term}”.` : `${found.data.items.length} resultado(s) para “${term}”.`}
          </p>
          <ul className="divide-y divide-slate-300 rounded border border-slate-300">
            {found.data.items.map((hit) => (
              <li key={`${hit.kind}-${hit.id}`} className="space-y-1 p-3">
                {hit.kind === "article" ? (
                  <Link to={`/base/${hit.id}`} className={`font-medium text-blue-800 underline ${focusRing}`}>
                    {hit.title}
                  </Link>
                ) : (
                  <Link to={`/chamados/${hit.id}`} className={`font-medium text-blue-800 underline ${focusRing}`}>
                    {hit.title}
                  </Link>
                )}{" "}
                <Badge>{hit.kind === "article" ? "Artigo" : "Chamado resolvido"}</Badge>
                <p>{hit.kind === "article" ? hit.symptom : hit.summary}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
