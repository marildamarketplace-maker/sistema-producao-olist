"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PedidoFilaAdministracao } from "@/lib/fila-fornecedor-contrato";
import type { EstadoEnvioFila, OpcaoFilaOlist, SelecoesFilaOlist } from "@/lib/fila-olist-contrato";

const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50";
const primario = `${botao} bg-slate-900 text-white`;
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
type PedidoPrevia = { idContato: number; vendedor: { id: number }; observacoes: string; observacoesInternas: string;
  itens: { produto: { id: number; tipo: string }; quantidade: number; valorUnitario: number; infoAdicional: string }[];
  pagamento: { parcelas: { dias: number; valor: number }[] } };
type Previa = { previaId: string; payload: PedidoPrevia; produtos: Record<string, string>; cliente: string; vendedor: string; forma: string; plano: string };

function PesquisaOlist({ titulo, recurso, valor, api, token, aoSelecionar, disabled }: {
  titulo: string; recurso: string; valor: number; api: string; token: string; aoSelecionar: (opcao: OpcaoFilaOlist) => void; disabled: boolean;
}) {
  const id = useId();
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoFilaOlist[]>([]);
  const [pagina, setPagina] = useState(1);
  const [mais, setMais] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function pesquisar(proxima = 1) {
    controller.current?.abort(); const atual = new AbortController(); controller.current = atual;
    setCarregando(true); setErro("");
    try {
      const response = await fetch(`${api}?${new URLSearchParams({ recurso, busca, pagina: String(proxima) })}`, { headers: { Authorization: `Bearer ${token}` }, signal: atual.signal });
      const dados = await response.json(); if (!response.ok) throw new Error(dados.error);
      if (!atual.signal.aborted) { setOpcoes(dados.itens); setPagina(proxima); setMais(dados.mais); }
    } catch (e) { if (!atual.signal.aborted) setErro(e instanceof Error ? e.message : "Falha na pesquisa."); }
    finally { if (!atual.signal.aborted) setCarregando(false); }
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md border border-slate-200 p-3">
    <legend className="px-1 text-sm font-medium">{titulo}</legend>
    <label htmlFor={`${id}-busca`} className="block text-xs text-slate-600">Pesquisar pelo nome na filial</label>
    <div className="flex flex-wrap gap-2"><input id={`${id}-busca`} className="input min-h-11 min-w-0 flex-1" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void pesquisar(); } }} />
      <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar()}>Buscar</button></div>
    <label htmlFor={`${id}-resultado`} className="block text-xs text-slate-600">Cadastro selecionado</label>
    <select id={`${id}-resultado`} className="input min-h-11 max-w-full" value={valor || ""} disabled={carregando} onChange={(e) => { const opcao = opcoes.find((o) => o.id === Number(e.target.value)); if (opcao) aoSelecionar(opcao); }}>
      <option value="">Selecione um resultado</option>
      {valor > 0 && !opcoes.some((o) => o.id === valor) && <option value={valor}>ID {valor} · seleção salva, sujeita à validação</option>}
      {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome} · ID {o.id}{o.referencia ? ` · ${o.referencia}` : ""}</option>)}
    </select>
    {carregando && <p role="status" className="text-xs">Consultando Olist...</p>}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={botao} disabled={carregando || pagina === 1} onClick={() => void pesquisar(pagina - 1)}>Anterior</button>
      <button type="button" className={botao} disabled={carregando || !mais} onClick={() => void pesquisar(pagina + 1)}>Mais resultados</button></div>
  </fieldset>;
}

