import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api";
import { useAuth, type User } from "../auth";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, describeEvent, formatDate } from "../labels";
import type { Status, Ticket, TicketComment, TicketEvent } from "../types";
import { Badge, Button, ErrorMessage, Field, Loading, focusRing, inputClass } from "../ui";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { NotFound } from "./NotFound";

interface Action {
  to: Status;
  label: string;
  // Texto que a API exige nesta transição (ARCHITECTURE §3).
  needs?: { field: "comment" | "resolutionNote"; label: string };
}

// Espelha a tabela de transições só para decidir quais botões mostrar. Quem decide é a API.
// Quem chega aqui já enxerga o chamado, então é o dono ou um técnico.
function actionsFor(user: User, ticket: Ticket): Action[] {
  const owner = user.role === "requester" && ticket.requester.id === user.id;
  const technician = user.role === "technician";
  switch (ticket.status) {
    case "open":
      return [
        ...(technician ? [{ to: "in_progress", label: "Iniciar atendimento" } as Action] : []),
        { to: "cancelled", label: "Cancelar chamado" } as Action,
      ];
    case "in_progress":
      return technician
        ? [
            { to: "waiting_requester", label: "Pedir informação", needs: { field: "comment", label: "O que falta saber" } },
            { to: "resolved", label: "Marcar como resolvido", needs: { field: "resolutionNote", label: "Nota de resolução" } },
          ]
        : [];
    case "waiting_requester":
      return [{ to: "in_progress", label: owner ? "Já respondi, retomar atendimento" : "Retomar atendimento" }];
    case "resolved":
      return [
        ...(owner ? [{ to: "in_progress", label: "Reabrir", needs: { field: "comment", label: "Motivo da reabertura" } } as Action] : []),
        { to: "closed", label: owner ? "Confirmar solução e fechar" : "Fechar chamado" } as Action,
      ];
    default:
      return [];
  }
}

const errorText = (error: unknown) => (error instanceof ApiError && error.detail ? error.detail : "Não foi possível concluir. Tente de novo.");

