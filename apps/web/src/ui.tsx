import type { ButtonHTMLAttributes, ReactNode } from "react";

// Estilos compartilhados. Foco visível e contraste AA fazem parte do requisito (NFR-06).
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export const inputClass = `block w-full rounded border border-slate-500 bg-white px-3 py-2 text-slate-900 ${focusRing}`;

const BUTTON_VARIANT = {
  primary: "bg-blue-700 text-white hover:bg-blue-800",
  secondary: "border border-slate-600 bg-white text-slate-900 hover:bg-slate-100",
  danger: "border border-red-700 bg-white text-red-800 hover:bg-red-50",
};

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANT }) {
  return <button className={`rounded px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANT[variant]} ${focusRing} ${className}`} {...props} />;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded border border-red-700 bg-red-50 px-3 py-2 text-red-900">
      {children}
    </p>
  );
}

// O texto do selo sempre diz o valor; o tom só reforça, nunca é a única pista (NFR-06).
export type Tone = "neutral" | "info" | "warn" | "danger" | "success";
const BADGE_TONE: Record<Tone, string> = {
  neutral: "border-slate-500 bg-slate-100 text-slate-900",
  info: "border-blue-700 bg-blue-50 text-blue-950",
  warn: "border-amber-700 bg-amber-50 text-amber-950",
  danger: "border-red-700 bg-red-50 text-red-950",
  success: "border-green-700 bg-green-50 text-green-950",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-sm ${BADGE_TONE[tone]}`}>
      {children}
    </span>
  );
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