export function EnviarPedidoFilaOlist({ pedido, token, aoFechar, aoConcluir }: { pedido: PedidoFilaAdministracao; token: string; aoFechar: () => void; aoConcluir: () => void }) {
  const api = `/api/fornecedores/fila/${pedido.id}/olist`;
  const dialog = useRef<HTMLDialogElement>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const tituloId = useId();
  const ocupado = useRef(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [envio, setEnvio] = useState<EstadoEnvioFila | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [planos, setPlanos] = useState<{ id: string; nome: string }[]>([]);
  const [justificativa, setJustificativa] = useState("");
  const [idExistente, setIdExistente] = useState("");
  const [ausencia, setAusencia] = useState(false);
  const [selecoes, setSelecoes] = useState<SelecoesFilaOlist>({ clienteId: 0, vendedorId: 0, formaId: 0, planoId: "", tipoVenda: "VENDA", laser: null,
    tecidos: Array.from(new Map(pedido.dadosPedido?.itens.map((i) => [i.tecido.id, { tecidoId: i.tecido.id, id: 0, preco: 0 }]) ?? []).values()) });
  const laser = pedido.dadosPedido?.itens.some((i) => i.corteLaser);
  const bloqueado = !!envio && !["LIBERADO", "REJEITADO"].includes(envio.estado);
  const concluido = envio?.estado === "CONCLUIDO" || pedido.status === "CONCLUIDO";
  useEffect(() => {
    const anterior = document.activeElement, elemento = dialog.current; elemento?.showModal();
    return () => { elemento?.close(); if (anterior instanceof HTMLElement) anterior.focus(); };
  }, []);
  async function requisitar(body?: unknown) {
    const response = await fetch(api, { method: body ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const dados = await response.json(); if (!response.ok) throw new Error(dados.error || "Falha na operação."); return dados;
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d) => { setEnvio(d.envio); if (d.selecoes) setSelecoes((atual) => ({ ...atual, ...d.selecoes, tecidos: atual.tecidos.map((t) => d.selecoes.tecidos?.find((s: { tecidoId: string }) => s.tecidoId === t.tecidoId) ?? t) })); })
      .catch((e) => { if (!controller.signal.aborted) setErro(e.message); }).finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [api, token]);
  useEffect(() => {
    if (!selecoes.formaId) return;
    const controller = new AbortController(); setPlanos([]);
    fetch(`${api}?recurso=planos&formaId=${selecoes.formaId}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }).then((d) => setPlanos(d.itens))
      .catch((e) => { if (!controller.signal.aborted) setErro(e.message); });
    return () => controller.abort();
  }, [selecoes.formaId, api, token]);
  useEffect(() => { if (erro || mensagem || previa) alerta.current?.focus(); }, [erro, mensagem, previa]);
  async function operar(body: unknown, acao: "preview" | "confirmar" | "conciliar") {
    if (ocupado.current) return; ocupado.current = true; setSalvando(true); setErro("");
    try {
      const dados = await requisitar(body);
      if (acao === "preview") setPrevia(dados);
      else { setMensagem(acao === "confirmar" ? `Pedido Olist ${dados.id} criado. Status CONCLUIDO.` : `Conferência registrada. Status ${dados.status}. Feche e atualize a fila.`); setPrevia(null); setEnvio((v) => v ? { ...v, estado: dados.status === "CONCLUIDO" ? "CONCLUIDO" : "LIBERADO", pedidoOlistId: dados.id ? String(dados.id) : idExistente || null } : null); }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha na operação.");
      if (acao !== "preview") { setPrevia(null); try { const dados = await requisitar(); setEnvio(dados.envio); } catch { /* A próxima abertura consulta a reserva persistida. */ } }
    } finally { ocupado.current = false; setSalvando(false); }
  }
  const pesquisa = (titulo: string, recurso: string, valor: number, aoSelecionar: (o: OpcaoFilaOlist) => void) => <PesquisaOlist titulo={titulo} recurso={recurso} valor={valor} api={api} token={token} disabled={salvando} aoSelecionar={aoSelecionar} />;
  return createPortal(<dialog ref={dialog} aria-labelledby={tituloId} onCancel={(e) => { if (salvando) e.preventDefault(); else { aoFechar(); aoConcluir(); } }}
    className="m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-slate-900 backdrop:bg-black/50 sm:p-6">
    <div className="space-y-4" aria-busy={salvando || carregando}>
      <h2 id={tituloId} className="text-lg font-semibold">{concluido ? "Resultado do envio" : "Enviar pedido para a Olist"}</h2>
      <p className="break-words text-sm">Conta destinatária: <strong>{pedido.filial?.nome}</strong>. Os dados revisados da fila serão usados neste pedido.</p>
      <p ref={alerta} tabIndex={-1} role={erro ? "alert" : "status"} className={`break-words text-sm ${erro ? "text-red-700" : "text-slate-600"}`}>{erro || mensagem || (previa ? "Revise os itens e confirme a criação real na Olist." : "Consulte os cadastros e revise todos os valores antes de criar.")}</p>
      {carregando ? <p role="status">Carregando configurações...</p> : envio && bloqueado ? <div className="space-y-3 rounded-md border border-amber-300 p-4">
        <p className="font-medium">{concluido ? "CONCLUIDO" : envio.estado === "RESERVADO" ? "PROCESSAR · envio reservado" : "FALHADO · resultado incerto"}</p>
        <p className="break-words text-sm">Conta da tentativa: <strong>{envio.aplicativoNome ?? envio.aplicativoId}</strong></p>
        {envio.pedidoOlistId && <p className="break-all">ID Olist: {envio.pedidoOlistId}</p>}
        <p className="text-sm">{envio.diagnostico || "A reserva impede criar outro pedido para esta solicitação."}</p>
        {!concluido && <>
          <p className="text-sm">Confira a conta destinatária da tentativa. Uma tentativa interrompida só pode ser conciliada após 10 minutos. O vínculo exige o identificador da solicitação nas observações internas do pedido Olist.</p>
          <label className="block text-sm">ID do pedido existente<input className="input mt-1 min-h-11" inputMode="numeric" value={idExistente} onChange={(e) => setIdExistente(e.target.value)} /></label>
          <label className="block text-sm">Justificativa da conferência (mínimo 10 caracteres)<textarea className="input mt-1" value={justificativa} maxLength={1000} onChange={(e) => setJustificativa(e.target.value)} /></label>
          <button type="button" className={botao} disabled={salvando || !idExistente || justificativa.trim().length < 10} onClick={() => void operar({ acao: "vincular", pedidoOlistId: idExistente, tentativaId: envio.tentativaId, justificativa }, "conciliar")}>Verificar na Olist e vincular pedido</button>
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={ausencia} onChange={(e) => setAusencia(e.target.checked)} />Conferi a conta Olist da tentativa e confirmo que nenhum pedido foi criado para esta solicitação.</label>
          <button type="button" className={botao} disabled={salvando || !ausencia || justificativa.trim().length < 10 || !!envio.pedidoOlistId} onClick={() => void operar({ acao: "confirmar-ausencia", ausenciaConfirmada: true, tentativaId: envio.tentativaId, justificativa }, "conciliar")}>Registrar ausência e liberar nova tentativa</button>
        </>}
      </div> : !mensagem && !previa ? <div className="space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {pesquisa("Cliente", "clientes", selecoes.clienteId, (o) => setSelecoes({ ...selecoes, clienteId: o.id }))}
          {pesquisa("Vendedor", "vendedores", selecoes.vendedorId, (o) => setSelecoes({ ...selecoes, vendedorId: o.id }))}
          {pesquisa("Forma de pagamento", "formas", selecoes.formaId, (o) => setSelecoes({ ...selecoes, formaId: o.id, planoId: "" }))}
          <label className="block text-sm">Plano de pagamento local<select className="input mt-2 min-h-11" value={selecoes.planoId} disabled={salvando} onChange={(e) => setSelecoes({ ...selecoes, planoId: e.target.value })}><option value="">Selecione um plano associado</option>{planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
            {selecoes.formaId > 0 && planos.length === 0 && <span className="mt-2 block text-xs text-amber-700">Nenhum plano disponível. Confira a associação da forma nesta filial.</span>}</label>
          <label className="block text-sm">Tipo de venda<select className="input mt-2 min-h-11" value={selecoes.tipoVenda} disabled={salvando} onChange={(e) => setSelecoes({ ...selecoes, tipoVenda: e.target.value as SelecoesFilaOlist["tipoVenda"] })}><option value="VENDA">Venda</option><option value="VENDA_G">Venda G</option><option value="VENDA_PC">Venda PC</option></select></label>
        </div>
        {selecoes.tecidos.map((tecido, index) => <div key={tecido.tecidoId} className="space-y-2">
          {pesquisa(`Produto para ${pedido.dadosPedido?.itens.find((i) => i.tecido.id === tecido.tecidoId)?.tecido.nome}`, "produtos", tecido.id, (o) => setSelecoes({ ...selecoes, tecidos: selecoes.tecidos.map((t, i) => i === index ? { ...t, id: o.id, preco: o.preco ?? 0 } : t) }))}
          <label className="block text-sm">Preço por metro (R$)<input className="input mt-1 min-h-11" type="number" min="0" max="1000000000" step="0.01" value={tecido.preco} disabled={salvando} onChange={(e) => setSelecoes({ ...selecoes, tecidos: selecoes.tecidos.map((t, i) => i === index ? { ...t, preco: Number(e.target.value) } : t) })} /></label>
        </div>)}
        {laser && <div className="space-y-2">
          {pesquisa("Serviço de corte a laser", "servicos", selecoes.laser?.id ?? 0, (o) => setSelecoes({ ...selecoes, laser: { id: o.id, preco: o.preco ?? 0 } }))}
          <label className="block text-sm">Preço do serviço por metro (R$)<input className="input mt-1 min-h-11" type="number" min="0" step="0.01" value={selecoes.laser?.preco ?? 0} disabled={salvando} onChange={(e) => setSelecoes({ ...selecoes, laser: { id: selecoes.laser?.id ?? 0, preco: Number(e.target.value) } })} /></label>
        </div>}
        <button type="button" className={primario} disabled={salvando} onClick={() => void operar({ acao: "preview", versao: pedido.versao, selecoes }, "preview")}>{salvando ? "Validando na Olist..." : "Revisar pedido"}</button>
      </div> : previa ? <div className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt>Cliente</dt><dd className="break-words font-medium">{previa.cliente}</dd></div><div><dt>Vendedor</dt><dd className="break-words font-medium">{previa.vendedor}</dd></div><div><dt>Forma / plano</dt><dd>{previa.forma} · {previa.plano}</dd></div></dl>
        {previa.payload.itens.map((item, i) => <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm"><p className="break-words font-medium">{previa.produtos[`${item.produto.tipo}:${item.produto.id}`] ?? previa.produtos[item.produto.id]} · ID {item.produto.id}</p><p>{item.quantidade} m × {moeda(item.valorUnitario)} = {moeda(item.quantidade * item.valorUnitario)}</p><p className="whitespace-pre-wrap break-words">{item.infoAdicional}</p></div>)}
        <p className="font-semibold">Total: {moeda(previa.payload.itens.reduce((v, i) => v + i.quantidade * i.valorUnitario, 0))}</p>
        <ul className="text-sm">{previa.payload.pagamento.parcelas.map((p, i) => <li key={i}>Parcela {i + 1}: {p.dias} dias · {moeda(p.valor)}</li>)}</ul>
        <p className="whitespace-pre-wrap break-words text-sm">{previa.payload.observacoes}</p><p className="whitespace-pre-wrap break-words text-sm">{previa.payload.observacoesInternas}</p>
        <div className="flex flex-wrap gap-3"><button type="button" className={botao} disabled={salvando} onClick={() => setPrevia(null)}>Voltar e corrigir</button><button type="button" className={primario} disabled={salvando} onClick={() => void operar({ acao: "confirmar", previaId: previa.previaId }, "confirmar")}>{salvando ? "Criando pedido..." : "Confirmar e criar na Olist"}</button></div>
      </div> : null}
      <div className="flex justify-end border-t border-slate-200 pt-4"><button type="button" className={botao} disabled={salvando} onClick={() => { aoFechar(); aoConcluir(); }}>Fechar e atualizar fila</button></div>
    </div>
  </dialog>, document.body);
}
