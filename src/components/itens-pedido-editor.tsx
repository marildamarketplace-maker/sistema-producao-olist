"use client";

import { PreviewVariantePedido } from "@/components/preview-variante-pedido";
import { EstampaItemPedido } from "@/components/estampa-item-pedido";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useRef, useEffect, type Dispatch, type SetStateAction } from "react";
import { EstadoCatalogoTecidosOlist, PesquisaTecidoOlist } from "@/components/pesquisa-tecido-olist";
import { TamanhoItemPedido, type CacheTamanhosPedido } from "@/components/tamanho-item-pedido";
import type { CatalogoTecidosOlist } from "@/lib/catalogo-tecidos-olist";
import type { RascunhoFilaOlist } from "@/lib/fila-olist-contrato";
import { itemPedidoManualSchema, type ItemPedidoManual } from "@/lib/pedido-manual-contrato";
import { alterarPecas, metrosPedido, modalidadesPedido, resumirItensPedido, selecionarTamanho, trocarModalidade, type ModalidadePedido } from "@/lib/itens-pedido-producao";

type Props = {
  atualizarNoCabecalho?: boolean;
  validacao?: number;
  catalogo: CatalogoTecidosOlist; itens: ItemPedidoManual[]; selecoes: RascunhoFilaOlist;
  disabled: boolean; limite: number; apiTamanhos?: string; token?: string;
  aoAlterarItem: (id: string, patch: Partial<ItemPedidoManual>) => void;
  aoAlterarGrupo?: (ids: string[], patch: Partial<ItemPedidoManual>) => void;
  aoRemover: (id: string) => void;
  aoDuplicarGrupo?: (grupo: ItemPedidoManual[]) => void;
  aoAdicionar: (modelo?: ItemPedidoManual, combinar?: boolean) => void;
  aoAlterarSelecoes: Dispatch<SetStateAction<RascunhoFilaOlist>>;
};
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50";
const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

