import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { formatDate } from "../labels";
import type { Article } from "../types";
import { Badge, Button, ErrorMessage, Loading, focusRing } from "../ui";
import { NotFound } from "./NotFound";

const SECTIONS = [
  ["symptom", "Sintoma"],
  ["environment", "Ambiente"],
  ["procedure", "Procedimento"],
  ["expectedResult", "Resultado esperado"],
] as const;

export function ArticlePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const article = useQuery({ queryKey: ["article", id], queryFn: () => api<Article>("GET", `/articles/${id}`) });

  const toggle = useMutation({
    mutationFn: (action: "publish" | "unpublish") => api<Article>("POST", `/articles/${id}/${action}`),
    onSuccess: async () => {
      setError(null);
      await Promise.all([client.invalidateQueries({ queryKey: ["article"] }), client.invalidateQueries({ queryKey: ["articles"] }), client.invalidateQueries({ queryKey: ["search"] })]);
    },
    onError: (caught) => setError(caught instanceof ApiError && caught.detail ? caught.detail : "Não foi possível concluir. Tente de novo."),
  });

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
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {user?.role === "technician" && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link to={`/base/${a.id}/editar`} className={`rounded border border-slate-600 px-4 py-2 ${focusRing}`}>
            Editar artigo
          </Link>
          <Button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate(a.status === "draft" ? "publish" : "unpublish")}>
            {a.status === "draft" ? "Publicar" : "Despublicar"}
          </Button>
        </div>
      )}
      {SECTIONS.map(([key, title]) => (
        <section key={key} className="mb-4">
          <h2 className="mb-1 text-lg font-semibold">{title}</h2>
          <p className="whitespace-pre-wrap">{a[key]}</p>
        </section>
      ))}
    </>
  );
}
