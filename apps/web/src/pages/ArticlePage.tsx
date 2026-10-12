import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api";
import { formatDate } from "../labels";
import type { Article } from "../types";
import { Badge, ErrorMessage, Loading, focusRing } from "../ui";
import { NotFound } from "./NotFound";

const SECTIONS = [
  ["symptom", "Sintoma"],
  ["environment", "Ambiente"],
  ["procedure", "Procedimento"],
  ["expectedResult", "Resultado esperado"],
] as const;

export function ArticlePage() {
  const { id = "" } = useParams();
  const article = useQuery({ queryKey: ["article", id], queryFn: () => api<Article>("GET", `/articles/${id}`) });

  if (article.isError && article.error instanceof ApiError && article.error.status === 404) return <NotFound />;
  if (article.isError) return <ErrorMessage>Não foi possível carregar o artigo.</ErrorMessage>;
  if (!article.data) return <Loading />;
  const a = article.data;
  return (
    <>
      <p className="mb-2">
        <Link to="/base" className={`text-blue-800 underline ${focusRing}`}>
          ← Base de conhecimento
        </Link>
      </p>
      <h1 className="mb-2 text-2xl font-semibold">{a.title}</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {a.status === "draft" && <Badge>Rascunho</Badge>}
        {a.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
        <span className="text-sm text-slate-700">
          Versão {a.version} · atualizado em {formatDate(a.updatedAt)}
        </span>
      </div>
      {SECTIONS.map(([key, title]) => (
        <section key={key} className="mb-4">
          <h2 className="mb-1 text-lg font-semibold">{title}</h2>
          <p className="whitespace-pre-wrap">{a[key]}</p>
        </section>
      ))}
    </>
  );
}
