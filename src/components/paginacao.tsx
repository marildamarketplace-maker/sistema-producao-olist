"use client";

import React from "react";

export type PaginacaoProps = {
  pagina: number;
  totalPaginas?: number;
  temProxima?: boolean;
  carregando?: boolean;
  onAnterior: () => void;
  onProxima: () => void;
  rotulo?: string;
};

export function Paginacao({ pagina, totalPaginas, temProxima, carregando = false,
  onAnterior, onProxima, rotulo = "Paginação" }: PaginacaoProps) {
  const podeAvancar = temProxima ?? (totalPaginas !== undefined && pagina < totalPaginas);
  const classe = "min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50";
  return <nav aria-label={rotulo} aria-busy={carregando} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p role="status" className="text-sm text-slate-600">Página {pagina}{totalPaginas !== undefined ? ` de ${Math.max(1, totalPaginas)}` : ""}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={classe} disabled={carregando || pagina <= 1} onClick={onAnterior}>Anterior</button>
      <button type="button" className={classe} disabled={carregando || !podeAvancar} onClick={onProxima}>Próxima</button>
    </div>
  </nav>;
}
