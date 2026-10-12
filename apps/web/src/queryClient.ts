import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export const ME_KEY = ["me"] as const;

// Qualquer 401 vindo da API significa sessão encerrada (expirou ou foi revogada):
// derruba o usuário em memória e o guard de rota leva ao login.
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => endSessionOn401(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => endSessionOn401(client, error) }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return client;
}

function endSessionOn401(client: QueryClient, error: unknown): void {
  if (error instanceof ApiError && error.status === 401) client.setQueryData(ME_KEY, null);
}
