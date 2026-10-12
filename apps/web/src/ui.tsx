import type { ButtonHTMLAttributes, ReactNode } from "react";

// Estilos compartilhados. Foco visível e contraste AA fazem parte do requisito (NFR-06).
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export const inputClass = `block w-full rounded border border-slate-500 bg-white px-3 py-2 text-slate-900 ${focusRing}`;

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${className}`}
      {...props}
    />
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded border border-red-700 bg-red-50 px-3 py-2 text-red-900">
      {children}
    </p>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded border border-slate-500 bg-slate-100 px-2 py-0.5 text-sm text-slate-900">{children}</span>;
}

export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <p role="status" className="text-slate-700">
      Carregando…
    </p>
  );
}
