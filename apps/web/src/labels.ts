import type { Tone } from "./ui";
import type { Category, Priority, Status, TicketEvent } from "./types";

export const STATUS_LABEL: Record<Status, string> = {
  open: "Aberto",
  in_progress: "Em andamento",
  waiting_requester: "Aguardando solicitante",
  resolved: "Resolvido",
  closed: "Fechado",
  cancelled: "Cancelado",
};

// Só o que pede ação se destaca; o resto fica neutro para a fila continuar legível.
export const STATUS_TONE: Record<Status, Tone> = {
  open: "info",
  in_progress: "neutral",
  waiting_requester: "warn",
  resolved: "success",
  closed: "neutral",
  cancelled: "neutral",
};
export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "neutral",
  medium: "neutral",
  high: "warn",
  urgent: "danger",
};

export const PRIORITY_LABEL: Record<Priority, string> = { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" };

export const CATEGORY_LABEL: Record<Category, string> = { hardware: "Hardware", software: "Software", network: "Rede", access: "Acesso", other: "Outro" };

const name = (map: Record<string, string>, key: string | null | undefined) => (key ? (map[key] ?? key) : "ninguém");

// O histórico guarda só origem e destino; o texto é montado aqui.
export function describeEvent(event: Pick<TicketEvent, "type" | "payload">): string {
  const { from, to } = event.payload;
  switch (event.type) {
    case "created":
      return "Chamado aberto";
    case "transitioned":
      return `Status: ${name(STATUS_LABEL, from)} → ${name(STATUS_LABEL, to)}`;
    case "priority_changed":
      return `Prioridade: ${name(PRIORITY_LABEL, from)} → ${name(PRIORITY_LABEL, to)}`;
    case "category_changed":
      return `Categoria: ${name(CATEGORY_LABEL, from)} → ${name(CATEGORY_LABEL, to)}`;
    case "assignee_changed":
      return to ? "Responsável definido" : "Responsável removido";
    case "edited":
      return "Título ou descrição editados";
  }
}

export const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
