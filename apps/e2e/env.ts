import { fileURLToPath } from "node:url";

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3200);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180);
export const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 5190);

// Só vale no banco _test, apagado a cada execução (ver prepare-db.ts). Não é a senha de nenhum ambiente real.
export const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-senha-so-de-teste";

// Contas do cenário do seed (FR-16).
export const USERS = {
  technician: "tecnico@exemplo.local",
  requester1: "solicitante1@exemplo.local",
  requester2: "solicitante2@exemplo.local",
} as const;

export type Who = keyof typeof USERS;

export const authFile = (who: Who) => fileURLToPath(new URL(`./playwright/.auth/${who}.json`, import.meta.url));
