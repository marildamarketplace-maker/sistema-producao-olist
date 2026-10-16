"use client";

import { useEffect, useRef, useState } from "react";
import { montarEdicaoPedidoFila, type PedidoFornecedorEditavel, type TecidoFilaOpcao } from "@/lib/pedido-fornecedor-edicao";
import type { DadosPedidoFila } from "@/lib/fila-fornecedor-contrato";

type Props = { solicitacaoId: string; token: string; onClose: () => void };
type Fornecedor = { id: string; nome: string };
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-50";

export function EnviarFilaFornecedor({ solicitacaoId, token, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tituloEtapa = useRef<HTMLHeadingElement>(null);
  const erroRef = useRef<HTMLParagraphElement>(null);
  const sucessoRef = useRef<HTMLParagraphElement>(null);
  const enviandoRef = useRef(false);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [fornecedorId, setFornecedorId] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [dadosOriginais, setDadosOriginais] = useState<DadosPedidoFila | null>(null);
  const [edicao, setEdicao] = useState<PedidoFornecedorEditavel | null>(null);
  const [tecidos, setTecidos] = useState<TecidoFilaOpcao[]>([]);
  const [revisao, setRevisao] = useState("");

  useEffect(() => {
    const elemento = dialog.current;
    const focoAnterior = document.activeElement;
    elemento?.showModal();
    elemento?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {
      elemento?.close();
      if (focoAnterior instanceof HTMLElement) focoAnterior.focus();
    };
  }, []);
  useEffect(() => { if (etapa === 2) tituloEtapa.current?.focus(); }, [etapa]);
  useEffect(() => { if (sucesso) sucessoRef.current?.focus(); }, [sucesso]);
  useEffect(() => { if (erro) erroRef.current?.focus(); }, [erro]);
  useEffect(() => {
    if (!carregando && etapa === 1 && !sucesso) dialog.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, [carregando, etapa, sucesso]);

  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      try {
        const response = await fetch("/api/fornecedores/fila", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Erro ao carregar fornecedores.");
        if (!controller.signal.aborted) setFornecedores(json.fornecedores);
      } catch (error) {
        if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Erro ao carregar fornecedores.");
      } finally { if (!controller.signal.aborted) setCarregando(false); }
    }
    void carregar();
    return () => controller.abort();
  }, [token]);

  async function carregarRevisao() {
    if (!fornecedorId || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErro("");
    try {
      const response = await fetch("/api/fornecedores/fila", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fornecedorId, solicitacaoId, acao: "preview" }),
      });
      const json = await response.json() as { dadosPedido: DadosPedidoFila; tecidos: TecidoFilaOpcao[]; revisao: string; error?: string };
      if (!response.ok) throw new Error(json.error || "Erro ao preparar revisão.");
      setDadosOriginais(json.dadosPedido);
      setEdicao(montarEdicaoPedidoFila(json.dadosPedido));
      setTecidos(json.tecidos);
      setRevisao(json.revisao);
      setEtapa(2);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro ao preparar revisão."); }
    finally { enviandoRef.current = false; setEnviando(false); }
  }

  async function enviar(event: React.FormEvent) {
    event.preventDefault();
    if (!fornecedorId || enviandoRef.current || sucesso) return;
    if (etapa === 1) {
      if (edicao) { setErro(""); setEtapa(2); }
      else await carregarRevisao();
      return;
    }
    if (!edicao) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErro("");
    try {
      const response = await fetch("/api/fornecedores/fila", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fornecedorId, solicitacaoId, dadosEditados: edicao, revisao }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Erro ao enviar para a fila.");
      setSucesso(true);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro ao enviar para a fila."); }
    finally { enviandoRef.current = false; setEnviando(false); }
  }

  function alterarItem(index: number, patch: Partial<PedidoFornecedorEditavel["itens"][number]>) {
    setEdicao((atual) => atual ? { ...atual, itens: atual.itens.map((item, i) => i === index ? { ...item, ...patch } : item) } : atual);
  }

  return (
    <dialog ref={dialog} aria-labelledby="fila-fornecedor-titulo" onCancel={(event) => { if (enviando) event.preventDefault(); else onClose(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-black/50">
      <form onSubmit={enviar} className="flex max-h-[90dvh] flex-col" aria-busy={enviando}>
        <header className="shrink-0 border-b border-slate-200 p-5 sm:p-6">
          <h2 id="fila-fornecedor-titulo" className="text-lg font-semibold">Enviar para fila do Fornecedor</h2>
          {!sucesso && <p className="mt-1 text-sm text-slate-600">Etapa {etapa} de 2 · {etapa === 1 ? "Selecionar fornecedor" : "Revisar e editar pedido"}</p>}
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 sm:p-6">
          {erro && <p ref={erroRef} tabIndex={-1} role="alert" className="break-words text-sm text-red-700">{erro}</p>}
          {sucesso ? <p ref={sucessoRef} tabIndex={-1} role="status" className="text-sm text-emerald-700">Solicitação registrada na fila do fornecedor.</p> : etapa === 1 ? (
            <>
              <label htmlFor="fila-fornecedor" className="block text-sm font-medium">Selecione o fornecedor</label>
              <select autoFocus id="fila-fornecedor" required className="input min-h-11 w-full" value={fornecedorId} onChange={(event) => { setFornecedorId(event.target.value); setEdicao(null); setDadosOriginais(null); setRevisao(""); setErro(""); }} disabled={carregando || enviando}>
                <option value="">{carregando ? "Carregando..." : "Selecione"}</option>
                {fornecedores.map((fornecedor) => <option key={fornecedor.id} value={fornecedor.id}>{fornecedor.nome}</option>)}
              </select>
              {!carregando && !fornecedores.length && <p role="status" className="text-sm text-slate-600">Nenhum fornecedor com aplicativo pai vinculado disponível.</p>}
            </>
          ) : edicao && dadosOriginais ? (
            <>
              <h3 ref={tituloEtapa} tabIndex={-1} className="break-words font-semibold">Revisar pedido para {fornecedores.find((fornecedor) => fornecedor.id === fornecedorId)?.nome}</h3>
              <p className="text-sm text-slate-600">Confira os dados que serão enviados. As alterações valem apenas para este pedido da fila; a solicitação original será preservada. Quantidade de peças e consumo em metros podem ser ajustados separadamente.</p>
              {edicao.itens.map((item, index) => (
                <fieldset key={`${item.produtoId}-${index}`} disabled={enviando} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-4">
                  <legend className="px-1 text-sm font-semibold">Item {index + 1}</legend>
                  <p className="break-all text-xs text-slate-500">SKU da solicitação: {dadosOriginais.itens[index].sku}</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="min-w-0 text-sm">Tecido<select required value={item.tecidoId} onChange={(event) => alterarItem(index, { tecidoId: event.target.value })} className="input mt-1 min-h-11">
                      <option value="">Selecione</option>
                      {tecidos.map((tecido) => <option key={tecido.id} value={tecido.id}>{tecido.nome}{tecido.referencia ? ` · ${tecido.referencia}` : ""}</option>)}
                    </select></label>
                    <label className="text-sm">Quantidade de peças (UN)<input required type="number" min={1} max={2147483647} step={1} value={item.quantidade} onChange={(event) => alterarItem(index, { quantidade: Number(event.target.value) })} className="input mt-1 min-h-11" /></label>
                    <label className="text-sm">Quantidade de tecido (MT)<input required type="number" min={0.000001} max={1000000000} step="0.000001" value={item.quantidadeTecido} onChange={(event) => alterarItem(index, { quantidadeTecido: Number(event.target.value) })} className="input mt-1 min-h-11" /></label>
                    <label className="text-sm">Estampa<input maxLength={500} value={item.estampa} onChange={(event) => alterarItem(index, { estampa: event.target.value })} className="input mt-1 min-h-11" /></label>
                    <label className="text-sm">Variante (opcional)<input maxLength={500} value={item.variante ?? ""} onChange={(event) => alterarItem(index, { variante: event.target.value || null })} className="input mt-1 min-h-11" /></label>
                    <label className="text-sm">Tamanho<input maxLength={500} value={item.tamanho} onChange={(event) => alterarItem(index, { tamanho: event.target.value })} className="input mt-1 min-h-11" /></label>
                    <label className="text-sm">Tipo de produto<input maxLength={500} value={item.tipoProduto} onChange={(event) => alterarItem(index, { tipoProduto: event.target.value })} className="input mt-1 min-h-11" /></label>
                    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={item.corteLaser} onChange={(event) => alterarItem(index, { corteLaser: event.target.checked })} className="h-5 w-5" />Corte a laser</label>
                  </div>
                </fieldset>
              ))}
              <label className="block text-sm">Observação do pedido<textarea disabled={enviando} maxLength={5000} value={edicao.observacao ?? ""} onChange={(event) => setEdicao((atual) => atual ? { ...atual, observacao: event.target.value || null } : atual)} className="input mt-1 min-h-24" /></label>
              <button type="button" disabled={enviando} onClick={() => void carregarRevisao()} className={botao}>Descartar edições e recarregar dados</button>
            </>
          ) : null}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200 p-4">
          <button type="button" onClick={onClose} disabled={enviando} className={botao}>{sucesso ? "Fechar" : "Cancelar"}</button>
          {!sucesso && etapa === 2 && <button type="button" onClick={() => { setEtapa(1); setErro(""); }} disabled={enviando} className={botao}>Voltar</button>}
          {!sucesso && <button type="submit" disabled={!fornecedorId || carregando || enviando || (etapa === 2 && !edicao)} className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 disabled:opacity-50">{enviando ? etapa === 1 ? "Preparando..." : "Enviando..." : etapa === 1 ? "Revisar pedido" : "Confirmar e enviar para fila"}</button>}
        </footer>
      </form>
    </dialog>
  );
}
