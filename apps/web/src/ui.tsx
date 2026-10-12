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
