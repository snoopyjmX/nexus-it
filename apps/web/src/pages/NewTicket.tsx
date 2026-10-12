import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { CATEGORY_LABEL } from "../labels";
import type { Ticket } from "../types";
import { Button, ErrorMessage, Field, inputClass } from "../ui";

export function NewTicket() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { title: string; description: string; category: string }) => api<Ticket>("POST", "/tickets", body),
    onSuccess: async (ticket) => {
      await client.invalidateQueries({ queryKey: ["tickets"] });
      await navigate(`/chamados/${ticket.id}`);
    },
    onError: (caught) => setError(caught instanceof ApiError && caught.status === 400 ? "Confira os campos: título até 120 caracteres, descrição até 5000." : "Não foi possível abrir o chamado. Tente de novo."),
  });

  // Só solicitante abre chamado; a API também recusa (403).
  if (user?.role === "technician") return <Navigate to="/chamados" replace />;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    create.mutate({ title: String(data.get("title") ?? "").trim(), description: String(data.get("description") ?? "").trim(), category: String(data.get("category") ?? "") });
  }

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Novo chamado</h1>
      <form onSubmit={submit} className="max-w-xl space-y-4" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Field label="Título" id="title">
          <input id="title" name="title" maxLength={120} required className={inputClass} />
        </Field>
        <Field label="Descrição" id="description">
          <textarea id="description" name="description" rows={6} maxLength={5000} required className={inputClass} />
        </Field>
        <Field label="Categoria" id="category">
          <select id="category" name="category" defaultValue="other" className={inputClass}>
            {Object.entries(CATEGORY_LABEL).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Enviando…" : "Abrir chamado"}
        </Button>
      </form>
    </>
  );
}
