"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { PesquisaOlist, DadosComerciaisFilaOlist } from "@/components/dados-comerciais-fila-olist";
import { criarRascunhoFilaOlist, serializarRascunhoFilaOlist, type OpcaoFilaOlist } from "@/lib/fila-olist-contrato";
import { pedidoManualSchema, type ItemPedidoManual, type EntradaPedidoManual, type ComprovantePedidoManual } from "@/lib/pedido-manual-contrato";

const API = "/api/olist/pedidos/manuais";
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50";
const primario = `${botao} bg-slate-900 text-white`;
const etapas = ["Aplicativo", "Vendedor", "Cliente", "Itens", "Dados comerciais", "Revisão"];
const novoItem = (): ItemPedidoManual => ({ id: crypto.randomUUID(), tecidoNome: "", quantidade: 1, quantidadeTecido: 1,
  estampa: "", variante: null, tamanho: "", tipoProduto: "", corteLaser: false });

export function CriarPedidoManual({ token, usuarioId, podeGerenciarFila }: { token: string; usuarioId: string; podeGerenciarFila: boolean }) {
  const [aplicativos, setAplicativos] = useState<Array<{ id: string; nome: string }>>([]);
  const [aplicativoId, setAplicativoId] = useState("");
  const [etapa, setEtapa] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [contaPronta, setContaPronta] = useState(false);
  const [revisaoConta, setRevisaoConta] = useState(0);
  const [vendedorFixo, setVendedorFixo] = useState(false);
  const [vendedor, setVendedor] = useState<OpcaoFilaOlist | null>(null);
  const [cliente, setCliente] = useState<OpcaoFilaOlist | null>(null);
  const [itens, setItens] = useState<ItemPedidoManual[]>([]);
  const [observacao, setObservacao] = useState("");
  const [selecoes, setSelecoes] = useState(() => criarRascunhoFilaOlist([]));
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [comprovante, setComprovante] = useState<ComprovantePedidoManual | null>(null);
  const [tentativa, setTentativa] = useState<EntradaPedidoManual | null>(null);
  const [carregandoComprovante, setCarregandoComprovante] = useState(false);
  const ocupado = useRef(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const chave = useRef<string | null>(null);
  const contaInicializada = useRef("");
  const vendedorAtual = useRef<OpcaoFilaOlist | null>(null);
  const storageKey = `pedido-manual:${usuarioId}`;
  const api = `${API}?${new URLSearchParams({ aplicativoId })}`;

  useEffect(() => { vendedorAtual.current = vendedor; }, [vendedor]);
  useEffect(() => { titulo.current?.focus(); }, [etapa]);
  useEffect(() => { if (erro) alerta.current?.focus(); }, [erro]);
  useEffect(() => { if (comprovante) titulo.current?.focus(); }, [comprovante]);
  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    fetch(API, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!controller.signal.aborted) { setAplicativos(d.aplicativos); setAplicativoId(atual => atual || d.aplicativoPadraoId); } })
      .catch(e => { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar contas."); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    try {
      const salva = sessionStorage.getItem(storageKey);
      if (salva) { const parsed = pedidoManualSchema.safeParse(JSON.parse(salva)); if (parsed.success) setTentativa(parsed.data); }
    } catch { /* Sem armazenamento local, a chave ainda protege a sessão atual. */ }
    const id = new URLSearchParams(window.location.search).get("pedidoId");
    if (!id) return;
    const controller = new AbortController();
    setCarregandoComprovante(true);
    fetch(`${API}?${new URLSearchParams({ pedidoId: id })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!controller.signal.aborted) setComprovante(d); })
      .catch(e => { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao consultar comprovante."); })
      .finally(() => { if (!controller.signal.aborted) setCarregandoComprovante(false); });
    return () => controller.abort();
  }, [storageKey, token]);
  useEffect(() => {
    if (!aplicativoId) return;
    const controller = new AbortController();
    setContaPronta(false);
    fetch(api, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!controller.signal.aborted) {
        setVendedorFixo(d.vendedorFixo);
        const mudouVendedorFixo = d.vendedorFixo && vendedorAtual.current?.id !== d.vendedorId;
        if (contaInicializada.current !== aplicativoId || mudouVendedorFixo) {
          setVendedor(d.vendedorId ? { id: d.vendedorId, nome: `Vendedor vinculado · ID ${d.vendedorId}` } : null);
          if (mudouVendedorFixo) setCliente(null);
          setSelecoes(atual => ({ ...atual, vendedorId: d.vendedorId ?? 0,
            ...(mudouVendedorFixo ? { clienteId: 0 } : {}),
          }));
          contaInicializada.current = aplicativoId;
        }
        setContaPronta(true);
      } })
      .catch(e => { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar vendedor."); });
    return () => controller.abort();
  }, [api, aplicativoId, token, revisaoConta]);

  function trocarConta(id: string) {
    if (id === aplicativoId) return;
    contaInicializada.current = ""; setAplicativoId(id); setContaPronta(false); setVendedor(null); setCliente(null); setVendedorFixo(false);
    setSelecoes(criarRascunhoFilaOlist(itens.map(i => i.id))); chave.current = null; setErro("");
  }
  function alterarItem(id: string, patch: Partial<ItemPedidoManual>) {
    setItens(atuais => atuais.map(i => i.id === id ? { ...i, ...patch } : i));
    if (patch.tecidoNome !== undefined) setSelecoes(atuais => ({ ...atuais, tecidos: atuais.tecidos.map(t => t.tecidoId === id ? { ...t, id: 0, preco: null } : t) }));
  }
  function adicionar() {
    const item = novoItem(); setItens(atual => [...atual, item]);
    setSelecoes(atual => ({ ...atual, tecidos: [...atual.tecidos, { tecidoId: item.id, id: 0, preco: null }] }));
  }
  function avancar() {
    setErro("");
    if (etapa === 0 && !contaPronta) return;
    if (etapa === 1 && !vendedor?.id) { setErro("Selecione o vendedor."); return; }
    if (etapa === 2 && !cliente?.id) { setErro("Selecione o cliente."); return; }
    if (etapa >= 3) {
      try { montarEntrada(); } catch (e) { setErro(e instanceof Error ? e.message : "Revise os itens."); return; }
    }
    setEtapa(atual => atual + 1);
  }
  function montarEntrada(): EntradaPedidoManual {
    chave.current ??= crypto.randomUUID();
    const parsed = pedidoManualSchema.safeParse({ chaveIdempotencia: chave.current, aplicativoId, itens, observacao: observacao || null,
      selecoes: { ...serializarRascunhoFilaOlist(selecoes), vendedorId: vendedor?.id, clienteId: cliente?.id } });
    if (!parsed.success) throw new Error("Revise os itens: informe tecido, peças inteiras e metragem positiva; vendedor e cliente são obrigatórios.");
    return parsed.data;
  }
  async function enviar(entrada: EntradaPedidoManual) {
    if (ocupado.current) return;
    ocupado.current = true; setEnviando(true); setErro("");
    setTentativa(entrada);
    try { sessionStorage.setItem(storageKey, JSON.stringify(entrada)); } catch { /* A chave permanece em memória. */ }
    try {
      const response = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(entrada) });
      const d = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          // Uma tentativa recuperada após reload também devolve seus campos para correção.
          contaInicializada.current = entrada.aplicativoId; setAplicativoId(entrada.aplicativoId);
          setItens(entrada.itens); setObservacao(entrada.observacao ?? ""); setEtapa(5);
          setVendedor({ id: entrada.selecoes.vendedorId!, nome: `Vendedor · ID ${entrada.selecoes.vendedorId}` });
          setCliente({ id: entrada.selecoes.clienteId!, nome: `Cliente · ID ${entrada.selecoes.clienteId}` });
          setSelecoes(criarRascunhoFilaOlist(entrada.itens.map(i => i.id), entrada.selecoes));
          setTentativa(null); try { sessionStorage.removeItem(storageKey); } catch { /* opcional */ }
          if (response.status === 403 || response.status === 409) {
            setContaPronta(false); setRevisaoConta(atual => atual + 1); setEtapa(0);
          }
        }
        throw new Error(d.error || "Falha ao registrar pedido.");
      }
      setComprovante(d); setTentativa(null);
      try { sessionStorage.removeItem(storageKey); } catch { /* opcional */ }
      window.history.replaceState(null, "", `${window.location.pathname}?pedidoId=${encodeURIComponent(d.id)}`);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível confirmar o aceite. Tente novamente com a mesma confirmação."); }
    finally { ocupado.current = false; setEnviando(false); }
  }
  function novoPedido() {
    window.history.replaceState(null, "", window.location.pathname); setComprovante(null); setTentativa(null);
    setItens([]); setCliente(null); setObservacao(""); setSelecoes(criarRascunhoFilaOlist([], undefined, vendedor?.id)); chave.current = null; setEtapa(0); setErro("");
  }
  return <div className="min-w-0 space-y-4">
    <PageHeader title="Criar pedido na fila" description="Monte um pedido manual para revisão e envio posterior à Olist." />
    {erro && <p ref={alerta} tabIndex={-1} role="alert" className="break-words rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700">{erro}</p>}
    {carregando || carregandoComprovante ? <p role="status">Carregando...</p> : comprovante ? <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" aria-label="Comprovante do pedido">
      <h3 tabIndex={-1} ref={titulo} className="text-lg font-semibold">Pedido registrado na fila</h3>
      <p role="status">Status: <strong>{comprovante.status}</strong>. O enfileiramento não confirma a criação na Olist.</p>
      <p className="break-all text-sm">Protocolo: {comprovante.id}</p><p className="break-words text-sm">Aplicativo destinatário: {comprovante.aplicativo?.nome ?? "Não selecionado"}</p>
      <div className="flex flex-wrap gap-3">{podeGerenciarFila && <Link className={primario} href="/fornecedor/fila-pedidos">Abrir fila de pedidos</Link>}<button className={botao} type="button" onClick={novoPedido}>Criar outro pedido</button></div>
    </section> : tentativa ? <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-semibold">Confirmar resultado do envio para a fila</h3><p className="text-sm">Há uma confirmação pendente nesta sessão. Consulte novamente com os mesmos dados para evitar duplicidade.</p>
      <button type="button" className={primario} disabled={enviando} onClick={() => void enviar(tentativa)}>{enviando ? "Confirmando..." : "Confirmar resultado"}</button>
    </section> : <>
      <ol aria-label="Etapas da criação" className="flex flex-wrap gap-2 text-xs">{etapas.map((nome, index) => <li key={nome} aria-current={index === etapa ? "step" : undefined} className={`rounded-md border border-slate-200 px-3 py-2 ${index === etapa ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>{index + 1}. {nome}</li>)}</ol>
      <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-busy={enviando}>
        <h3 ref={titulo} tabIndex={-1} className="text-lg font-semibold">{etapas[etapa]}</h3>
        {etapa === 0 && <><label className="block text-sm">Aplicativo destinatário<select className="input mt-1 min-h-11" value={aplicativoId} onChange={e => trocarConta(e.target.value)}>{aplicativos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></label>{!contaPronta && !erro && <p role="status" className="text-sm">Consultando vendedor da conta...</p>}<p className="text-sm text-slate-600">O pedido entrará na fila própria, com a conta selecionada como destinatária.</p><button type="button" className={botao} onClick={() => { setContaPronta(false); setRevisaoConta(atual => atual + 1); }}>Atualizar conta</button></>}
        {etapa === 1 && (vendedorFixo ? <p className="text-sm">Vendedor fixo do usuário: <strong>{vendedor?.nome}</strong></p> : <PesquisaOlist key={api} titulo="Vendedor" recurso="vendedores" api={api} token={token} valor={vendedor?.id ?? 0} disabled={!contaPronta} aoSelecionar={o => { setVendedor(o); setCliente(null); setSelecoes(s => ({ ...s, vendedorId: o.id, clienteId: 0 })); }} />)}
        {etapa === 2 && <><PesquisaOlist key={`${api}:${vendedor?.id}`} titulo="Cliente" recurso="clientes" api={api} token={token} valor={cliente?.id ?? 0} disabled={!contaPronta} aoSelecionar={o => { setCliente(o); setSelecoes(s => ({ ...s, clienteId: o.id })); }} />{vendedorFixo && <p className="text-sm text-slate-600">Somente clientes da carteira do seu vendedor são exibidos.</p>}</>}
        {etapa === 3 && <>
          {itens.map((item, index) => <fieldset key={item.id} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold">Item {index + 1}</legend><div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="text-sm">Tecido<input className="input mt-1 min-h-11" maxLength={500} value={item.tecidoNome} onChange={e => alterarItem(item.id, { tecidoNome: e.target.value })} /></label>
              <label className="text-sm">Quantidade de peças (UN)<input className="input mt-1 min-h-11" type="number" min={1} step={1} value={item.quantidade || ""} onChange={e => alterarItem(item.id, { quantidade: Number(e.target.value) })} /></label>
              <label className="text-sm">Quantidade de tecido (MT)<input className="input mt-1 min-h-11" type="number" min={0.000001} step="0.000001" value={item.quantidadeTecido || ""} onChange={e => alterarItem(item.id, { quantidadeTecido: Number(e.target.value) })} /></label>
              <label className="text-sm">Estampa<input className="input mt-1 min-h-11" maxLength={500} value={item.estampa} onChange={e => alterarItem(item.id, { estampa: e.target.value })} /></label>
              <label className="text-sm">Variante (opcional)<input className="input mt-1 min-h-11" maxLength={500} value={item.variante ?? ""} onChange={e => alterarItem(item.id, { variante: e.target.value || null })} /></label>
              <label className="text-sm">Tamanho<input className="input mt-1 min-h-11" maxLength={500} value={item.tamanho} onChange={e => alterarItem(item.id, { tamanho: e.target.value })} /></label>
              <label className="text-sm">Tipo de produto<input className="input mt-1 min-h-11" maxLength={500} value={item.tipoProduto} onChange={e => alterarItem(item.id, { tipoProduto: e.target.value })} /></label>
              <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={item.corteLaser} onChange={e => alterarItem(item.id, { corteLaser: e.target.checked })} />Corte a laser</label>
            </div><button type="button" className={botao} onClick={() => { setItens(atuais => atuais.filter(i => i.id !== item.id)); setSelecoes(s => ({ ...s, tecidos: s.tecidos.filter(t => t.tecidoId !== item.id) })); }}>Remover item {index + 1}</button>
          </fieldset>)}
          <button type="button" className={botao} disabled={itens.length >= 100} onClick={adicionar}>Adicionar item</button>
        </>}
        {etapa === 4 && <><p className="text-sm text-slate-600">Opcional nesta etapa. As associações e preços serão conferidos antes de criar o pedido na Olist.</p><DadosComerciaisFilaOlist key={api} api={api} token={token} itens={itens.map(i => ({ tecidoId: i.id, nome: i.tecidoNome, corteLaser: i.corteLaser }))} selecoes={selecoes} aoAlterar={setSelecoes} disabled={enviando} ocultarClienteVendedor />
          <label className="block text-sm">Observação do pedido<textarea className="input mt-1 min-h-24" maxLength={5000} value={observacao} onChange={e => setObservacao(e.target.value)} /></label></>}
        {etapa === 5 && <><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt>Aplicativo</dt><dd className="break-words font-medium">{aplicativos.find(a => a.id === aplicativoId)?.nome}</dd></div><div><dt>Vendedor</dt><dd className="break-words font-medium">{vendedor?.nome}</dd></div><div><dt>Cliente</dt><dd className="break-words font-medium">{cliente?.nome}</dd></div><div><dt>Status ao enviar</dt><dd>PENDENTE</dd></div></dl>
          {itens.map((i, index) => { const produto = selecoes.tecidos.find(t => t.tecidoId === i.id); return <div key={i.id} className="space-y-1 rounded-md border border-slate-200 p-3 text-sm"><p className="break-words font-semibold">Item {index + 1}: {i.tecidoNome}</p><p>{i.quantidade.toLocaleString("pt-BR")} peças · {i.quantidadeTecido.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} m · Laser: {i.corteLaser ? "Sim" : "Não"}</p><p className="break-words">Estampa: {i.estampa || "—"} · Variante: {i.variante || "—"} · Tamanho: {i.tamanho || "—"} · Tipo: {i.tipoProduto || "—"}</p><p>Produto Olist: {produto?.id || "Pendente"} · Preço/m: {produto?.preco == null ? "Pendente" : `R$ ${produto.preco.toFixed(2)}`}</p></div>; })}
          <p className="text-sm">Forma: {selecoes.formaId ? "Selecionada" : "Pendente"} · Plano: {selecoes.planoId ? "Selecionado" : "Pendente"} · Tipo de venda: {selecoes.tipoVenda || "Pendente"}</p><p className="whitespace-pre-wrap break-words text-sm">{observacao || "Sem observação."}</p><p className="text-sm text-slate-600">A confirmação registra o pedido na fila. Um administrador revisará os dados antes do envio à Olist.</p></>}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-between">
          <button type="button" className={botao} disabled={etapa === 0 || enviando} onClick={() => { setErro(""); setEtapa(e => e - 1); }}>Voltar</button>
          {etapa < 5 ? <button type="button" className={primario} disabled={!contaPronta} onClick={avancar}>Continuar</button> : <button type="button" className={primario} disabled={enviando || !contaPronta} onClick={() => { try { if (contaPronta) void enviar(montarEntrada()); } catch (e) { setErro(e instanceof Error ? e.message : "Revise o pedido."); } }}>Enviar para fila</button>}
        </div>
      </section>
    </>}
  </div>;
}
