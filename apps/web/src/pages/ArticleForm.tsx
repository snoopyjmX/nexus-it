import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Article } from "../types";
import { Button, ErrorMessage, Field, Loading, focusRing, inputClass } from "../ui";
import { NotFound } from "./NotFound";

const FIELDS = [
  ["title", "Título", 160, "input"],
  ["symptom", "Sintoma", 5000, "textarea"],
  ["environment", "Ambiente", 2000, "textarea"],
  ["procedure", "Procedimento", 10000, "textarea"],
  ["expectedResult", "Resultado esperado", 2000, "textarea"],
] as const;

const parseTags = (raw: string) => [...new Set(raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return "O artigo foi alterado por outra pessoa. Recarregue a página e refaça a edição.";
  if (error instanceof ApiError && error.status === 400) return "Confira os campos. Tags: até 10, só letras minúsculas sem acento, números, ponto, hífen e sublinhado (até 30 caracteres).";
  return "Não foi possível salvar. Tente de novo.";
}

// Criar (/base/novo) e editar (/base/:id/editar) usam o mesmo formulário.
export function ArticleForm({ mode }: { mode: "create" | "edit" }) {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const existing = useQuery({ queryKey: ["article", id], queryFn: () => api<Article>("GET", `/articles/${id}`), enabled: mode === "edit" });

  const save = useMutation({
    mutationFn: (body: object) => (mode === "create" ? api<Article>("POST", "/articles", body) : api<Article>("PATCH", `/articles/${id}`, body)),
    onSuccess: async (article) => {
      await Promise.all([client.invalidateQueries({ queryKey: ["articles"] }), client.invalidateQueries({ queryKey: ["article"] }), client.invalidateQueries({ queryKey: ["search"] })]);
      await navigate(`/base/${article.id}`);
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  // Só técnico escreve na base; a API também recusa (403).
  if (user?.role !== "technician") return <Navigate to="/base" replace />;
  if (mode === "edit" && existing.isError) return existing.error instanceof ApiError && existing.error.status === 404 ? <NotFound /> : <ErrorMessage>Não foi possível carregar o artigo.</ErrorMessage>;
  if (mode === "edit" && !existing.data) return <Loading />;
  const current = existing.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setError(null);
    save.mutate({
      ...(mode === "edit" && current ? { version: current.version } : {}),
      title: text("title"),
      symptom: text("symptom"),
      environment: text("environment"),
      procedure: text("procedure"),
      expectedResult: text("expectedResult"),
      tags: parseTags(text("tags")),
    });
  }

  return (
    <>
      <p className="mb-2">
        <Link to={mode === "edit" ? `/base/${id}` : "/base"} className={`text-blue-800 underline ${focusRing}`}>
          ← {mode === "edit" ? "Voltar ao artigo" : "Base de conhecimento"}
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold">{mode === "create" ? "Novo artigo" : "Editar artigo"}</h1>
      <form onSubmit={submit} className="max-w-2xl space-y-4" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {FIELDS.map(([name, label, max, kind]) => (
          <Field key={name} label={label} id={name}>
            {kind === "input" ? (
              <input id={name} name={name} defaultValue={current?.[name]} maxLength={max} required className={inputClass} />
            ) : (
              <textarea id={name} name={name} defaultValue={current?.[name]} rows={name === "procedure" ? 8 : 4} maxLength={max} required className={inputClass} />
            )}
          </Field>
        ))}
        <Field label="Tags (separadas por vírgula)" id="tags">
          <input id="tags" name="tags" defaultValue={current?.tags.join(", ")} className={inputClass} />
        </Field>
        <p className="text-sm text-slate-700">{mode === "create" ? "O artigo nasce como rascunho e só aparece para os solicitantes depois de publicado." : "Editar um artigo publicado altera o que os solicitantes veem na hora."}</p>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </form>
    </>
  );
}
