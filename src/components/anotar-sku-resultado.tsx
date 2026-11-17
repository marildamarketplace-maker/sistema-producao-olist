"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { linkPedidoOlist, paginaPedidosSkuSchema, type PaginaPedidosSku } from "@/lib/anotar-sku/pedidos";

type SkuResultado = { sku: string; tituloProduto: string | null; quantidade: number };
type CachePedidos = RefObject<Map<string, PaginaPedidosSku>>;
const botao = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function PedidosDoSku({ buscaId, item, token, cache }: { buscaId: string; item: SkuResultado; token: string; cache: CachePedidos }) {
  const [pagina, setPagina] = useState(() => cache.current.get(item.sku));
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
    const anterior = cache.current.get(item.sku);
    const parametros = new URLSearchParams({ sku: item.sku });
    if (anterior?.proximoCursor) parametros.set("cursor", anterior.proximoCursor);
    try {
      const resposta = await fetch(`/api/olist/anotar-sku/${encodeURIComponent(buscaId)}/pedidos?${parametros}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!resposta.ok) throw new Error(resposta.status === 401 ? "Sua sessão expirou. Entre novamente para continuar."
        : resposta.status === 403 ? "Você não tem permissão para visualizar estes pedidos."
        : resposta.status === 404 ? "Esta busca não está mais disponível. Atualize o histórico."
        : "Não foi possível carregar os pedidos. Tente novamente.");
      const recebida = paginaPedidosSkuSchema.parse(await resposta.json());
      if (controller.signal.aborted) return;
      const atualizada = { ...recebida, pedidos: [...(anterior?.pedidos ?? []), ...recebida.pedidos] };
      if (anterior || retomandoAposErro) proximoFoco.current = recebida.pedidos[0]?.id ?? anterior?.pedidos.at(-1)?.id ?? null;
      cache.current.set(item.sku, atualizada);
      setPagina(atualizada);
    } catch (falha) {
      if (!controller.signal.aborted) setErro(falha instanceof Error && falha.name === "Error" ? falha.message : "Não foi possível carregar os pedidos. Tente novamente.");
    } finally {
      if (requisicao.current === controller) {
        bloqueio.current = false;
        if (!controller.signal.aborted) setCarregando(false);
      }
    }
  }, [buscaId, item.sku, token, cache]);

  useEffect(() => {
    if (!cache.current.has(item.sku)) void carregar();
    return () => { requisicao.current?.abort(); bloqueio.current = false; };
  }, [carregar, cache, item.sku]);
  useEffect(() => {
    if (proximoFoco.current) links.current.get(proximoFoco.current)?.focus();
    proximoFoco.current = null;
  }, [pagina]);
  useEffect(() => { if (erro) tentarNovamente.current?.focus(); }, [erro]);

  return <section className="mt-4 space-y-4" aria-label={`Pedidos do SKU ${item.sku}`}>
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="break-words font-semibold text-slate-900">{item.sku}</h3>
      {item.tituloProduto && <p className="mt-1 break-words text-sm text-slate-600">{item.tituloProduto}</p>}
      <p className="mt-3 text-sm text-slate-700">Quantidade total na busca: <strong>{item.quantidade}</strong></p>
    </div>
    <p className="text-sm text-slate-600">Pedidos desta busca que contêm o SKU. Clique no ID para abrir na Olist em uma nova aba.</p>
    {Boolean(pagina?.pedidos.length) && <table className="w-full table-fixed text-left text-sm">
      <caption className="sr-only">IDs dos pedidos e quantidade deste SKU em cada pedido</caption>
      <thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="py-3 pr-3">ID do pedido</th><th scope="col" className="w-24 py-3 text-right">Quantidade</th></tr></thead>
      <tbody>{pagina?.pedidos.map(pedido => <tr key={pedido.id} className="border-b border-slate-100">
        <th scope="row" className="py-1 pr-3 font-medium"><a ref={elemento => { if (elemento) links.current.set(pedido.id, elemento); else links.current.delete(pedido.id); }} href={linkPedidoOlist(pedido.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md py-2 text-slate-900 underline underline-offset-4 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500" aria-label={`Abrir pedido ${pedido.id} na Olist (nova aba)`}>
          <span className="min-w-0 break-all">{pedido.id}</span><ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a></th><td className="py-3 text-right font-semibold text-slate-900">{pedido.quantidade}</td>
      </tr>)}</tbody>
    </table>}
    {pagina && <p role="status" className="text-sm text-slate-600">{pagina.pedidos.length === 0 ? "Nenhum pedido encontrado para este SKU nesta busca." : `${pagina.pedidos.length} pedido(s) exibido(s)${pagina.proximoCursor ? ". Há mais pedidos abaixo." : ". Todos os pedidos deste SKU foram carregados."}`}</p>}
    {erro && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{erro}</p><button ref={tentarNovamente} type="button" className={`${botao} mt-3`} onClick={() => void carregar()} disabled={carregando}>Tentar novamente</button></div>}
    {carregando && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Carregando pedidos…</p>}
    {pagina?.proximoCursor && !erro && <button type="button" className={`${botao} w-full sm:w-auto`} disabled={carregando} onClick={() => void carregar()}>{carregando ? "Carregando…" : "Carregar mais pedidos"}</button>}
  </section>;
}

/** O cache existe somente durante a abertura deste resultado, no escopo da sessão. */
export function AnotarSkuResultado({ buscaId, skus, token, children }: { buscaId: string; skus: SkuResultado[]; token: string; children?: ReactNode }) {
  const [selecionado, setSelecionado] = useState<SkuResultado | null>(null);
  const cache = useRef(new Map<string, PaginaPedidosSku>());
  const origem = useRef<HTMLButtonElement | null>(null);
  const voltar = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selecionado) voltar.current?.focus();
    else origem.current?.focus();
  }, [selecionado]);

  return <>
    <div hidden={Boolean(selecionado)}>
      {children}
      <div tabIndex={0} role="region" aria-label="Tabela de SKUs com rolagem horizontal" className="mt-4 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
        <table className="w-full text-left text-sm"><caption className="sr-only">Quantidades agrupadas por SKU</caption>
          <thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="px-3 py-3">SKU / pedidos</th><th scope="col" className="px-3 py-3">Produto</th><th scope="col" className="px-3 py-3 text-right">Quantidade</th></tr></thead>
          <tbody>{skus.map(item => <tr key={item.sku} className="border-b border-slate-100">
            <th scope="row" className="min-w-40 max-w-xs break-words px-3 py-3 font-medium text-slate-900"><span className="block break-all">{item.sku}</span>
              <button type="button" className={`${botao} mt-2 whitespace-nowrap`} aria-label={`Ver pedidos do SKU ${item.sku}`} onClick={event => { origem.current = event.currentTarget; setSelecionado(item); }}>Ver pedidos</button>
            </th><td className="min-w-40 break-words px-3 py-3 text-slate-600">{item.tituloProduto || "—"}</td><td className="px-3 py-3 text-right font-semibold text-slate-900">{item.quantidade}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    {selecionado && <div>
      <button ref={voltar} type="button" className={botao} onClick={() => setSelecionado(null)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Voltar aos SKUs</button>
      <PedidosDoSku key={selecionado.sku} buscaId={buscaId} item={selecionado} token={token} cache={cache} />
    </div>}
  </>;
}
