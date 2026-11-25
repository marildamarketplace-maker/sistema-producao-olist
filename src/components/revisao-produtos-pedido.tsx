import { agruparProdutosRevisao } from "@/lib/revisao-pedido";
import type { ItemPedidoManual } from "@/lib/pedido-manual-contrato";
const numero = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
const moeda = (valor: number | null) => valor == null ? "Pendente" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function RevisaoProdutosPedido({ itens, produtos }: { itens: ItemPedidoManual[]; produtos: Array<{ tecidoId: string; id: number; preco: number | null }> }) {
 return <div className="min-w-0 space-y-4">{agruparProdutosRevisao(itens, produtos).map(card => <article key={card.chave} className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
  <header className="flex flex-col gap-3 bg-slate-50 p-4 lg:flex-row lg:items-start lg:justify-between">
   <div className="min-w-0 space-y-1"><h4 className="break-words font-semibold">{card.nome}</h4><p className="text-xs text-slate-500">Produto Olist: {card.produtoId || "Pendente"}</p></div>
   <p className="shrink-0 font-semibold tabular-nums">{card.pecas ? `${numero(card.pecas)} peças · ` : ""}{numero(card.metros)} m no total</p>
  </header>
  <div className="divide-y divide-slate-200">{card.tipos.map(grupo => {
   const base=grupo.itens[0],liso=base.modalidade==="TECIDO_LISO",produto=!base.modalidade||base.modalidade==="PRODUTO_SUBLIMADO";
   const tipo=liso?"Tecido sem estampa":!produto?"Tecido sublimado":base.tipoProduto||"Produto sublimado";
   const colunas=produto?["Estampa","Variante","Tamanho","Peças","Metros","Laser"]:["Estampa","Variante","Metros"];
   return <section key={grupo.chave} aria-label={tipo} className="min-w-0 p-4">
    <header className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2"><h5 className="break-words font-semibold">{tipo}</h5><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className="font-medium tabular-nums">{grupo.pecas?`${numero(grupo.pecas)} peças · `:""}{numero(grupo.metros)} m</span><span className="text-slate-600">Preço/m: {moeda(grupo.preco)}</span></div></header>
    {!liso && <>
     <div aria-hidden="true" className={`hidden gap-4 border-b border-slate-200 py-2 text-xs font-medium text-slate-500 lg:grid ${produto?"lg:grid-cols-6":"lg:grid-cols-3"}`}>{colunas.map(c=><span key={c}>{c}</span>)}</div>
     <ul className="divide-y divide-slate-200">{grupo.itens.map(i=>{
      const valores=produto?[i.estampa||"—",i.variante||"—",i.tamanho||"—",numero(i.quantidade),`${numero(i.quantidadeTecido)} m`,i.corteLaser?"Sim":"Não"]:[i.estampa||"—",i.variante||"—",`${numero(i.quantidadeTecido)} m`];
      return <li key={i.id} className="py-3 lg:py-2"><dl className={`grid grid-cols-2 gap-x-4 gap-y-3 ${produto?"lg:grid-cols-6":"lg:grid-cols-3"}`}>{colunas.map((c,n)=><div key={c} className="min-w-0"><dt className="text-xs text-slate-500 lg:sr-only">{c}</dt><dd className="mt-1 break-words tabular-nums lg:mt-0">{valores[n]}</dd></div>)}</dl></li>;
     })}</ul>
    </>}
   </section>;
  })}</div>
 </article>)}</div>;
}
