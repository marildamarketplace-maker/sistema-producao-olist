"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Download, Menu } from "lucide-react";

const formatos = [{ valor: "csv", nome: "CSV" }, { valor: "xlsx", nome: "Excel" }, { valor: "pdf", nome: "PDF" }] as const;
export type FormatoArquivo = typeof formatos[number]["valor"];

/** Menu local: abrir as opções não consulta nem prepara arquivos. */
export function MenuArquivos({ baixar, desabilitado = false, baixando = false, rotulo = "Arquivos" }: {
  baixar: (formato: FormatoArquivo) => void; desabilitado?: boolean; baixando?: boolean; rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId(), raiz = useRef<HTMLDivElement>(null), acionador = useRef<HTMLButtonElement>(null);
  const itens = useRef<(HTMLButtonElement | null)[]>([]), primeiro = useRef(0);
  useEffect(() => {
    if (!aberto) return;
    itens.current[primeiro.current]?.focus();
    const sair = (event: Event) => {
      if (event.target instanceof Node && !raiz.current?.contains(event.target)) setAberto(false);
    };
    document.addEventListener("pointerdown", sair);
    document.addEventListener("focusin", sair);
    return () => { document.removeEventListener("pointerdown", sair); document.removeEventListener("focusin", sair); };
  }, [aberto]);
  function fechar() { setAberto(false); acionador.current?.focus(); }
  function teclado(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); fechar(); return; }
    if (event.key === "Tab") { fechar(); return; }
    const atual = itens.current.findIndex(item => item === document.activeElement);
    const destino = event.key === "ArrowDown" ? (atual + 1) % formatos.length
      : event.key === "ArrowUp" ? (atual + formatos.length - 1) % formatos.length
      : event.key === "Home" ? 0 : event.key === "End" ? formatos.length - 1 : null;
    if (destino !== null) { event.preventDefault(); itens.current[destino]?.focus(); }
  }
  return <div ref={raiz} className="relative inline-flex">
    <button ref={acionador} id={`${id}-botao`} type="button" aria-haspopup="menu" aria-expanded={aberto} aria-controls={aberto ? id : undefined}
      disabled={desabilitado || baixando} onClick={() => { primeiro.current = 0; setAberto(!aberto); }}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); primeiro.current = event.key === "ArrowUp" ? formatos.length - 1 : 0; setAberto(true); } }}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
      <Menu className="h-4 w-4" aria-hidden="true" />{baixando ? "Baixando…" : rotulo}
    </button>
    {aberto && <div id={id} role="menu" aria-labelledby={`${id}-botao`} onKeyDown={teclado}
      className="absolute left-0 top-full z-20 mt-1 w-full min-w-28 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
      {formatos.map((formato, indice) => <button key={formato.valor} ref={elemento => { itens.current[indice] = elemento; }} type="button" role="menuitem" tabIndex={-1}
        disabled={desabilitado || baixando} onClick={() => { fechar(); baixar(formato.valor); }}
        className="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500 disabled:opacity-50">
        <Download className="h-4 w-4" aria-hidden="true" />{formato.nome}
      </button>)}
    </div>}
  </div>;
}
