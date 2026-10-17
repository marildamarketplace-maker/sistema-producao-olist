"use client";
import { useEffect, useId, useRef, useState } from "react";
import { DadosComerciaisFilaOlist } from "@/components/dados-comerciais-fila-olist";
import { criarRascunhoFilaOlist } from "@/lib/fila-olist-contrato";
import { conterFocoNoDialogo } from "@/lib/dialogo-foco";
import { createPortal } from "react-dom";
import type { PedidoFilaAdministracao } from "@/lib/fila-fornecedor-contrato";
import type { EstadoEnvioFila, RascunhoFilaOlist } from "@/lib/fila-olist-contrato";

const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50";
const primario = `${botao} bg-slate-900 text-white`;
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
type PedidoPrevia = { idContato: number; vendedor: { id: number }; observacoes: string; observacoesInternas: string;
  itens: { produto: { id: number; tipo: string }; quantidade: number; valorUnitario: number; infoAdicional: string }[];
  pagamento: { parcelas: { dias: number; valor: number }[] } };
type Previa = { previaId: string; payload: PedidoPrevia; produtos: Record<string, string>; cliente: string; vendedor: string; forma: string; plano: string };

export function EnviarPedidoFilaOlist({ pedido, token, aoFechar, aoConcluir }: { pedido: PedidoFilaAdministracao; token: string; aoFechar: () => void; aoConcluir: () => void }) {
  const api = `/api/fornecedores/fila/${pedido.id}/olist`;
  const dialog = useRef<HTMLDialogElement>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const tituloId = useId();
  const ocupado = useRef(false);
  const alterado = useRef(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [envio, setEnvio] = useState<EstadoEnvioFila | null>(null);
  const [versao, setVersao] = useState(pedido.versao);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [idExistente, setIdExistente] = useState("");
  const [ausencia, setAusencia] = useState(false);
  const [selecoes, setSelecoes] = useState<RascunhoFilaOlist>(() => criarRascunhoFilaOlist(pedido.dadosPedido?.itens.map((i) => i.tecido.id) ?? []));
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
      .then((d) => { setEnvio(d.envio); if (pedido.status === "PROCESSAR" && d.envio?.estado === "INCERTO") alterado.current = true; setSelecoes(criarRascunhoFilaOlist(pedido.dadosPedido?.itens.map((i) => i.tecido.id) ?? [], d.selecoes ?? undefined)); })
      .catch((e) => { if (!controller.signal.aborted) setErro(e.message); }).finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [api, token, pedido.status, pedido.dadosPedido]);
  useEffect(() => { if (erro || mensagem || previa) alerta.current?.focus(); }, [erro, mensagem, previa]);
  async function operar(body: unknown, acao: "preview" | "confirmar" | "conciliar") {
    if (ocupado.current) return; ocupado.current = true; setSalvando(true); setErro("");
    if (acao !== "preview") alterado.current = true;
    try {
      const dados = await requisitar(body);
      if (acao === "preview") { setPrevia(dados); setVersao(dados.versao); alterado.current = true; }
      else { setMensagem(acao === "confirmar" ? `Pedido Olist ${dados.id} criado. Status CONCLUIDO.` : `Conferência registrada. Status ${dados.status}. Feche e atualize a fila.`); setPrevia(null); setEnvio((v) => v ? { ...v, estado: dados.status === "CONCLUIDO" ? "CONCLUIDO" : "LIBERADO", pedidoOlistId: dados.id ? String(dados.id) : idExistente || null } : null); }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha na operação.");
      if (acao !== "preview") { setPrevia(null); try { const dados = await requisitar(); setEnvio(dados.envio); } catch { /* A próxima abertura consulta a reserva persistida. */ } }
    } finally { ocupado.current = false; setSalvando(false); }
  }
  function fechar() { aoFechar(); if (alterado.current) aoConcluir(); }
  return createPortal(<dialog ref={dialog} aria-labelledby={tituloId}
    onKeyDown={conterFocoNoDialogo} onCancel={(e) => { if (salvando) e.preventDefault(); else fechar(); }}
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
        <DadosComerciaisFilaOlist api={api} token={token} itens={pedido.dadosPedido?.itens.map((i) => ({ tecidoId: i.tecido.id, nome: i.tecido.nome, corteLaser: i.corteLaser })) ?? []} selecoes={selecoes} aoAlterar={setSelecoes} disabled={salvando} />
        <button type="button" className={primario} disabled={salvando} onClick={() => void operar({ acao: "preview", versao, selecoes }, "preview")}>{salvando ? "Validando na Olist..." : "Revisar pedido"}</button>
      </div> : previa ? <div className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt>Cliente</dt><dd className="break-words font-medium">{previa.cliente}</dd></div><div><dt>Vendedor</dt><dd className="break-words font-medium">{previa.vendedor}</dd></div><div><dt>Forma / plano</dt><dd>{previa.forma} · {previa.plano}</dd></div></dl>
        {previa.payload.itens.map((item, i) => <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm"><p className="break-words font-medium">{previa.produtos[`${item.produto.tipo}:${item.produto.id}`] ?? previa.produtos[item.produto.id]} · ID {item.produto.id}</p><p>{item.quantidade} m × {moeda(item.valorUnitario)} = {moeda(item.quantidade * item.valorUnitario)}</p><p className="whitespace-pre-wrap break-words">{item.infoAdicional}</p></div>)}
        <p className="font-semibold">Total: {moeda(previa.payload.itens.reduce((v, i) => v + i.quantidade * i.valorUnitario, 0))}</p>
        <ul className="text-sm">{previa.payload.pagamento.parcelas.map((p, i) => <li key={i}>Parcela {i + 1}: {p.dias} dias · {moeda(p.valor)}</li>)}</ul>
        <p className="whitespace-pre-wrap break-words text-sm">{previa.payload.observacoes}</p><p className="whitespace-pre-wrap break-words text-sm">{previa.payload.observacoesInternas}</p>
        <div className="flex flex-wrap gap-3"><button type="button" className={botao} disabled={salvando} onClick={() => setPrevia(null)}>Voltar e corrigir</button><button type="button" className={primario} disabled={salvando} onClick={() => void operar({ acao: "confirmar", previaId: previa.previaId }, "confirmar")}>{salvando ? "Criando pedido..." : "Confirmar e criar na Olist"}</button></div>
      </div> : null}
      <div className="flex justify-end border-t border-slate-200 pt-4"><button type="button" className={botao} disabled={salvando} onClick={fechar}>{alterado.current ? "Fechar e atualizar fila" : "Fechar"}</button></div>
    </div>
  </dialog>, document.body);
}
