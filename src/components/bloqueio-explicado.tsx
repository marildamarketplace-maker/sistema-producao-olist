"use client";

import { useId, useState, type ReactNode } from "react";

/** O invólucro recebe foco e toque mesmo quando o controle interno está desabilitado. */
export function BloqueioExplicado({ motivo, nome, children }: { motivo: string; nome: string; children: ReactNode }) {
  const id = useId();
  const [focado, setFocado] = useState(false);
  const [hover, setHover] = useState(false);
  const [toque, setToque] = useState(false);
  const [dispensado, setDispensado] = useState(false);
  const aberto = !dispensado && (focado || hover || toque);
  return <span className="relative inline-flex min-h-11 max-w-full items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
    tabIndex={0} role="group" aria-label={nome} aria-describedby={id} title={motivo}
    onClick={() => { setToque(true); setDispensado(false); }} onFocus={() => { setFocado(true); setDispensado(false); }}
    onBlur={() => { setFocado(false); setToque(false); setDispensado(false); }}
    onMouseEnter={() => { setHover(true); setDispensado(false); }} onMouseLeave={() => setHover(false)}
    onKeyDown={event => { if (event.key === "Escape") { setDispensado(true); setToque(false); } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDispensado(atual => !atual); } }}>
    {children}
    <span id={id} role="tooltip" className={`${aberto ? "block" : "hidden"} absolute left-0 right-0 top-full z-20 mt-1 break-words rounded-md border border-slate-300 bg-white p-3 text-xs text-slate-700 shadow-lg`}>{motivo}</span>
  </span>;
}
