import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "./auth";
import { Button, focusRing } from "./ui";

const NAV = (role: string): [string, string][] => [
  ["/chamados", role === "technician" ? "Fila" : "Meus chamados"],
  ["/base", "Base de conhecimento"],
];

export function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  if (loading) return <p role="status" className="p-6">Carregando…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  return (
    <>
      <a href="#conteudo" className={`sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-white focus:p-2 ${focusRing}`}>
        Pular para o conteúdo
      </a>
      <header className="border-b border-slate-300 bg-slate-50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 p-4">
          <NavLink to="/" className={`text-lg font-semibold ${focusRing}`}>
            NEXUS IT
          </NavLink>
          <nav aria-label="Principal" className="flex gap-4">
            {NAV(user.role).map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => `underline-offset-4 ${isActive ? "font-semibold underline" : ""} ${focusRing}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span>{user.displayName}</span>
            <Button type="button" onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </>
  );
}
