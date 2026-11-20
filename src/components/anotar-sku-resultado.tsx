"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { linkPedidoOlist, paginaPedidosSkuSchema, paginaForaPeriodoSkuSchema, type PaginaPedidosSku, type PaginaForaPeriodoSku } from "@/lib/anotar-sku/pedidos";
import { descreverPeriodoSku, formatarDiaSku } from "@/lib/anotar-sku/periodo";
import { TabelaSkus } from "@/components/tabela-skus";
import { alternarOrdenacaoSku, ordenarSkus, ORDENACAO_SKU_PADRAO } from "@/lib/anotar-sku/ordenacao";

type SkuResultado = { sku: string; tituloProduto: string | null; quantidade: number };
type PaginaConferencia = { pedidos: (PaginaPedidosSku["pedidos"][number] | PaginaForaPeriodoSku["pedidos"][number])[]; proximoCursor: string | null };
type CachePedidos = RefObject<Map<string, PaginaConferencia>>;
const botao = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function PedidosDoResultado({ buscaId, item, token, cache, totalForaPeriodo }: { buscaId: string; item: SkuResultado | null; token: string; cache: CachePedidos; totalForaPeriodo: number }) {
  const sku = item?.sku ?? null;
  const chaveCache = JSON.stringify(sku);
  const [pagina, setPagina] = useState(() => cache.current.get(chaveCache));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const requisicao = useRef<AbortController | null>(null);
  const bloqueio = useRef(false);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const proximoFoco = useRef<string | null>(null);
  const tentarNovamente = useRef<HTMLButtonElement | null>(null);
  const carregar = useCallback(async () => {
    if (bloqueio.current) return;
    bloqueio.current = true;
    const controller = new AbortController();
    requisicao.current = controller;
    const retomandoAposErro = Boolean(tentarNovamente.current);
    setCarregando(true);
    setErro(null);
    const anterior = cache.current.get(chaveCache);
    const parametros = new URLSearchParams(sku === null ? {} : { sku });
    if (anterior?.proximoCursor) parametros.set("cursor", anterior.proximoCursor);
    try {
      const resposta = await fetch(`/api/olist/anotar-sku/${encodeURIComponent(buscaId)}/${sku === null ? "fora-periodo" : "pedidos"}?${parametros}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!resposta.ok) throw new Error(resposta.status === 401 ? "Sua sessão expirou. Entre novamente para continuar."
        : resposta.status === 403 ? "Você não tem permissão para visualizar estes pedidos."
        : resposta.status === 404 ? "Esta busca não está mais disponível. Atualize o histórico."
        : "Não foi possível carregar os pedidos. Tente novamente.");
      const recebida = (sku === null ? paginaForaPeriodoSkuSchema : paginaPedidosSkuSchema).parse(await resposta.json());
      if (controller.signal.aborted) return;
      const atualizada = { ...recebida, pedidos: [...(anterior?.pedidos ?? []), ...recebida.pedidos] };
      if (anterior || retomandoAposErro) proximoFoco.current = recebida.pedidos[0]?.id ?? anterior?.pedidos.at(-1)?.id ?? null;
      cache.current.set(chaveCache, atualizada);
      setPagina(atualizada);
    } catch (falha) {
      if (!controller.signal.aborted) setErro(falha instanceof Error && falha.name === "Error" ? falha.message : "Não foi possível carregar os pedidos. Tente novamente.");
    } finally {
      if (requisicao.current === controller) {
        bloqueio.current = false;
        if (!controller.signal.aborted) setCarregando(false);
      }
    }
  }, [buscaId, sku, token, cache, chaveCache]);

  useEffect(() => {
    if (!cache.current.has(chaveCache)) void carregar();
    return () => { requisicao.current?.abort(); bloqueio.current = false; };
  }, [carregar, cache, chaveCache]);
  useEffect(() => {
    if (proximoFoco.current) links.current.get(proximoFoco.current)?.focus();
    proximoFoco.current = null;
  }, [pagina]);
  useEffect(() => { if (erro) tentarNovamente.current?.focus(); }, [erro]);

  return <section className="mt-4 space-y-4" aria-label={item ? `Pedidos do SKU ${item.sku}` : "Pedidos fora do período"}>
    {item ? <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="break-words font-semibold text-slate-900">{item.sku}</h3>
      {item.tituloProduto && <p className="mt-1 break-words text-sm text-slate-600">{item.tituloProduto}</p>}
      <p className="mt-3 text-sm text-slate-700">Quantidade total na busca: <strong>{item.quantidade}</strong></p>
    </div> : <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-800"><h3 className="font-semibold">{totalForaPeriodo} pedido(s) fora do período</h3><p className="mt-1 text-sm">Encontrados nas situações selecionadas, mas excluídos das quantidades de SKUs e dos arquivos exportados.</p></div>}
    <p className="text-sm text-slate-600">{item ? "Pedidos desta busca que contêm o SKU. " : "Confira a data de criação de cada pedido. "}Clique no ID para abrir na Olist em uma nova aba.</p>
    {Boolean(pagina?.pedidos.length) && <table className="w-full table-fixed text-left text-sm">
      <caption className="sr-only">{item ? "IDs dos pedidos e quantidade deste SKU em cada pedido" : "IDs e datas de criação dos pedidos fora do período"}</caption>
      <thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="py-3 pr-3">ID do pedido</th><th scope="col" className="w-24 py-3 text-right">{item ? "Quantidade" : "Criado em"}</th></tr></thead>
      <tbody>{pagina?.pedidos.map(pedido => <tr key={pedido.id} className="border-b border-slate-100">
        <th scope="row" className="py-1 pr-3 font-medium"><a ref={elemento => { if (elemento) links.current.set(pedido.id, elemento); else links.current.delete(pedido.id); }} href={linkPedidoOlist(pedido.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md py-2 text-slate-900 underline underline-offset-4 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500" aria-label={`Abrir pedido ${pedido.id} na Olist (nova aba)`}>
          <span className="min-w-0 break-all">{pedido.id}</span><ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a></th><td className="py-3 text-right font-semibold text-slate-900">{"quantidade" in pedido ? pedido.quantidade : pedido.dataCriacao ? formatarDiaSku(pedido.dataCriacao) : "—"}</td>
      </tr>)}</tbody>
    </table>}
    {pagina && <p role="status" className="text-sm text-slate-600">{pagina.pedidos.length === 0 ? "Nenhum pedido encontrado nesta lista." : `${pagina.pedidos.length} pedido(s) exibido(s)${pagina.proximoCursor ? ". Há mais pedidos abaixo." : ". Todos os pedidos desta lista foram carregados."}`}</p>}
    {erro && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{erro}</p><button ref={tentarNovamente} type="button" className={`${botao} mt-3`} onClick={() => void carregar()} disabled={carregando}>Tentar novamente</button></div>}
    {carregando && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Carregando pedidos…</p>}
    {pagina?.proximoCursor && !erro && <button type="button" className={`${botao} w-full sm:w-auto`} disabled={carregando} onClick={() => void carregar()}>{carregando ? "Carregando…" : "Carregar mais pedidos"}</button>}
  </section>;
}

/** O cache existe somente durante a abertura deste resultado, no escopo da sessão. */
export function AnotarSkuResultado({ buscaId, skus, token, children, pedidosForaPeriodo = 0, periodoInicio, periodoFim }: { buscaId: string; skus: SkuResultado[]; token: string; children?: ReactNode; pedidosForaPeriodo?: number; periodoInicio?: string | null; periodoFim?: string | null }) {
  const [selecionado, setSelecionado] = useState<SkuResultado | "fora-periodo" | null>(null);
  const [ordem, setOrdem] = useState(ORDENACAO_SKU_PADRAO);
  const linhas = useMemo(() => ordenarSkus(skus.map(item => ({ ...item, produto: item.tituloProduto })), ordem), [skus, ordem]);
  const cache = useRef(new Map<string, PaginaConferencia>());
  const origem = useRef<HTMLButtonElement | null>(null);
  const voltar = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selecionado) voltar.current?.focus();
    else origem.current?.focus();
  }, [selecionado]);

  return <>
    <div hidden={Boolean(selecionado)}>
      {children}
      <p className="mt-3 text-sm text-slate-600">{descreverPeriodoSku(periodoInicio, periodoFim)}</p>
      {pedidosForaPeriodo > 0 && <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-800">
        <p className="flex items-start gap-2 font-medium"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />{pedidosForaPeriodo} pedido(s) fora do período</p>
        <p className="mt-2 text-sm">Não foram somados aos SKUs nem incluídos nos arquivos. Confira os IDs e as datas de criação.</p>
        <button type="button" className={`${botao} mt-3 w-full sm:w-auto`} onClick={event => { origem.current = event.currentTarget; setSelecionado("fora-periodo"); }}>Ver pedidos fora do período</button>
      </div>}
      {skus.length === 0 ? <p role="status" className="mt-4 rounded-md border border-slate-200 p-4 text-sm text-slate-600">Nenhum SKU novo no período selecionado.{pedidosForaPeriodo > 0 && " Os pedidos fora do período estão disponíveis no alerta acima."}</p> : <div className="mt-4">
        <TabelaSkus nome="Tabela de SKUs" itens={linhas} ordem={ordem} ordenar={coluna => setOrdem(atual => alternarOrdenacaoSku(atual, coluna))} verPedidos={(item, botao) => { origem.current = botao; setSelecionado(item); }} />
      </div>}
    </div>
    {selecionado && <div>
      <button ref={voltar} type="button" className={botao} onClick={() => setSelecionado(null)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Voltar ao resultado</button>
      {selecionado === "fora-periodo" && <p className="mt-3 text-sm text-slate-600">{descreverPeriodoSku(periodoInicio, periodoFim)}</p>}
      <PedidosDoResultado key={JSON.stringify(selecionado)} buscaId={buscaId} item={selecionado === "fora-periodo" ? null : selecionado} token={token} cache={cache} totalForaPeriodo={pedidosForaPeriodo} />
    </div>}
  </>;
}
