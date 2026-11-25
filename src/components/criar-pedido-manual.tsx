"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BloqueioExplicado } from "@/components/bloqueio-explicado";
import { useCatalogoTecidosOlist } from "@/hooks/use-catalogo-tecidos-olist";
import { ItensPedidoEditor } from "@/components/itens-pedido-editor";
import { pedidoProducaoSchema, origemPedidoProducaoSchema, type EntradaPedidoProducao } from "@/lib/pedido-producao-contrato";
import { PageHeader } from "@/components/page-header";
import { PesquisaOlist, DadosComerciaisFilaOlist } from "@/components/dados-comerciais-fila-olist";
import { criarRascunhoFilaOlist, serializarRascunhoFilaOlist, type OpcaoFilaOlist } from "@/lib/fila-olist-contrato";
import { pedidoManualSchema, pedidoManualLegadoSchema, resolucaoPedidoManualSchema, comprovantePedidoManualSchema, chavePedidoManualSchema, type ItemPedidoManual, type EntradaPedidoManual, type EntradaPedidoManualLegada, type ResolucaoPedidoManual, type ComprovantePedidoManual } from "@/lib/pedido-manual-contrato";

const API = "/api/olist/pedidos/manuais";
const resolucaoConsultaSchema = resolucaoPedidoManualSchema.safeExtend({ contextoConsulta: z.string().min(1).max(4096).optional() });
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50";
const primario = `${botao} bg-slate-900 text-white`;
const etapas = ["Vendedor", "Cliente", "Aplicativo", "Itens", "Dados comerciais", "Revisão"];
const novoItem = (): ItemPedidoManual => ({ id: crypto.randomUUID(), tecidoNome: "", quantidade: 1, quantidadeTecido: 1,
  estampa: "", variante: null, tamanho: "", tipoProduto: "", corteLaser: false });
type EntradaPedido = EntradaPedidoManual | EntradaPedidoManualLegada | EntradaPedidoProducao;
type AplicativoReferenciaManual = { id: string; nome: string; fornecedorId?: string; bloqueio?: string | null; vendedorId?: number | null };

