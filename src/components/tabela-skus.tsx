"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ColunaOrdenacaoSku, LinhaTabelaSku, OrdenacaoSku } from "@/lib/anotar-sku/ordenacao";

const colunas: { coluna: ColunaOrdenacaoSku; titulo: string }[] = [
  { coluna: "sku", titulo: "SKU do pedido" }, { coluna: "produto", titulo: "Produto" },
  { coluna: "tecido", titulo: "Tecido" }, { coluna: "quantidade", titulo: "Qtd" },
];

export function TabelaSkus<T extends LinhaTabelaSku>({ itens, ordem, ordenar, comTecido = false, carregando = false, nome, verPedidos }: {
  itens: readonly T[]; ordem: OrdenacaoSku; ordenar: (coluna: ColunaOrdenacaoSku) => void;
  comTecido?: boolean; carregando?: boolean; nome: string; verPedidos?: (item: T, origem: HTMLButtonElement) => void;
}) {
  return <div>
    <p className="mb-2 text-xs text-slate-500 sm:hidden">Deslize a tabela para ver todas as colunas.</p>
    <div className="overflow-x-auto rounded-md border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500" tabIndex={0} role="region" aria-label={nome} aria-busy={carregando}>
      <table className={`w-full text-left text-sm ${comTecido ? "min-w-[600px]" : "min-w-[480px]"}`}>
        <caption className="sr-only">{nome}. Clique em uma coluna para ordenar; clique novamente para inverter.</caption>
        <thead className="bg-slate-50 text-slate-700"><tr>{colunas.filter(c => comTecido || c.coluna !== "tecido").map(({ coluna, titulo }) => {
          const ativa = ordem.coluna === coluna;
          const Icone = ativa ? ordem.direcao === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
          return <th key={coluna} scope="col" aria-sort={ativa ? ordem.direcao === "asc" ? "ascending" : "descending" : "none"} className="px-3">
            <button type="button" disabled={carregando} onClick={() => ordenar(coluna)} title={`Ordenar por ${titulo}`} className={`flex min-h-11 w-full items-center gap-2 rounded-sm py-2 font-semibold hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50 ${coluna === "quantidade" ? "justify-end" : "text-left"}`}>
              {titulo}<Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </th>;
        })}</tr></thead>
        <tbody>{itens.map(item => <tr key={item.sku} className="border-t border-slate-200 text-slate-900">
          <th scope="row" className="min-w-36 max-w-56 break-words p-3 font-medium"><span className="block break-all">{item.sku}</span>
            {verPedidos && <button type="button" aria-label={`Ver pedidos do SKU ${item.sku}`} onClick={event => verPedidos(item, event.currentTarget)} className="mt-2 inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Ver pedidos</button>}
          </th>
          <td className="min-w-48 max-w-96 break-words p-3">{item.produto || "—"}</td>
          {comTecido && <td className="max-w-48 break-words p-3">{item.tecido || "—"}</td>}
          <td className="p-3 text-right font-semibold tabular-nums">{item.quantidade}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