export function TicketDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | "edit" | null>(null);

  const ticket = useQuery({ queryKey: ["ticket", id], queryFn: () => api<Ticket>("GET", `/tickets/${id}`) });
  const comments = useQuery({ queryKey: ["ticket", id, "comments"], queryFn: () => api<{ items: TicketComment[] }>("GET", `/tickets/${id}/comments`), enabled: ticket.isSuccess });
  const events = useQuery({ queryKey: ["ticket", id, "events"], queryFn: () => api<{ items: TicketEvent[] }>("GET", `/tickets/${id}/events`), enabled: ticket.isSuccess });

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["ticket", id] }), client.invalidateQueries({ queryKey: ["tickets"] })]);
  const mutation = useMutation({
    mutationFn: (request: { method: "POST" | "PATCH"; path: string; body: unknown }) => api(request.method, `/tickets/${id}${request.path}`, request.body),
    onSuccess: async () => {
      setError(null);
      setPending(null);
      await refresh();
    },
    onError: (caught) => {
      setError(errorText(caught));
      // 409 e 404 significam que o chamado mudou: recarrega para mostrar o estado real.
      if (caught instanceof ApiError && caught.status === 409) void refresh();
    },
  });

  if (ticket.isError && ticket.error instanceof ApiError && ticket.error.status === 404) return <NotFound />;
  if (ticket.isError) return <ErrorMessage>Não foi possível carregar o chamado.</ErrorMessage>;
  if (!ticket.data || !user) return <Loading />;
  const t = ticket.data;
  const technician = user.role === "technician";
  const owner = user.role === "requester" && t.requester.id === user.id;
  const terminal = t.status === "closed" || t.status === "cancelled";
  const actions = actionsFor(user, t);

  function submitAction(event: FormEvent<HTMLFormElement>, action: Action) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("text") ?? "").trim();
    mutation.mutate({ method: "POST", path: "/transitions", body: { to: action.to, ...(action.needs ? { [action.needs.field]: text } : {}) } });
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ method: "PATCH", path: "", body: { version: t.version, title: String(data.get("title") ?? "").trim(), description: String(data.get("description") ?? "").trim() } });
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    mutation.mutate({ method: "POST", path: "/comments", body: { body } }, { onSuccess: () => form.reset() });
  }

  const patch = (changes: object) => mutation.mutate({ method: "PATCH", path: "", body: { version: t.version, ...changes } });

  const main = (
    <>
      <p className="mb-2">
        <Link to="/chamados" className={`text-blue-800 underline ${focusRing}`}>
          ← {technician ? "Fila de chamados" : "Meus chamados"}
        </Link>
      </p>
      <h1 className="mb-2 text-2xl font-semibold">{t.title}</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{STATUS_LABEL[t.status]}</Badge>
        <Badge>{PRIORITY_LABEL[t.priority]}</Badge>
        <Badge>{CATEGORY_LABEL[t.category]}</Badge>
        <span className="text-sm text-slate-700">
          Aberto por {t.requester.displayName} em {formatDate(t.createdAt)}
          {t.assignee ? ` · Responsável: ${t.assignee.displayName}` : " · Sem responsável"}
        </span>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <section aria-labelledby="descricao" className="mb-6">
        <h2 id="descricao" className="mb-1 text-lg font-semibold">
          Descrição
        </h2>
        {pending === "edit" ? (
          <form onSubmit={submitEdit} className="max-w-xl space-y-3">
            <Field label="Título" id="edit-title">
              <input id="edit-title" name="title" defaultValue={t.title} maxLength={120} required className={inputClass} />
            </Field>
            <Field label="Descrição" id="edit-description">
              <textarea id="edit-description" name="description" defaultValue={t.description} rows={5} maxLength={5000} required className={inputClass} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={mutation.isPending}>
                Salvar alterações
              </Button>
              <button type="button" onClick={() => setPending(null)} className={`rounded border border-slate-600 px-4 py-2 ${focusRing}`}>
                Descartar
              </button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap">{t.description}</p>
        )}
        {t.resolutionNote && (
          <p className="mt-3 rounded border border-green-700 bg-green-50 p-3 text-green-950">
            <strong>Resolução:</strong> {t.resolutionNote}
          </p>
        )}
      </section>

      {!terminal && (
        <section aria-labelledby="acoes" className="mb-6">
          <h2 id="acoes" className="mb-2 text-lg font-semibold">
            Ações
          </h2>
          <div className="flex flex-wrap gap-2">
            {owner && t.status === "open" && (
              <button type="button" onClick={() => setPending("edit")} className={`rounded border border-slate-600 px-4 py-2 ${focusRing}`}>
                Editar chamado
              </button>
            )}
            {actions.map((action) => (
              <Button
                key={action.to + action.label}
                type="button"
                disabled={mutation.isPending}
                onClick={() => (action.needs ? setPending(action) : mutation.mutate({ method: "POST", path: "/transitions", body: { to: action.to } }))}
              >
                {action.label}
              </Button>
            ))}
            {technician && t.assignee?.id !== user.id && (
              <button type="button" disabled={mutation.isPending} onClick={() => patch({ assigneeId: user.id })} className={`rounded border border-slate-600 px-4 py-2 ${focusRing}`}>
                Assumir
              </button>
            )}
          </div>
          {pending && pending !== "edit" && pending.needs && (
            <form onSubmit={(event) => submitAction(event, pending)} className="mt-3 max-w-xl space-y-3">
              <Field label={pending.needs.label} id="action-text">
                <textarea id="action-text" name="text" rows={3} maxLength={5000} required className={inputClass} />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={mutation.isPending}>
                  Confirmar: {pending.label}
                </Button>
                <button type="button" onClick={() => setPending(null)} className={`rounded border border-slate-600 px-4 py-2 ${focusRing}`}>
                  Voltar
                </button>
              </div>
            </form>
          )}
          {technician && (
            <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
              <Field label="Prioridade" id="priority">
                <select id="priority" value={t.priority} disabled={mutation.isPending} onChange={(event) => patch({ priority: event.target.value })} className={inputClass}>
                  {Object.entries(PRIORITY_LABEL).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Categoria" id="category">
                <select id="category" value={t.category} disabled={mutation.isPending} onChange={(event) => patch({ category: event.target.value })} className={inputClass}>
                  {Object.entries(CATEGORY_LABEL).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="conversa" className="mb-6">
        <h2 id="conversa" className="mb-2 text-lg font-semibold">
          Conversa
        </h2>
        {comments.isPending && <Loading />}
        {comments.data?.items.length === 0 && <p>Nenhum comentário ainda.</p>}
        <ul className="space-y-2">
          {comments.data?.items.map((comment) => (
            <li key={comment.id} className="rounded border border-slate-300 p-3">
              <p className="text-sm text-slate-700">
                {comment.author.displayName} · {formatDate(comment.createdAt)}
              </p>
              {/* Texto puro: React escapa o conteúdo. */}
              <p className="whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
        <form onSubmit={submitComment} className="mt-3 max-w-xl space-y-3">
          <Field label="Novo comentário" id="comment-body">
            <textarea id="comment-body" name="body" rows={3} maxLength={5000} required className={inputClass} />
          </Field>
          <Button type="submit" disabled={mutation.isPending}>
            Enviar comentário
          </Button>
        </form>
      </section>

      <section aria-labelledby="historico">
        <h2 id="historico" className="mb-2 text-lg font-semibold">
          Histórico
        </h2>
        {events.isPending && <Loading />}
        <ol className="space-y-1">
          {events.data?.items.map((event) => (
            <li key={event.id}>
              <span className="text-sm text-slate-700">{formatDate(event.createdAt)} · </span>
              {describeEvent(event)} <span className="text-sm text-slate-700">({event.actor.displayName})</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );

  // O técnico vê o painel de diagnóstico ao lado do chamado (ARCHITECTURE §7).
  if (!technician) return main;
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-8">
      <div>{main}</div>
      <DiagnosisPanel key={t.id} ticketId={t.id} />
    </div>
  );
}
