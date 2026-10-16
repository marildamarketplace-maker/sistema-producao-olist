"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";

export type MovimentacaoEstoqueResumo = {
  id: string;
  produto_id: string;
  sku: string;
  tipo_movimento: "entrada" | "saida";
  quantidade: number;
  origem: string;
  observacao: string | null;
  created_at: string;
  producao_id: string | null;
};

export function MovimentacoesEstoqueModal({ sku, movimentacoes, onFechar }: {
  sku: string;
  movimentacoes: MovimentacaoEstoqueResumo[];
  onFechar: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    fecharRef.current?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus();
    };
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="titulo-movimentacoes-estoque" aria-describedby="descricao-movimentacoes-estoque" aria-modal="true" onCancel={(event) => { event.preventDefault(); onFechar(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-4 backdrop:bg-slate-950/40">
    <div className="flex min-h-full items-center justify-center">
      <div className="flex max-h-[85dvh] w-full max-w-4xl flex-col rounded-lg bg-white text-slate-900 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
          <div className="min-w-0"><h3 id="titulo-movimentacoes-estoque" className="text-lg font-semibold">Movimentacoes de estoque</h3><p id="descricao-movimentacoes-estoque" className="mt-1 text-sm text-slate-600"><span className="break-all">{sku}</span> - {movimentacoes.length} movimentacoes</p><p className="mt-2 text-xs text-slate-500">Linhas com o ícone de link abrem o pedido de produção em nova aba.</p></div>
          <button ref={fecharRef} type="button" onClick={onFechar} className="min-h-11 shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">Fechar</button>
        </div>
        <div className="min-h-0 overflow-auto p-4 sm:p-5">
          {movimentacoes.length === 0 ? <p className="text-sm text-slate-600">Nenhuma movimentacao para este item.</p> : <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-slate-200 text-left text-slate-600">{["Data", "Tipo", "Quantidade", "Origem", "Observacao"].map((titulo) => <th key={titulo} scope="col" className="p-3">{titulo}</th>)}</tr></thead>
            <tbody>{movimentacoes.map((mov) => {
              const href = mov.producao_id ? `/solicitacoes-producao/${encodeURIComponent(mov.producao_id)}` : null;
              return <tr key={mov.id} className={`relative border-b border-slate-100 ${href ? "cursor-pointer hover:bg-slate-50 focus-within:bg-slate-50" : ""}`}>
                <td className="text-slate-700">{href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ver detalhes do pedido de produção da movimentação de ${new Date(mov.created_at).toLocaleString("pt-BR")} (abre em nova aba)`} title="Ver detalhes do pedido de produção (nova aba)" className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap p-3 underline underline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-slate-500">
                  {new Date(mov.created_at).toLocaleString("pt-BR")}<ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                </a> : <span className="inline-block whitespace-nowrap p-3">{new Date(mov.created_at).toLocaleString("pt-BR")}</span>}</td>
                <td className="p-3"><span className={`rounded-md px-2 py-1 text-xs font-semibold uppercase ${mov.tipo_movimento === "entrada" ? "bg-emerald-50 text-emerald-700 dark:text-emerald-300" : "bg-red-50 text-red-700"}`}>{mov.tipo_movimento}</span></td>
                <td className="p-3 font-semibold text-slate-900">{mov.quantidade}</td>
                <td className="p-3 text-slate-700">{mov.origem}</td>
                <td className="min-w-48 whitespace-pre-wrap break-words p-3 text-slate-700">{mov.observacao || "-"}</td>
              </tr>;
            })}</tbody>
          </table>}
        </div>
      </div>
    </div>
  </dialog>;
}
