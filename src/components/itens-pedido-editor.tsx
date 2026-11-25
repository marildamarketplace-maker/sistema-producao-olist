"use client";

import type { Dispatch, SetStateAction } from "react";
import { PesquisaTecidoOlist } from "@/components/pesquisa-tecido-olist";
import type { RascunhoFilaOlist } from "@/lib/fila-olist-contrato";
import type { ItemPedidoManual } from "@/lib/pedido-manual-contrato";

type Props = {
  token: string;
  api: string;
  itens: ItemPedidoManual[];
  selecoes: RascunhoFilaOlist;
  disabled: boolean;
  limite: number;
  aoAlterarItem: (id: string, patch: Partial<ItemPedidoManual>) => void;
  aoRemover: (id: string) => void;
  aoAdicionar: () => void;
  aoAlterarSelecoes: Dispatch<SetStateAction<RascunhoFilaOlist>>;
};

const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50";

/** Cada linha conserva sua identidade, inclusive quando muda de posição ou tecido. */
export function ItensPedidoEditor({ token, api, itens, selecoes, disabled, limite, aoAlterarItem, aoRemover, aoAdicionar, aoAlterarSelecoes }: Props) {
  function alterarProduto(id: string, patch: { id?: number; preco?: number | null }) {
    // A pesquisa pode terminar depois de outra linha ter sido alterada.
    aoAlterarSelecoes(atual => ({ ...atual, tecidos: atual.tecidos.map(tecido => tecido.tecidoId === id ? { ...tecido, ...patch } : tecido) }));
  }

  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-slate-600">Informe as peças e o consumo em metros separadamente. A pesquisa de tecido consulta a conta Olist selecionada.</p>
    {!itens.length && <p role="status" className="text-sm text-slate-600">Nenhum item. Adicione um produto para continuar.</p>}
    {itens.map((item, index) => {
      const produto = selecoes.tecidos.find(tecido => tecido.tecidoId === item.id);
      return <fieldset key={item.id} disabled={disabled} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Item {index + 1}</legend>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <PesquisaTecidoOlist key={`${item.id}:${api}`} nome={item.tecidoNome} api={api} token={token} disabled={disabled}
            produtoId={produto?.id ?? 0} preco={produto?.preco ?? null}
            aoEncontrar={encontrado => alterarProduto(item.id, { id: encontrado.id, preco: encontrado.preco ?? null })}
            aoAlterarPreco={preco => alterarProduto(item.id, { preco })}>
            <label className="block min-w-0 text-sm">Tecido<input className="input mt-1 min-h-11 w-full" maxLength={500} value={item.tecidoNome}
              onChange={event => aoAlterarItem(item.id, { tecidoNome: event.target.value })} /></label>
          </PesquisaTecidoOlist>
          <label className="min-w-0 text-sm">Quantidade de peças (UN)<input className="input mt-1 min-h-11 w-full" type="number" min={1} max={2147483647} step={1}
            value={item.quantidade || ""} onChange={event => aoAlterarItem(item.id, { quantidade: Number(event.target.value) })} /></label>
          <label className="min-w-0 text-sm">Quantidade de tecido (MT)<input className="input mt-1 min-h-11 w-full" type="number" min={0.000001} max={1000000000} step="0.000001"
            value={item.quantidadeTecido || ""} onChange={event => aoAlterarItem(item.id, { quantidadeTecido: Number(event.target.value) })} /></label>
          <label className="min-w-0 text-sm">Estampa<input className="input mt-1 min-h-11 w-full" maxLength={500} value={item.estampa}
            onChange={event => aoAlterarItem(item.id, { estampa: event.target.value })} /></label>
          <label className="min-w-0 text-sm">Variante (opcional)<input className="input mt-1 min-h-11 w-full" maxLength={500} value={item.variante ?? ""}
            onChange={event => aoAlterarItem(item.id, { variante: event.target.value || null })} /></label>
          <label className="min-w-0 text-sm">Tamanho<input className="input mt-1 min-h-11 w-full" maxLength={500} value={item.tamanho}
            onChange={event => aoAlterarItem(item.id, { tamanho: event.target.value })} /></label>
          <label className="min-w-0 text-sm">Tipo de produto<input className="input mt-1 min-h-11 w-full" maxLength={500} value={item.tipoProduto}
            onChange={event => aoAlterarItem(item.id, { tipoProduto: event.target.value })} /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={item.corteLaser}
            onChange={event => aoAlterarItem(item.id, { corteLaser: event.target.checked })} />Corte a laser</label>
        </div>
        <button type="button" className={botao} onClick={() => aoRemover(item.id)}>Remover item {index + 1}</button>
      </fieldset>;
    })}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={botao} disabled={disabled || itens.length >= limite} onClick={aoAdicionar}>Adicionar item</button>
      <span role="status" className="text-xs text-slate-600">{itens.length} de {limite} itens{itens.length >= limite ? " · Limite atingido" : ""}</span>
    </div>
  </div>;
}
