"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { confirmarRetornoSchema } from "@/lib/retorno-estoque-olist-domain";
import type { ConfirmarRetornoInput, HistoricoRetorno, ResultadoBuscaRetorno } from "@/lib/retorno-estoque-olist-domain";

type Tentativa = ConfirmarRetornoInput;
type HistoricoResponse = { retornos: HistoricoRetorno[]; tem_mais: boolean };
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50";

function LinkPedidoOlist({ pedidoId }: { pedidoId: string | null }) {
  if (!pedidoId) return <span>Pedido não informado</span>;
  return <a href={`https://erp.olist.com/vendas#edit/${encodeURIComponent(pedidoId)}`}
    target="_blank" rel="noopener noreferrer" title={`Abrir pedido ${pedidoId} na Olist (nova aba)`}
    className="inline-flex min-h-11 max-w-full items-center gap-1 py-2 align-middle text-slate-900 underline decoration-slate-400 underline-offset-2 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500">
    <span className="min-w-0 break-all">Pedido Olist {pedidoId}</span>
    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
    <span className="sr-only"> (abre em nova aba)</span>
  </a>;
}

export default function RetornoEstoqueOlistPage() {
  const { session, usuario } = useAuth();
  const token = session?.access_token;
  const podeConfirmar = Boolean(usuario?.podeSolicitarDevolucao);
  const podeVisualizar = Boolean(usuario?.podeVisualizarDevolucao || podeConfirmar);
  const [data, setData] = useState("");
  const [resultado, setResultado] = useState<ResultadoBuscaRetorno | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [perdidos, setPerdidos] = useState<Record<string, boolean>>({});
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [tentativa, setTentativa] = useState<Tentativa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [historico, setHistorico] = useState<HistoricoResponse>({ retornos: [], tem_mais: false });
  const [pagina, setPagina] = useState(1);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [erroHistorico, setErroHistorico] = useState<string | null>(null);
  const enviando = useRef(false);
  const resumoRef = useRef<HTMLHeadingElement>(null);
  const armazenamentoKey = usuario ? `retorno_olist_pendente:${usuario.aplicativo_id}:${usuario.id}` : null;

  useEffect(() => {
    if (!armazenamentoKey) return;
    try {
      const salvo = sessionStorage.getItem(armazenamentoKey);
      if (salvo) {
        const validado = confirmarRetornoSchema.safeParse(JSON.parse(salvo));
        if (validado.success) { setTentativa(validado.data); setRevisando(true); }
      }
    } catch { /* Armazenamento indisponível: o reenvio continua protegido nesta tela. */ }
  }, [armazenamentoKey]);

  useEffect(() => {
    if (revisando) resumoRef.current?.focus();
  }, [revisando]);

  useEffect(() => {
    if (!tentativa) return;
    const avisar = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [tentativa]);

  function guardarTentativa(valor: Tentativa | null) {
    setTentativa(valor);
    if (!armazenamentoKey) return;
    try {
      if (valor) sessionStorage.setItem(armazenamentoKey, JSON.stringify(valor));
      else sessionStorage.removeItem(armazenamentoKey);
    } catch { /* A proteção transacional do servidor não depende do armazenamento local. */ }
  }

  const api = useCallback(async <T,>(caminho: string, body?: unknown): Promise<T> => {
    const response = await fetch(`/api/olist/retorno-estoque/${caminho}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error ?? "Não foi possível concluir a operação."), { status: response.status });
    return payload as T;
  }, [token]);

  const carregarHistorico = useCallback(async (numero: number) => {
    setCarregandoHistorico(true); setErroHistorico(null);
    try { setHistorico(await api<HistoricoResponse>(`historico?pagina=${numero}`)); setPagina(numero); }
    catch { setErroHistorico("Não foi possível carregar o histórico. Tente novamente."); }
    finally { setCarregandoHistorico(false); }
  }, [api]);

  useEffect(() => {
    if (!token || !podeVisualizar) return;
    let ativo = true;
    void api<{ data_atualizacao: string }>("buscar").then((valor) => { if (ativo) setData(valor.data_atualizacao); })
      .catch(() => { if (ativo) setErro("Não foi possível carregar a data padrão. Informe uma data para buscar."); });
    void carregarHistorico(1);
    return () => { ativo = false; };
  }, [api, carregarHistorico, token, podeVisualizar]);

  const elegiveis = resultado?.pedidos.filter((pedido) => pedido.estado === "elegivel") ?? [];
  const itensSelecionados = elegiveis.filter((pedido) => selecionados.includes(pedido.id))
    .flatMap((pedido) => pedido.itens.filter((item) => item.saldo > 0).map((item) => ({
      ...item, pedido: pedido.id, valor: quantidades[item.item_baixa_id] ?? String(item.saldo),
    })));
  const itensInvalidos = itensSelecionados.some((item) => !/^\d+$/.test(item.valor)
    || !Number.isSafeInteger(Number(item.valor)) || Number(item.valor) > item.saldo);
  const itensPositivos = itensSelecionados.filter((item) => Number(item.valor) > 0);
  const total = itensPositivos.reduce((soma, item) => soma + Number(item.valor), 0);
  const bloqueado = buscando || salvando || revisando || Boolean(tentativa);

  async function buscar() {
    if (enviando.current || tentativa) return;
    setBuscando(true); setErro(null); setMensagem(null); setResultado(null); setSelecionados([]); setRevisando(false);
    try {
      const resposta = await api<ResultadoBuscaRetorno>("buscar", { data_atualizacao: data });
      setResultado(resposta); setPerdidos({});
      setQuantidades(Object.fromEntries(resposta.pedidos.flatMap((pedido) => pedido.itens.map((item) => [item.item_baixa_id, String(item.saldo)]))));
      setMensagem(`Busca concluída: ${resposta.pedidos.length} pedidos cancelados consultados.`);
    } catch (error) { setErro(error instanceof Error ? error.message : "Falha de conexão ao buscar. Tente novamente."); }
    finally { setBuscando(false); }
  }

  function revisar() {
    setErro(null); setMensagem(null);
    if (itensInvalidos || !itensPositivos.length || itensPositivos.length > 500) {
      setErro("Selecione de 1 a 500 itens e informe quantidades inteiras entre zero e o saldo disponível."); return;
    }
    setRevisando(true);
  }

  async function confirmar() {
    if (enviando.current || !podeConfirmar) return;
    if (!tentativa && (!revisando || itensInvalidos || !itensPositivos.length)) return;
    enviando.current = true; setSalvando(true); setErro(null);
    const envio = tentativa ?? {
      chave_idempotencia: crypto.randomUUID(),
      itens: itensPositivos.map((item) => ({ item_baixa_id: item.item_baixa_id, quantidade: Number(item.valor), ...(perdidos[item.pedido] ? { perdido_na_entrega: true as const } : {}) })),
    };
    guardarTentativa(envio);
    try {
      const resposta = await api<{ quantidade: number }>("confirmar", envio);
      // Atualiza o saldo local com o envio aceito; uma nova busca revalida a Olist.
      const devolvido = new Map(envio.itens.map((item) => [item.item_baixa_id, item.quantidade]));
      setResultado((anterior) => anterior ? { ...anterior, pedidos: anterior.pedidos.map((pedido) => {
        const itens = pedido.itens.map((item) => ({ ...item,
          quantidade_retornada: item.quantidade_retornada + (devolvido.get(item.item_baixa_id) ?? 0),
          saldo: item.saldo - (devolvido.get(item.item_baixa_id) ?? 0),
        }));
        return { ...pedido, itens, estado: pedido.estado === "elegivel" && itens.every((item) => item.saldo === 0) ? "retornado" : pedido.estado };
      }) } : anterior);
      setQuantidades({}); setPerdidos({}); setSelecionados([]); guardarTentativa(null); setRevisando(false);
      const semEstoque = envio.itens.filter((item) => item.perdido_na_entrega).reduce((soma, item) => soma + item.quantidade, 0);
      setMensagem(`Retorno confirmado: ${resposta.quantidade - semEstoque} unidade(s) adicionada(s) ao estoque local; ${semEstoque} unidade(s) registrada(s) como perda na entrega, sem entrada no estoque.`);
      void carregarHistorico(1);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && [400, 404, 409].includes(status)) { guardarTentativa(null); setRevisando(false); }
      setErro(error instanceof Error ? error.message : "Falha de conexão. Reenvie a mesma confirmação para consultar ou concluir o retorno.");
    } finally { enviando.current = false; setSalvando(false); }
  }

  return <AccessGuard permissions={["podeVisualizarDevolucao", "podeSolicitarDevolucao"]}>
    <PageHeader title="Retorno de pedidos cancelados Olist" description="Localize cancelados com baixa vinculada e registre o retorno ao estoque local ou a perda na entrega." />
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <form onSubmit={(event) => { event.preventDefault(); void buscar(); }} className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
          <div className="w-full sm:w-auto"><label htmlFor="data-retorno" className="mb-1 block text-sm font-medium">Atualizados a partir de</label>
            <input id="data-retorno" type="date" required value={data} disabled={bloqueado} onChange={(event) => setData(event.target.value)} className="input min-h-11" />
          </div>
          <button type="submit" disabled={bloqueado || !data || !token} className={`${botao} bg-slate-900 text-white hover:bg-slate-800`}>{buscando ? "Buscando cancelados…" : "Buscar pedidos Olist"}</button>
        </form>
        <p className="mt-3 text-sm text-slate-500">Status: Cancelado. A busca não altera o estoque.</p>
      </section>
      {erro && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</p>}
      {mensagem && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{mensagem}</p>}
      {tentativa && !salvando && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        O resultado do envio precisa ser confirmado. Mantenha esta tela aberta e reenvie a mesma confirmação antes de iniciar outro retorno.
        <button type="button" onClick={() => void confirmar()} className={`${botao} mt-3 block`}>Reenviar mesma confirmação</button>
      </div>}
      {resultado && <section className="space-y-4" aria-label="Resultados da busca">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-semibold">Pedidos com saldo para retornar ({elegiveis.length})</h3>
          {elegiveis.length === 0 && <p className="mt-2 text-sm text-slate-500">Nenhum pedido elegível neste período.</p>}
          {podeConfirmar && elegiveis.length > 0 && <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5" disabled={bloqueado} checked={elegiveis.every((pedido) => selecionados.includes(pedido.id))}
              onChange={(event) => setSelecionados(event.target.checked ? elegiveis.map((pedido) => pedido.id) : [])} />Selecionar todos os elegíveis
          </label>}
        </div>
        {elegiveis.map((pedido) => <article key={pedido.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex min-h-11 items-center gap-3">
            {podeConfirmar && <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`Selecionar pedido ${pedido.id}`} className="h-5 w-5" disabled={bloqueado}
              checked={selecionados.includes(pedido.id)} onChange={(event) => setSelecionados((anteriores) => event.target.checked ? [...anteriores, pedido.id] : anteriores.filter((id) => id !== pedido.id))} /></label>}
            <h4 className="min-w-0 font-semibold"><LinkPedidoOlist pedidoId={pedido.id} /></h4>
          </div>
          {podeConfirmar && <label className="mb-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 shrink-0" disabled={bloqueado || !selecionados.includes(pedido.id)}
              checked={Boolean(perdidos[pedido.id])} onChange={(event) => setPerdidos((anteriores) => ({ ...anteriores, [pedido.id]: event.target.checked }))} />
            Perdido na entrega — registrar sem entrada no estoque
          </label>}
          <div className="space-y-3">{pedido.itens.map((item) => {
            const valor = quantidades[item.item_baixa_id] ?? String(item.saldo);
            const invalido = !/^\d+$/.test(valor) || !Number.isSafeInteger(Number(valor)) || Number(valor) > item.saldo;
            return <div key={item.item_baixa_id} className="grid min-w-0 gap-3 rounded-md border border-slate-200 p-3 lg:grid-cols-[minmax(0,1fr)_2fr_9rem] lg:items-center">
              <p className="break-all text-sm font-medium">SKU {item.sku}</p>
              <dl className="grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-slate-500">Baixado</dt><dd>{item.quantidade_baixada}</dd></div>
                <div><dt className="text-xs text-slate-500">Registrado</dt><dd>{item.quantidade_retornada}</dd></div><div><dt className="text-xs text-slate-500">Saldo</dt><dd>{item.saldo}</dd></div></dl>
              <div>{podeConfirmar && item.saldo > 0 ? <><label htmlFor={`quantidade-${item.item_baixa_id}`} className="mb-1 block text-xs text-slate-600">Quantidade a retornar</label>
                <input id={`quantidade-${item.item_baixa_id}`} aria-label={`Quantidade a retornar do SKU ${item.sku} no pedido ${pedido.id}`}
                  type="number" min={0} max={item.saldo} step={1} inputMode="numeric" value={valor}
                  disabled={bloqueado || !selecionados.includes(pedido.id)} aria-invalid={invalido}
                  aria-describedby={invalido ? `erro-${item.item_baixa_id}` : undefined}
                  onChange={(event) => setQuantidades((anteriores) => ({ ...anteriores, [item.item_baixa_id]: event.target.value }))} className="input min-h-11" />
                {invalido && <p id={`erro-${item.item_baixa_id}`} className="mt-1 text-xs text-red-700">Informe um inteiro entre 0 e {item.saldo}.</p>}</> : <p className="text-sm text-slate-500">{item.saldo === 0 ? "Retorno integralmente registrado" : "Somente consulta"}</p>}</div>
            </div>;
          })}</div>
        </article>)}
        {podeConfirmar && elegiveis.length > 0 && <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Confirmação do retorno">
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Devoluções antigas anotadas manualmente não são descontadas automaticamente. Confira se estes itens já tiveram entrada no estoque antes de confirmar.</p>
          <h3 ref={resumoRef} tabIndex={-1} className="mt-4 text-lg font-semibold focus-visible:outline focus-visible:outline-2">{revisando ? "Revise antes de confirmar" : "Resumo da seleção"}</h3>
          <p className="mt-2 text-sm">{selecionados.length} pedido(s) selecionado(s), {itensPositivos.length} item(ns), {itensInvalidos ? "quantidades inválidas" : `${total} unidade(s)`}. Quantidade zero não será enviada.</p>
          {itensPositivos.length > 500 && <p role="alert" className="mt-2 text-sm text-red-700">Confirme no máximo 500 itens por vez. Reduza a seleção.</p>}
          {revisando && <ul className="mt-3 space-y-1 text-sm">{itensPositivos.map((item) => <li key={item.item_baixa_id} className="break-words"><LinkPedidoOlist pedidoId={item.pedido} /> · {item.sku}: {item.valor} unidade(s) · {perdidos[item.pedido] ? "Perda na entrega: sem entrada no estoque" : "Entrada no estoque local"}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap gap-3">
            {revisando ? <><button type="button" disabled={salvando || Boolean(tentativa)} onClick={() => setRevisando(false)} className={botao}>Voltar e editar</button>
              <button type="button" disabled={salvando || Boolean(tentativa)} onClick={() => void confirmar()} className={`${botao} bg-slate-900 text-white hover:bg-slate-800`}>{salvando ? "Confirmando…" : "Confirmar registro do retorno"}</button></>
              : <button type="button" disabled={buscando || itensInvalidos || !itensPositivos.length || itensPositivos.length > 500} onClick={revisar} className={`${botao} bg-slate-900 text-white hover:bg-slate-800`}>Revisar retorno</button>}
          </div>
        </section>}
        {([ ["pendente", "Pendentes de verificação"], ["sem_baixa", "Sem baixa vinculada"], ["retornado", "Retornos integralmente registrados"] ] as const).map(([estado, titulo]) => {
          const pedidos = resultado.pedidos.filter((pedido) => pedido.estado === estado);
          return <details key={estado} className="rounded-lg border border-slate-200 bg-white p-5" open={estado === "pendente" && pedidos.length > 0}>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{titulo} ({pedidos.length})</summary>
            {pedidos.length === 0 ? <p className="text-sm text-slate-500">Nenhum pedido nesta situação.</p> : <ul className="space-y-3 text-sm">{pedidos.map((pedido) => <li key={pedido.id} className="break-words">
              <p className="font-medium"><LinkPedidoOlist pedidoId={pedido.id} /></p>{pedido.motivo && <p className="text-amber-800">{pedido.motivo}</p>}
              {pedido.itens.map((item) => <p key={item.item_baixa_id}>SKU {item.sku} · baixado: {item.quantidade_baixada} · registrado: {item.quantidade_retornada} · saldo: {item.saldo}</p>)}
            </li>)}</ul>}
          </details>;
        })}
      </section>}
      <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Histórico de retornos">
        <h3 className="text-lg font-semibold">Histórico de retornos</h3>
        {carregandoHistorico && <p role="status" className="mt-3 text-sm">Carregando histórico…</p>}
        {erroHistorico && <div role="alert" className="mt-3 text-sm text-red-700">{erroHistorico}<button type="button" className={`${botao} ml-2`} onClick={() => void carregarHistorico(pagina)}>Tentar novamente</button></div>}
        {!carregandoHistorico && !erroHistorico && historico.retornos.length === 0 && <p className="mt-3 text-sm text-slate-500">Nenhum retorno registrado.</p>}
        <div className="mt-4 space-y-3">{historico.retornos.map((retorno) => <article key={retorno.id} className="rounded-md border border-slate-200 p-3 text-sm">
          <p className="break-words font-medium">{new Date(retorno.created_at).toLocaleString("pt-BR")} · {retorno.responsavel}</p>
          <ul className="mt-2 space-y-1">{retorno.itens.map((item, index) => <li key={index} className="break-words"><LinkPedidoOlist pedidoId={item.pedido_olist_id} /> · SKU {item.sku} · {item.quantidade} unidade(s) · {item.perdido_na_entrega ? "Perda na entrega: sem entrada no estoque" : "Entrada no estoque local"}</li>)}</ul>
        </article>)}</div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className={botao} disabled={carregandoHistorico || pagina === 1} onClick={() => void carregarHistorico(pagina - 1)}>Anterior</button>
          <span className="text-sm">Página {pagina}</span><button type="button" className={botao} disabled={carregandoHistorico || !historico.tem_mais} onClick={() => void carregarHistorico(pagina + 1)}>Próxima</button></div>
      </section>
    </div>
  </AccessGuard>;
}
