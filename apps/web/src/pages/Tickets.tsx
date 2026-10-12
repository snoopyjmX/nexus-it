import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { CATEGORY_LABEL, PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, formatDate } from "../labels";
import type { Page, Ticket } from "../types";
import { Badge, Button, ErrorMessage, Field, Loading, focusRing, inputClass } from "../ui";

interface Filters {
  status: string;
  priority: string;
  category: string;
  mine: boolean;
}

const NO_FILTERS: Filters = { status: "", priority: "", category: "", mine: false };

function Select({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <Field label={label} id={id}>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        <option value="">Todos</option>
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Tickets() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(NO_FILTERS);
  const technician = user?.role === "technician";

  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.priority) query.set("priority", filters.priority);
  if (filters.category) query.set("category", filters.category);
  if (filters.mine && user) query.set("assigneeId", user.id);

  const list = useInfiniteQuery({
    queryKey: ["tickets", query.toString()],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam) params.set("cursor", pageParam);
      return api<Page<Ticket>>("GET", `/tickets?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const tickets = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{technician ? "Fila de chamados" : "Meus chamados"}</h1>
        {!technician && (
          <Link to="/chamados/novo" className={`rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 ${focusRing}`}>
            Novo chamado
          </Link>
        )}
      </div>

      {technician && (
        <form className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Filtros" onSubmit={(event) => event.preventDefault()}>
          <Select id="f-status" label="Status" value={filters.status} options={STATUS_LABEL} onChange={(status) => setFilters({ ...filters, status })} />
          <Select id="f-priority" label="Prioridade" value={filters.priority} options={PRIORITY_LABEL} onChange={(priority) => setFilters({ ...filters, priority })} />
          <Select id="f-category" label="Categoria" value={filters.category} options={CATEGORY_LABEL} onChange={(category) => setFilters({ ...filters, category })} />
          <label className="flex items-end gap-2 pb-2">
            <input type="checkbox" checked={filters.mine} onChange={(event) => setFilters({ ...filters, mine: event.target.checked })} className={focusRing} />
            Só os meus
          </label>
        </form>
      )}

      {list.isPending && <Loading />}
      {list.isError && <ErrorMessage>Não foi possível carregar os chamados.</ErrorMessage>}
      {list.isSuccess && tickets.length === 0 && <p>{technician ? "Nenhum chamado com esses filtros." : "Você ainda não abriu chamados."}</p>}
      {tickets.length > 0 && (
        <ul className="divide-y divide-slate-300 rounded border border-slate-300 bg-white">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="space-y-1 p-3">
              <Link to={`/chamados/${ticket.id}`} className={`font-medium text-blue-800 underline ${focusRing}`}>
                {ticket.title}
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
                <Badge tone={PRIORITY_TONE[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]}</Badge>
                <Badge>{CATEGORY_LABEL[ticket.category]}</Badge>
                <span className="text-sm text-slate-700">
                  {technician ? `${ticket.requester.displayName} · ` : ""}
                  {formatDate(ticket.createdAt)}
                  {ticket.assignee ? ` · Responsável: ${ticket.assignee.displayName}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button variant="secondary" type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="mt-4">
          {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
        </Button>
      )}
    </>
  );
}
