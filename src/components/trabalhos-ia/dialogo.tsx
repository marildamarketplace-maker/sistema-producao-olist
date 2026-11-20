"use client";
import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "@/hooks/use-modal-focus";

export const botaoIa = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const primarioIa = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export function DialogoIa({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: ReactNode }) {
  const ref = useModalFocus(fechar), id = useId();
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4"><h2 id={id} className="pt-2 text-lg font-semibold text-slate-900">{titulo}</h2><button type="button" className={botaoIa} aria-label="Fechar diálogo IA" onClick={fechar}><X aria-hidden="true" className="h-5 w-5" /></button></div>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6">{children}</div>
    </div>
  </div>;
}
