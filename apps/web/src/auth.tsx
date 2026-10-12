import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { api, ApiError, setCsrfToken } from "./api";
import { ME_KEY } from "./queryClient";

export type Role = "requester" | "technician";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function fetchMe(): Promise<User | null> {
  try {
    const { user, csrfToken } = await api<{ user: User; csrfToken: string }>("GET", "/auth/me");
    setCsrfToken(csrfToken);
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity });

  const state: AuthState = {
    user: me.data ?? null,
    loading: me.isPending,
    async login(email, password) {
      await api("POST", "/auth/login", { email, password });
      // Sessão nova: o token CSRF vem de /auth/me.
      await client.resetQueries({ queryKey: ME_KEY });
    },
    async logout() {
      try {
        await api("POST", "/auth/logout");
      } finally {
        setCsrfToken(null);
        // Apaga o que era do usuário anterior (chamados, artigos), mantendo o observador de ME_KEY.
        client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
        client.setQueryData(ME_KEY, null);
      }
    },
  };
  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth fora do AuthProvider");
  return state;
}