export function CriarPedidoManual({ token, usuarioId, podeGerenciarFila, solicitacaoId }: { token: string; usuarioId: string; podeGerenciarFila: boolean; solicitacaoId?: string }) {
  const apiBase = solicitacaoId ? `/api/olist/pedidos/producao?${new URLSearchParams({ solicitacaoId })}` : API;
  const separador = solicitacaoId ? "&" : "?";
  const limite = solicitacaoId ? 1000 : 100;
  const [revisaoProducao, setRevisaoProducao] = useState("");
  const [carregandoOrigem, setCarregandoOrigem] = useState(false);
  const [recarregarOrigem, setRecarregarOrigem] = useState(0);
  const origemCarregada = useRef(false);
  const origemConsulta = useRef("");
  const fonteProducao = useRef("");
  const substituirOrigem = useRef(false);
  const [aplicativos, setAplicativos] = useState<AplicativoReferenciaManual[]>([]);
  const [aplicativoId, setAplicativoId] = useState("");
  const [referenciaId, setReferenciaId] = useState("");
  const [resolucao, setResolucao] = useState<ResolucaoPedidoManual | null>(null);
  const [contextoConsulta, setContextoConsulta] = useState("");
  const [resolvendo, setResolvendo] = useState(false);
  const [erroResolucao, setErroResolucao] = useState("");
  const [revisaoResolucao, setRevisaoResolucao] = useState(0);
  const [etapa, setEtapa] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [contaPronta, setContaPronta] = useState(false);
  const [revisaoConta, setRevisaoConta] = useState(0);
  const [revisaoLista, setRevisaoLista] = useState(0);
  const [vendedorFixo, setVendedorFixo] = useState(false);
  const [vendedor, setVendedor] = useState<OpcaoFilaOlist | null>(null);
  const [cliente, setCliente] = useState<OpcaoFilaOlist | null>(null);
  const [itens, setItens] = useState<ItemPedidoManual[]>([]);
  const [observacao, setObservacao] = useState("");
  const [selecoes, setSelecoes] = useState(() => criarRascunhoFilaOlist([]));
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [comprovante, setComprovante] = useState<ComprovantePedidoManual | null>(null);
  const [tentativa, setTentativa] = useState<EntradaPedido | null>(null);
  const [carregandoComprovante, setCarregandoComprovante] = useState(false);
  const ocupado = useRef(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const chave = useRef<string | null>(null);
  const contaInicializada = useRef("");
  const vendedorAtual = useRef<OpcaoFilaOlist | null>(null);
  const destinoAtual = useRef("");
  const storageKey = solicitacaoId ? `pedido-producao:${usuarioId}:${solicitacaoId}` : `pedido-manual:${usuarioId}`;
  const storageChaveKey = `${storageKey}:chave`;
  const storageFonteKey = `${storageKey}:fonte`;
  const api = `${apiBase}${separador}${new URLSearchParams({ aplicativoId, ...(solicitacaoId && contextoConsulta ? { contextoConsulta } : {}), ...(solicitacaoId && referenciaId ? { aplicativoOrigemId: referenciaId, vendedorOrigemId: String(vendedor?.id ?? 0), clienteOrigemId: String(cliente?.id ?? 0) } : {}) })}`;
  const apiOrigem = `${apiBase}${separador}${new URLSearchParams({ aplicativoId: referenciaId })}`;
  const nomeAplicativoDestino = resolucao?.aplicativoDestino?.nome ?? aplicativos.find(a => a.id === aplicativoId)?.nome ?? (aplicativoId || "Não selecionado");
  const catalogoTecidos = useCatalogoTecidosOlist({ api: aplicativoId ? api : null, token, usuarioId,
    ativo: Boolean(contaPronta && resolucao && aplicativoId && !comprovante && !tentativa) });

  useEffect(() => { vendedorAtual.current = vendedor; }, [vendedor]);
  useEffect(() => { titulo.current?.focus(); }, [etapa]);
  useEffect(() => { if (erro) alerta.current?.focus(); }, [erro]);
  useEffect(() => { if (comprovante) titulo.current?.focus(); }, [comprovante]);
  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    fetch(apiBase, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!controller.signal.aborted) {
        // As demais contas próprias podem ser destinos, mas só a referência canônica pode iniciar o pedido.
        const referencias: AplicativoReferenciaManual[] = d.aplicativos.filter((a: AplicativoReferenciaManual) =>
          a.id === d.aplicativoPadraoId || Boolean(a.fornecedorId));
        setAplicativos(referencias);
        const padrao = referencias.find(a => a.id === d.aplicativoPadraoId && !a.bloqueio)?.id ?? referencias.find(a => !a.bloqueio)?.id ?? "";
        setReferenciaId(atual => referencias.some(a => a.id === atual && a.fornecedorId && !a.bloqueio) ? atual : padrao);
        setRevisaoConta(r => r + 1);
      } })
      .catch(e => { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar contas."); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [token, revisaoLista, apiBase]);
  useEffect(() => {
    try {
      const salvaChave = chavePedidoManualSchema.safeParse(sessionStorage.getItem(storageChaveKey));
      if (salvaChave.success) chave.current = salvaChave.data;
      const salva = sessionStorage.getItem(storageKey);
      if (salva) { const valor: unknown = JSON.parse(salva); const parsed = solicitacaoId ? pedidoProducaoSchema.safeParse(valor) : pedidoManualSchema.safeParse(valor); const legado = !solicitacaoId ? pedidoManualLegadoSchema.safeParse(valor) : null; const entrada = parsed.success ? parsed.data : legado?.success ? legado.data : null; if (entrada) {
        setTentativa(entrada); chave.current = entrada.chaveIdempotencia;
        const producao = pedidoProducaoSchema.safeParse(entrada);
        if (producao.success) { setRevisaoProducao(producao.data.revisaoProducao); origemConsulta.current = `${producao.data.origemManual.aplicativoId}:0`; origemCarregada.current = true; fonteProducao.current = sessionStorage.getItem(storageFonteKey) ?? ""; }
      } }
    } catch { /* Sem armazenamento local, a chave ainda protege a sessão atual. */ }
    const id = new URLSearchParams(window.location.search).get("pedidoId");
    if (!id) return;
    const controller = new AbortController();
    setCarregandoComprovante(true);
    fetch(`${apiBase}${separador}${new URLSearchParams({ pedidoId: id })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!controller.signal.aborted) setComprovante(d); })
      .catch(e => { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao consultar comprovante."); })
      .finally(() => { if (!controller.signal.aborted) setCarregandoComprovante(false); });
    return () => controller.abort();
  }, [storageKey, storageChaveKey, storageFonteKey, token, apiBase, separador, solicitacaoId]);
  useEffect(() => {
    if (!referenciaId) return;
    const controller = new AbortController();
    setContaPronta(false);
    fetch(apiOrigem, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!controller.signal.aborted) {
        setVendedorFixo(d.vendedorFixo);
        const mudouVendedorFixo = d.vendedorFixo && vendedorAtual.current?.id !== d.vendedorId;
        const mudouReferencia = contaInicializada.current !== referenciaId;
        if (mudouReferencia || mudouVendedorFixo) {
          setVendedor(d.vendedorId ? { id: d.vendedorId, nome: `Vendedor vinculado · ID ${d.vendedorId}` } : null);
          setCliente(null); setAplicativoId(""); destinoAtual.current = ""; setErroResolucao("");
          setSelecoes(atual => criarRascunhoFilaOlist(atual.tecidos.map(t => t.tecidoId)));
          if (mudouReferencia) setEtapa(0);
          contaInicializada.current = referenciaId;
          setResolucao(null); setContextoConsulta("");
        }
        setContaPronta(true);
      } })
      .catch(e => { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar vendedor."); });
    return () => controller.abort();
  }, [apiOrigem, referenciaId, token, revisaoConta]);

  useEffect(() => {
    if (!contaPronta || !vendedor?.id || !cliente?.id || tentativa || comprovante) return;
    const controller = new AbortController();
    setResolucao(null); setContextoConsulta(""); setResolvendo(true); setErro(""); setErroResolucao("");
    const params = new URLSearchParams({ acao: "resolver", aplicativoOrigemId: referenciaId, vendedorOrigemId: String(vendedor.id), clienteOrigemId: String(cliente.id) });
    fetch(`${apiBase}${separador}${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Não foi possível definir o aplicativo."); const parsed = resolucaoConsultaSchema.safeParse(d); if (!parsed.success) throw new Error("Resposta de direcionamento inválida. Atualize e tente novamente."); return { resolucao: parsed.data, contexto: typeof d.contextoConsulta === "string" && d.contextoConsulta.length <= 4096 ? d.contextoConsulta : "" }; })
      .then(({ resolucao: d, contexto }) => { if (!controller.signal.aborted) {
        setContextoConsulta(contexto);
        const mudouDestino = Boolean(destinoAtual.current && destinoAtual.current !== d.decisao.aplicativoId);
        destinoAtual.current = d.decisao.aplicativoId;
        setAplicativoId(d.decisao.aplicativoId); setResolucao(d);
        setSelecoes(atual => ({ ...(mudouDestino ? criarRascunhoFilaOlist(atual.tecidos.map(t => t.tecidoId)) : atual), vendedorId: d.selecoes.vendedorId, clienteId: d.selecoes.clienteId }));
      } })
      .catch(e => { if (!controller.signal.aborted) { const mensagem = e instanceof Error ? e.message : "Falha ao resolver o destino."; setErro(mensagem); setErroResolucao(mensagem); } })
      .finally(() => { if (!controller.signal.aborted) setResolvendo(false); });
    return () => controller.abort();
  }, [contaPronta, vendedor?.id, cliente?.id, referenciaId, token, revisaoResolucao, tentativa, comprovante, apiBase, separador]);

  useEffect(() => {
    if (!solicitacaoId || !referenciaId || tentativa || comprovante) return;
    const consulta = `${referenciaId}:${recarregarOrigem}`;
    if (origemConsulta.current === consulta) return;
    const controller = new AbortController();
    setCarregandoOrigem(true); setRevisaoProducao("");
    fetch(`${apiBase}&${new URLSearchParams({ acao: "origem", aplicativoId: referenciaId })}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store",
    }).then(async response => {
      const dados: unknown = await response.json();
      if (!response.ok) throw new Error(typeof dados === "object" && dados && "error" in dados ? String(dados.error) : "Não foi possível carregar os produtos da produção.");
      return origemPedidoProducaoSchema.parse(dados);
    }).then(origem => {
      if (controller.signal.aborted) return;
      if (fonteProducao.current && fonteProducao.current !== origem.revisaoFonte && !substituirOrigem.current) {
        setErro("A solicitação de produção mudou. Suas edições foram preservadas. Revise a origem antes de continuar.");
        return;
      }
      fonteProducao.current = origem.revisaoFonte;
      if (!origemCarregada.current || substituirOrigem.current) {
        setItens(origem.itens); setObservacao(origem.observacao ?? "");
        setSelecoes(atual => ({ ...criarRascunhoFilaOlist(origem.itens.map(item => item.id)), vendedorId: atual.vendedorId, clienteId: atual.clienteId }));
        origemCarregada.current = true; substituirOrigem.current = false;
      }
      origemConsulta.current = consulta;
      setRevisaoProducao(origem.revisao);
    }).catch(error => {
      if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Falha ao carregar a produção.");
    }).finally(() => { if (!controller.signal.aborted) setCarregandoOrigem(false); });
    return () => controller.abort();
  }, [solicitacaoId, referenciaId, apiBase, token, recarregarOrigem, tentativa, comprovante]);

  function invalidarDestino() {
    setResolucao(null); setContextoConsulta(""); setAplicativoId(""); setErroResolucao(""); destinoAtual.current = "";
    setSelecoes(criarRascunhoFilaOlist(itens.map(i => i.id)));
  }
  function selecionarReferencia(id: string) {
    if (id === referenciaId || ocupado.current || aplicativos.find(a => a.id === id)?.bloqueio) return;
    setContaPronta(false); setVendedor(null); setCliente(null); setErro(""); setEtapa(0);
    invalidarDestino(); setReferenciaId(id);
  }
  function alterarItem(id: string, patch: Partial<ItemPedidoManual>) {
    setItens(atuais => atuais.map(i => i.id === id ? { ...i, ...patch } : i));
    if (patch.tecidoNome !== undefined) setSelecoes(atuais => ({ ...atuais, tecidos: atuais.tecidos.map(t => t.tecidoId === id ? { ...t, id: 0, preco: null } : t) }));
  }
  function alterarSelecoesComerciais(novas: typeof selecoes) {
    const anteriores = new Map(selecoes.tecidos.map(tecido => [tecido.tecidoId, tecido.id]));
    const nomes = new Map<string, string>();
    for (const tecido of novas.tecidos) {
      if (!tecido.id || anteriores.get(tecido.tecidoId) === tecido.id) continue;
      const produto = catalogoTecidos.itens.find(item => item.id === tecido.id);
      if (produto) nomes.set(tecido.tecidoId, produto.nome);
    }
    // A escolha comercial muda apenas os itens deste pedido, preservando a produção.
    if (nomes.size) setItens(atuais => atuais.map(item => {
      const nome = nomes.get(item.id);
      return nome !== undefined ? { ...item, tecidoNome: nome } : item;
    }));
    setSelecoes(novas);
  }
  function adicionar() {
    if (itens.length >= limite) return;
    const item = novoItem(); setItens(atual => [...atual, item]);
    setSelecoes(atual => ({ ...atual, tecidos: [...atual.tecidos, { tecidoId: item.id, id: 0, preco: null }] }));
  }
  function avancar() {
    setErro("");
    if (etapa === 0 && !vendedor?.id) { setErro("Selecione o vendedor."); return; }
    if (etapa === 1 && !cliente?.id) { setErro("Selecione o cliente."); return; }
    if (etapa === 2 && !resolucao) { setErro("Aguarde ou atualize a resolução do aplicativo."); return; }
    if (etapa >= 3) {
      try { montarEntrada(); } catch (e) { setErro(e instanceof Error ? e.message : "Revise os itens."); return; }
    }
    setEtapa(atual => atual + 1);
  }
  function montarEntrada(): EntradaPedidoManual | EntradaPedidoProducao {
    if (!resolucao) throw new Error("Revise o direcionamento do pedido.");
    chave.current ??= crypto.randomUUID();
    if (solicitacaoId && (!revisaoProducao || carregandoOrigem)) throw new Error("Carregue os produtos da produção antes de enviar.");
    const schema = solicitacaoId ? pedidoProducaoSchema : pedidoManualSchema;
    const parsed = schema.safeParse({ ...(solicitacaoId ? { revisaoProducao } : {}), versao: 2, origemManual: resolucao.referencia, decisaoDirecionamento: resolucao.decisao,
      ...(resolucao.fornecedorManual ? { fornecedorManual: resolucao.fornecedorManual } : {}),
      chaveIdempotencia: chave.current, aplicativoId, itens, observacao: observacao || null,
      selecoes: { ...serializarRascunhoFilaOlist(selecoes), vendedorId: resolucao.selecoes.vendedorId, clienteId: resolucao.selecoes.clienteId } });
    if (!parsed.success) throw new Error("Revise os itens: informe tecido, peças inteiras e metragem positiva; vendedor e cliente são obrigatórios.");
    return parsed.data;
  }
  async function enviar(entrada: EntradaPedido) {
    if (ocupado.current) return;
    ocupado.current = true; setEnviando(true); setErro("");
    setTentativa(entrada);
    chave.current = entrada.chaveIdempotencia;
    try { sessionStorage.setItem(storageChaveKey, entrada.chaveIdempotencia); sessionStorage.setItem(storageKey, JSON.stringify(entrada)); if (solicitacaoId && fonteProducao.current) sessionStorage.setItem(storageFonteKey, fonteProducao.current); } catch { /* A chave permanece em memória. */ }
    try {
      const response = await fetch(apiBase, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(entrada) });
      const d = await response.json();
      if (!response.ok) {
        const aceito = comprovantePedidoManualSchema.safeParse(d.pedidoExistente);
        if (response.status === 409 && aceito.success) {
          concluirAceite(aceito.data);
          setErro(d.error || "Esta confirmação já possui um pedido. As alterações atuais não foram aplicadas.");
          return;
        }
        if (response.status < 500) {
          // Uma tentativa recuperada após reload também devolve seus campos para correção.
          const origem = "origemManual" in entrada ? entrada.origemManual : null;
          contaInicializada.current = origem?.aplicativoId ?? "";
          if (origem) setReferenciaId(origem.aplicativoId);
          setItens(entrada.itens); origemCarregada.current = true;
          if ("revisaoProducao" in entrada) setRevisaoProducao(entrada.revisaoProducao);
          setObservacao(entrada.observacao ?? ""); setEtapa(5);
          setVendedor(origem ? { id: origem.vendedor.id, nome: origem.vendedor.nome } : null);
          setCliente(origem ? { id: origem.cliente.id, nome: origem.cliente.nome } : null);
          setSelecoes(criarRascunhoFilaOlist(entrada.itens.map(i => i.id), entrada.selecoes));
          setTentativa(null); try { sessionStorage.removeItem(storageKey); } catch { /* opcional */ }
          if (response.status === 403 || response.status === 409) {
            setResolucao(null); setAplicativoId("");
            setSelecoes(criarRascunhoFilaOlist(entrada.itens.map(i => i.id)));
            setContaPronta(false); setRevisaoLista(atual => atual + 1); setEtapa(0);
          }
        }
        throw new Error(d.error || "Falha ao registrar pedido.");
      }
      const aceito = comprovantePedidoManualSchema.safeParse(d);
      if (!aceito.success) throw new Error("Não foi possível confirmar o comprovante. Repita a mesma confirmação.");
      concluirAceite(aceito.data);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível confirmar o aceite. Tente novamente com a mesma confirmação."); }
    finally { ocupado.current = false; setEnviando(false); }
  }
  function concluirAceite(aceito: ComprovantePedidoManual) {
    setComprovante(aceito); setTentativa(null);
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageChaveKey); sessionStorage.removeItem(storageFonteKey); } catch { /* opcional */ }
    window.history.replaceState(null, "", `${window.location.pathname}?${new URLSearchParams({ pedidoId: aceito.id, ...(solicitacaoId ? { solicitacaoId } : {}) })}`);
  }
  function novoPedido() {
    window.history.replaceState(null, "", window.location.pathname); setComprovante(null); setTentativa(null);
    setItens([]); setCliente(null); setObservacao(""); setResolucao(null); setAplicativoId(""); setSelecoes(criarRascunhoFilaOlist([])); chave.current = null; setEtapa(0); setErro("");
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageChaveKey); sessionStorage.removeItem(storageFonteKey); } catch { /* opcional */ }
  }
  return <div className="min-w-0 space-y-4">
    <PageHeader title="Criar pedido na fila" description={solicitacaoId ? "Revise o pedido ao fornecedor. As alterações dos produtos não modificam a solicitação de produção original." : "Monte um pedido manual para revisão e envio posterior à Olist."} />
    {solicitacaoId && <Link className={`${botao} inline-flex items-center`} href="/solicitacoes-producao">Voltar às solicitações de produção</Link>}
    {erro && <p ref={alerta} tabIndex={-1} role="alert" className="break-words rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700">{erro}</p>}
    {carregando || carregandoComprovante ? <p role="status">Carregando...</p> : comprovante ? <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" aria-label="Comprovante do pedido">
      <h3 tabIndex={-1} ref={titulo} className="text-lg font-semibold">Pedido registrado na fila</h3>
      <p role="status">Status: <strong>{comprovante.status}</strong>. O enfileiramento não confirma a criação na Olist.</p>
      <p className="break-all text-sm">Protocolo: {comprovante.id}</p><p className="break-words text-sm">Aplicativo destinatário: {comprovante.aplicativo?.nome ?? "Não selecionado"}</p>
      <div className="flex flex-wrap gap-3">{podeGerenciarFila && !comprovante.filaExterna && <Link className={primario} href="/fornecedor/fila-pedidos">Abrir fila de pedidos</Link>}{!solicitacaoId && <button className={botao} type="button" onClick={novoPedido}>Criar outro pedido</button>}</div>
    </section> : tentativa ? <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-semibold">Confirmar resultado do envio para a fila</h3><p className="text-sm">Há uma confirmação pendente nesta sessão. Consulte novamente com os mesmos dados para evitar duplicidade.</p>
      <button type="button" className={primario} disabled={enviando} onClick={() => void enviar(tentativa)}>{enviando ? "Confirmando..." : "Confirmar resultado"}</button>
    </section> : <>
      <ol aria-label="Etapas da criação" className="flex flex-wrap gap-2 text-xs">{etapas.map((nome, index) => <li key={nome} aria-current={index === etapa ? "step" : undefined} className={`rounded-md border border-slate-200 px-3 py-2 ${index === etapa ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>{index + 1}. {nome}</li>)}</ol>
      <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-busy={enviando}>
        <h3 ref={titulo} tabIndex={-1} className="text-lg font-semibold">{etapas[etapa]}</h3>
        {solicitacaoId && etapa >= 3 && <button type="button" className={botao} disabled={enviando || resolvendo || !cliente || !vendedor}
          onClick={() => setRevisaoResolucao(atual => atual + 1)}>Atualizar direcionamento</button>}
        {etapa === 0 && <>{aplicativos.some(a => a.fornecedorId) ? <label className="block text-sm text-slate-700">Aplicativo de referência<select className="input mt-1 min-h-11 w-full" value={referenciaId} disabled={enviando || carregando} onChange={e => selecionarReferencia(e.target.value)}>
          {!referenciaId && <option value="">Nenhuma conta disponível para selecionar</option>}
          {aplicativos.map(a => <option key={a.id} value={a.id} disabled={Boolean(a.bloqueio)} title={a.bloqueio ?? undefined}>{a.nome}{a.bloqueio ? " · Sem vendedor" : a.fornecedorId ? " · Conta do fornecedor" : " · Aplicativo próprio"}</option>)}
        </select><span className="mt-1 block text-xs text-slate-500">Ao escolher uma conta do fornecedor, o pedido segue para a fila da matriz fornecedora. O aplicativo destinatário será definido pelas regras de direcionamento.</span></label> : <p className="text-sm text-slate-600">Aplicativo de referência: <strong>{aplicativos.find(a => a.id === referenciaId)?.nome ?? (carregando ? "Carregando" : "Não selecionado")}</strong></p>}
          {solicitacaoId && !aplicativos.length && <p role="status" className="text-sm text-slate-600">Nenhum fornecedor autorizado disponível.</p>}
          {solicitacaoId && aplicativos.some(a => a.bloqueio) && <div className="space-y-2" aria-label="Contas bloqueadas">
            <p className="text-xs text-slate-600">Contas sem vendedor vinculado ficam indisponíveis. Foque ou toque para consultar o motivo.</p>
            <div className="flex flex-wrap gap-3">{aplicativos.map(a => a.bloqueio && <BloqueioExplicado key={a.id} nome={`${a.nome} indisponível`} motivo={a.bloqueio}>
              <button type="button" disabled className={`${botao} pointer-events-none break-words`}>{a.nome} · Sem vendedor</button>
            </BloqueioExplicado>)}</div>
          </div>}
          {referenciaId && (vendedorFixo ? <p className="text-sm">Vendedor fixo do usuário: <strong>{vendedor?.nome}</strong></p> : <PesquisaOlist key={apiOrigem} titulo="Vendedor" recurso="vendedores" api={apiOrigem} token={token} valor={vendedor?.id ?? 0} disabled={!contaPronta} aoSelecionar={o => { invalidarDestino(); setVendedor(o); setCliente(null); }} />)}
          {referenciaId && !contaPronta && !erro && <p role="status" className="text-sm">Consultando vendedor da conta...</p>}
          <button type="button" className={botao} onClick={() => { setContaPronta(false); setResolucao(null); setRevisaoLista(atual => atual + 1); }}>Atualizar conta</button>
          {solicitacaoId && referenciaId && !revisaoProducao && !carregandoOrigem && <button type="button" className={botao} onClick={() => { substituirOrigem.current = true; setErro(""); setRecarregarOrigem(atual => atual + 1); }}>Descartar edições e recarregar dados da produção</button>}</>}
        {etapa === 1 && <><p className="text-sm text-slate-600">O cliente precisa ter CPF/CNPJ cadastrado. O mesmo documento será localizado no aplicativo destinatário.</p><PesquisaOlist key={`${apiOrigem}:${vendedor?.id}`} titulo="Cliente" recurso="clientes" api={apiOrigem} token={token} valor={cliente?.id ?? 0} disabled={!contaPronta} aoSelecionar={o => { invalidarDestino(); setCliente(o); }} />{vendedorFixo && <p className="text-sm text-slate-600">Somente clientes da carteira do seu vendedor são exibidos.</p>}</>}
        {etapa === 2 && <div className="space-y-4">
          {resolvendo ? <p role="status">Aplicando regras e localizando os cadastros no destino...</p> : resolucao ? <>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt>Aplicativo destinatário</dt><dd className="break-words font-semibold">{nomeAplicativoDestino}</dd></div>
              <div><dt>Direcionamento</dt><dd className="break-words">{resolucao.decisao.motivo}</dd></div>
              <div><dt>Cliente de referência</dt><dd className="break-words">{resolucao.referencia.cliente.nome} · {resolucao.referencia.cliente.cpfCnpj || "Sem documento"}</dd></div>
              <div><dt>UF do endereço principal</dt><dd>{resolucao.referencia.cliente.uf || "Não informada"}</dd></div>
            </dl><p className="text-sm text-slate-600">O aplicativo segue as regras configuradas. Após incluir, quem gerencia a fila poderá alterar o destino enquanto o pedido aguarda aprovação.</p>
          </> : erroResolucao ? <p role="alert" className="break-words text-sm text-red-700">{erroResolucao}</p> : <p role="status">Selecione vendedor e cliente válidos para resolver o destino.</p>}
          <button className={botao} type="button" disabled={resolvendo || !cliente || !vendedor} onClick={() => setRevisaoResolucao(r => r + 1)}>Atualizar direcionamento</button>
        </div>}
        {etapa === 3 && <>
          {solicitacaoId && <div className="space-y-3">
            <p className="text-sm text-slate-600">Você pode editar, remover e adicionar produtos. As alterações valem somente para o pedido ao fornecedor.</p>
            {carregandoOrigem && <p role="status">Carregando dados da produção...</p>}
            <button type="button" className={botao} disabled={enviando || carregandoOrigem} onClick={() => { substituirOrigem.current = true; setErro(""); setRecarregarOrigem(atual => atual + 1); }}>Descartar edições e recarregar dados da produção</button>
          </div>}
          <ItensPedidoEditor catalogo={catalogoTecidos} itens={itens} selecoes={selecoes} disabled={enviando || carregandoOrigem} limite={limite}
            aoAlterarItem={alterarItem} aoAdicionar={adicionar} aoAlterarSelecoes={setSelecoes}
            aoRemover={id => { setItens(atuais => atuais.filter(item => item.id !== id)); setSelecoes(atual => ({ ...atual, tecidos: atual.tecidos.filter(item => item.tecidoId !== id) })); }} />
        </>}
        {etapa === 4 && <><p className="text-sm text-slate-600">Opcional nesta etapa. As associações e preços serão conferidos antes de criar o pedido na Olist.</p><DadosComerciaisFilaOlist key={api} api={api} token={token} itens={itens.map(i => ({ tecidoId: i.id, nome: i.tecidoNome, corteLaser: i.corteLaser }))} selecoes={selecoes} aoAlterar={alterarSelecoesComerciais} disabled={enviando} ocultarClienteVendedor catalogoTecidos={catalogoTecidos} />
          <label className="block text-sm">Observação do pedido<textarea className="input mt-1 min-h-24" maxLength={5000} value={observacao} onChange={e => setObservacao(e.target.value)} /></label></>}
        {etapa === 5 && <><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt>Aplicativo</dt><dd className="break-words font-medium">{nomeAplicativoDestino}</dd></div><div><dt>Vendedor</dt><dd className="break-words font-medium">{vendedor?.nome}</dd></div><div><dt>Cliente</dt><dd className="break-words font-medium">{cliente?.nome}</dd></div><div><dt>Status ao enviar</dt><dd>PENDENTE</dd></div></dl>
          {itens.map((i, index) => {
            const produto = selecoes.tecidos.find(t => t.tecidoId === i.id);
            const cadastro = catalogoTecidos.itens.find(item => item.id === produto?.id);
            return <div key={i.id} className="space-y-1 rounded-md border border-slate-200 p-3 text-sm">
              <p className="break-words font-semibold">Item {index + 1}: {i.tecidoNome}</p>
              <p>{i.quantidade.toLocaleString("pt-BR")} peças · {i.quantidadeTecido.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} m · Laser: {i.corteLaser ? "Sim" : "Não"}</p>
              <p className="break-words">Estampa: {i.estampa || "—"} · Variante: {i.variante || "—"} · Tamanho: {i.tamanho || "—"} · Tipo: {i.tipoProduto || "—"}</p>
              <p className="break-words">Produto Olist: {produto?.id ? `${cadastro ? `${cadastro.nome} · ` : ""}ID ${produto.id}` : "Pendente"} · Preço/m: {produto?.preco == null ? "Pendente" : `R$ ${produto.preco.toFixed(2)}`}</p>
            </div>;
          })}
          <p className="text-sm">Forma: {selecoes.formaId ? "Selecionada" : "Pendente"} · Plano: {selecoes.planoId ? "Selecionado" : "Pendente"} · Tipo de venda: {selecoes.tipoVenda || "Pendente"}</p><p className="whitespace-pre-wrap break-words text-sm">{observacao || "Sem observação."}</p><p className="text-sm text-slate-600">A confirmação registra o pedido na fila. Um administrador revisará os dados antes do envio à Olist.</p></>}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-between">
          <button type="button" className={botao} disabled={etapa === 0 || enviando} onClick={() => { setErro(""); setEtapa(e => e - 1); }}>Voltar</button>
          {etapa < 5 ? <button type="button" className={primario} disabled={!contaPronta || (etapa >= 2 && (!resolucao || resolvendo || (Boolean(solicitacaoId) && (!revisaoProducao || carregandoOrigem))))} onClick={avancar}>Continuar</button> : <button type="button" className={primario} disabled={enviando || !contaPronta || !resolucao || resolvendo || (Boolean(solicitacaoId) && (!revisaoProducao || carregandoOrigem))} onClick={() => { try { if (contaPronta) void enviar(montarEntrada()); } catch (e) { setErro(e instanceof Error ? e.message : "Revise o pedido."); } }}>Enviar para fila</button>}
        </div>
      </section>
    </>}
  </div>;
}