/** Agrupamento só organiza o preenchimento. Identidade e consumo permanecem por item. */
export function ItensPedidoEditor(props: Props) {
  const { catalogo, itens, selecoes, disabled, limite, aoAlterarItem, aoRemover, aoAdicionar, aoAlterarSelecoes } = props;
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => { if (props.validacao) { const campo = raiz.current?.querySelector<HTMLElement>('[aria-invalid="true"]'); campo?.focus(); campo?.scrollIntoView({ block: "center", behavior: "smooth" }); } }, [props.validacao]);
  const erros = new Map<string, Record<string, string>>();
  if (props.validacao) for (const item of itens) {
    const campos: Record<string, string> = {};
    if (!item.modalidade) campos.modalidade = "Escolha a modalidade.";
    const parsed = itemPedidoManualSchema.safeParse(item);
    if (!parsed.success) for (const issue of parsed.error.issues) { const campo = String(issue.path[0] ?? "modalidade"); campos[campo === "tamanhoId" ? "tamanho" : campo] ??= issue.message; }
    erros.set(item.id, campos);
  }
  const mensagem = (id: string, campo: string) => erros.get(id)?.[campo];
  const feedback = (id: string, campo: string) => mensagem(id,campo) ? <span id={`${id}-${campo}-erro`} role="alert" className="mt-1 block text-xs text-red-700">{mensagem(id,campo)}</span> : null;
  const atributos = (id: string, campo: string) => ({ "aria-invalid": Boolean(mensagem(id,campo)), "aria-describedby": mensagem(id,campo) ? `${id}-${campo}-erro` : undefined });
  const cache = useRef<CacheTamanhosPedido>(new Map());
  const grupos = new Map<string, ItemPedidoManual[]>();
  for (const item of itens) { const chave = item.grupoId ?? item.id; const grupo = grupos.get(chave) ?? []; grupo.push(item); grupos.set(chave, grupo); }
  const indices = new Map(itens.map((item, index) => [item.id, index]));
  const associacoes = new Map(selecoes.tecidos.map(t => [t.tecidoId, t]));
  const totais = resumirItensPedido(itens);
  function alterarProduto(ids: string[], patch: { id?: number; preco?: number | null }) {
    const conjunto = new Set(ids);
    aoAlterarSelecoes(atual => ({ ...atual, tecidos: atual.tecidos.map(t => conjunto.has(t.tecidoId) ? { ...t, ...patch } : t) }));
  }
  function modalidade(grupo: ItemPedidoManual[], valor: ModalidadePedido) {
    for (const item of grupo) aoAlterarItem(item.id, trocarModalidade(item, valor));
  }
  return <div ref={raiz} className="min-w-0 space-y-4">
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium">O que será produzido?</p><p className="mt-1 text-sm text-slate-600">Escolha a modalidade em cada grupo. Adicione combinações para repetir a estampa em outras variantes ou tamanhos.</p>
      <p className="mt-3 text-sm" role="status"><strong>{numero(totais.pecas)}</strong> peças · <strong>{numero(totais.metros)} m</strong> de tecido · <strong>{numero(totais.laser)} m</strong> com laser</p>
    </div>
    <EstadoCatalogoTecidosOlist catalogo={catalogo} disabled={disabled} ocultarAtualizar={props.atualizarNoCabecalho} />
    {!itens.length && <p role="status" className="text-sm text-slate-600">Nenhum item. Adicione um produto para continuar.</p>}
    {[...grupos.entries()].map(([chave, grupo], indice) => {
      const base = grupo[0], ids = grupo.map(i => i.id);
      const produto = associacoes.get(base.id);
      const isProduto = !base.modalidade || base.modalidade === "PRODUTO_SUBLIMADO";
      const temEstampa = base.modalidade !== "TECIDO_LISO";
      const exibirCampos = Boolean(base.modalidade);
      const temDados = Boolean(base.tecidoNome || base.estampa || base.variante || base.tamanho || base.tipoProduto);
      const alterarComum = (patch: Partial<ItemPedidoManual>) => props.aoAlterarGrupo ? props.aoAlterarGrupo(ids, patch) : grupo.forEach(i => aoAlterarItem(i.id, patch));
      return <fieldset key={chave} disabled={disabled} className="min-w-0 space-y-4 rounded-lg border border-slate-300 bg-slate-50 p-4">
        <legend className="px-1 text-sm font-semibold">{grupo.length > 1 ? `Grupo ${indice + 1} · ${grupo.length} combinações` : `Item ${(indices.get(base.id) ?? 0) + 1}`}</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={`Modalidade do grupo ${indice + 1}`}>
          {(Object.entries(modalidadesPedido) as [ModalidadePedido, string][]).map(([valor, rotulo]) => <button key={valor} type="button" {...atributos(base.id,"modalidade")} aria-pressed={base.modalidade === valor}
            className={`${botao} text-left ${base.modalidade === valor ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"}`}
            onClick={() => { if (base.modalidade !== valor) modalidade(grupo, valor); }}>{rotulo}</button>)}
        </div>
        {feedback(base.id,"modalidade")}
        {!base.modalidade && <p role="status" className="text-sm text-amber-700">{temDados ? "Defina a modalidade deste item antes de continuar. Os dados existentes foram preservados." : "Escolha a modalidade para preencher os campos."}</p>}
        {!exibirCampos && <button type="button" className={`${botao} inline-flex min-w-11 items-center justify-center`} aria-label={`Remover item ${(indices.get(base.id) ?? 0) + 1}`} title="Remover item" onClick={() => aoRemover(base.id)}><Trash2 className="h-5 w-5" aria-hidden="true" /></button>}
        {exibirCampos && <><div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PesquisaTecidoOlist nome={base.tecidoNome} catalogo={catalogo} disabled={disabled} produtoId={produto?.id ?? 0} preco={produto?.preco ?? null}
            aoEncontrar={encontrado => { alterarComum({ tecidoNome: encontrado.nome }); alterarProduto(ids, { id: encontrado.id, preco: encontrado.preco ?? null }); }}
            aoAlterarPreco={preco => alterarProduto(ids, { preco })} aoLimparAssociacao={() => alterarProduto(ids, { id: 0, preco: null })}>
            <label className="block min-w-0 text-sm">Tecido<input {...atributos(base.id,"tecidoNome")} className="input aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-200 mt-1 min-h-11 w-full" maxLength={500} value={base.tecidoNome} onChange={e => alterarComum({ tecidoNome: e.target.value })} />{feedback(base.id,"tecidoNome")}</label>
          </PesquisaTecidoOlist>
          {temEstampa && <EstampaItemPedido erro={mensagem(base.id,"estampa")} valor={base.estampa} api={props.apiTamanhos} token={props.token} disabled={disabled} aoAlterar={estampa => alterarComum({ estampa })} />}
          {isProduto && <label className="min-w-0 text-sm">Tipo de produto<input {...atributos(base.id,"tipoProduto")} className="input aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-200 mt-1 min-h-11 w-full" maxLength={500} value={base.tipoProduto} onChange={e => alterarComum({ tipoProduto: e.target.value })} />{feedback(base.id,"tipoProduto")}</label>}
        </div>
        <div className="space-y-3">{grupo.map(item => {
          const index = indices.get(item.id) ?? 0;
          const auto = item.modoMetragem === "AUTOMATICA";
          return <div key={item.id} data-item-id={item.id} className="min-w-0 space-y-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><p className="break-words text-sm font-medium">Item {index + 1}{item.variante ? ` · ${item.variante}` : ""}{item.tamanho ? ` · ${item.tamanho}` : ""}</p><button type="button" className={`${botao} inline-flex min-w-11 items-center justify-center`} aria-label={`Remover item ${index + 1}`} title="Remover item" onClick={() => aoRemover(item.id)}><Trash2 className="h-5 w-5" aria-hidden="true" /></button></div></div>
            <div className={`grid min-w-0 gap-3 ${isProduto ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2"}`}>
              {temEstampa && <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><EstampaItemPedido erro={mensagem(item.id,"variante")} valor={item.variante ?? ""} codigoEstampa={base.estampa} api={props.apiTamanhos} token={props.token} disabled={disabled} aoAlterar={variante => aoAlterarItem(item.id, { variante: variante || null })} /></div><PreviewVariantePedido key={`${props.apiTamanhos}:${props.token}:${base.estampa}:${item.variante}`} codigo={base.estampa} variante={item.variante ?? ""} api={props.apiTamanhos} token={props.token}/></div>}
              {isProduto && <><TamanhoItemPedido erro={mensagem(item.id,"tamanho")} item={item} api={props.apiTamanhos} token={props.token} cache={cache.current}
                aoDigitar={valor => aoAlterarItem(item.id, { tamanho: valor, tamanhoId: null, consumoUnidade: null, modoMetragem: "MANUAL", revisarMetragem: item.quantidadeTecido > 0 })}
                aoSelecionar={(tamanho, manter) => aoAlterarItem(item.id, selecionarTamanho(item, tamanho, manter))} />
                <label className="min-w-0 text-sm">Quantidade de peças (UN)<input {...atributos(item.id,"quantidade")} className="input aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-200 mt-1 min-h-11 w-full" type="number" min={1} max={2147483647} step={1} value={item.quantidade || ""} onChange={e => aoAlterarItem(item.id, alterarPecas(item, Number(e.target.value)))} />{feedback(item.id,"quantidade")}</label></>}
              <div className="min-w-0 space-y-2"><label className="block text-sm">Quantidade de tecido (MT)<input {...atributos(item.id,"quantidadeTecido")} className="input aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-200 mt-1 min-h-11 w-full" type="number" min={0.000001} max={1000000000} step="0.000001" value={item.quantidadeTecido || ""} onChange={e => aoAlterarItem(item.id, { quantidadeTecido: Number(e.target.value), modoMetragem: "MANUAL", revisarMetragem: false })} />{feedback(item.id,"quantidadeTecido")}</label>
                {isProduto && <><p className="text-xs text-slate-600">{item.consumoUnidade ? `${numero(item.quantidade)} peças × ${numero(item.consumoUnidade)} m = ${numero(metrosPedido(item.quantidade, item.consumoUnidade))} m` : "Selecione um tamanho com consumo ou informe os metros."}</p>
                  {!auto && <>{item.consumoUnidade && <button type="button" className={botao} onClick={() => aoAlterarItem(item.id, { modoMetragem: "AUTOMATICA", quantidadeTecido: metrosPedido(item.quantidade, item.consumoUnidade!), revisarMetragem: false })}>Restaurar cálculo</button>}</>}
                  {item.revisarMetragem && <div role="alert" className="space-y-2 text-xs text-amber-700"><p>Peças ou tamanho mudaram. Confira a metragem manual.</p><button type="button" className={botao} onClick={() => aoAlterarItem(item.id, { revisarMetragem: false })}>Confirmar metragem</button></div>}</>}
              </div>
            </div>
            {isProduto && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={item.corteLaser} onChange={e => aoAlterarItem(item.id, { corteLaser: e.target.checked })} /><span>Corte a laser<span className="block text-xs text-slate-500 sm:ml-2 sm:inline">Cobrado por metro</span></span></label>}

          </div>;
        })}</div>
        <div className="flex flex-wrap gap-2">
          {temEstampa && <button type="button" className={`${botao} inline-flex items-center gap-2`} disabled={itens.length >= limite || !base.modalidade} onClick={() => aoAdicionar(base, true)}><Plus className="h-5 w-5" aria-hidden="true" />Adicionar variante</button>}
          <button type="button" className={`${botao} inline-flex items-center gap-2`} aria-label={`Duplicar card ${indice + 1}`} disabled={itens.length + grupo.length > limite} onClick={() => props.aoDuplicarGrupo ? props.aoDuplicarGrupo(grupo) : aoAdicionar(base)}><Copy className="h-5 w-5" aria-hidden="true" />Duplicar</button>
        </div></>}

      </fieldset>;
    })}
    <div className="flex flex-wrap items-center gap-3"><button type="button" className={`${botao} bg-slate-900 text-white`} disabled={disabled || itens.length >= limite} onClick={() => aoAdicionar()}>Adicionar item</button><span role="status" className="text-xs text-slate-600">{itens.length} de {limite} itens{itens.length >= limite ? " · Limite atingido" : ""}</span></div>
  </div>;
}
