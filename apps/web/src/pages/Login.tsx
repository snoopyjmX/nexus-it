import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Button, ErrorMessage, inputClass } from "../ui";

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "E-mail ou senha incorretos.";
  if (error instanceof ApiError && error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  return "Não foi possível entrar agora. Tente de novo.";
}

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (user) return <Navigate to={from} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await login(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
      await navigate(from, { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="conteudo" className="mx-auto max-w-sm p-6">
      <h1 className="mb-6 text-2xl font-semibold">Entrar no NEXUS IT</h1>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div>
          <label htmlFor="email" className="mb-1 block font-medium">
            E-mail
          </label>
          <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block font-medium">
            Senha
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </main>
  );
}
