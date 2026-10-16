"use client";

import { useEffect, useRef, useState } from "react";
import type { DetalheFilaProducao, ResumoFilaProducao } from "@/lib/fila-fornecedor-contrato";

type Props = { solicitacaoId: string; token: string; onClose: () => void; onAtualizado: (fila: ResumoFilaProducao) => void };
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2";
const dataHora = (valor: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(valor));

export function DetalhesFilaProducao({ solicitacaoId, token, onClose, onAtualizado }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const [pedido, setPedido] = useState<DetalheFilaProducao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    const elemento = dialog.current;
    const anterior = document.activeElement;
    elemento?.showModal(); fechar.current?.focus();
    return () => { elemento?.close(); if (anterior instanceof HTMLElement) anterior.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPedido(null); setErro(null);
    void (async () => {
      try {
        const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(solicitacaoId)}/fila-fornecedor`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        const json = await response.json() as { pedido?: DetalheFilaProducao; error?: string };
        if (!response.ok || !json.pedido) throw new Error(json.error ?? "Não foi possível carregar o envio.");
        if (!controller.signal.aborted) { setPedido(json.pedido); onAtualizado(json.pedido); }
      } catch (error) { if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Não foi possível carregar o envio."); }
    })();
    return () => controller.abort();
  }, [solicitacaoId, token, tentativa, onAtualizado]);
  return <dialog ref={dialog} aria-labelledby="detalhes-fila-titulo" onCancel={onClose} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-black/50">
    <div className="flex max-h-[90dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-6">
        <h2 id="detalhes-fila-titulo" className="text-lg font-semibold">Detalhes do envio à fila</h2>
        <button ref={fechar} type="button" className={botao} onClick={onClose}>Fechar</button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-6">
        {erro ? <div className="space-y-3"><p role="alert" className="text-sm text-red-700">{erro}</p><button type="button" className={botao} onClick={() => setTentativa((atual) => atual + 1)}>Tentar novamente</button></div> : !pedido ? <p role="status">Carregando detalhes do envio...</p> : <>
          <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
            {[["Status da fila", pedido.status], ["Fornecedor", pedido.fornecedor], ["Filial", pedido.filial?.nome ?? "Não selecionada"], ["Enviado em · Brasília", dataHora(pedido.createdAt)], ["Direcionado em · Brasília", pedido.direcionadoEm ? dataHora(pedido.direcionadoEm) : "Não direcionado"], ["ID do envio", pedido.id]].map(([rotulo, valor]) => <div key={rotulo} className="min-w-0"><dt className="text-slate-500">{rotulo}</dt><dd className="mt-1 break-words font-medium">{valor}</dd></div>)}
          </dl>
          {!pedido.dadosPedido ? <p role="status" className="text-sm text-slate-600">Os dados dos itens deste envio estão indisponíveis.</p> : <>
            <section className="space-y-2"><h3 className="text-sm font-semibold">Observação enviada</h3><p className="whitespace-pre-wrap break-words text-sm">{pedido.dadosPedido.observacao || "Nenhuma observação informada."}</p></section>
            <section className="space-y-3"><h3 className="text-sm font-semibold">Itens enviados</h3>
              {pedido.dadosPedido.itens.map((item, index) => <article key={`${item.produtoId}-${index}`} className="min-w-0 rounded-md border border-slate-200 p-4 text-sm">
                <h4 className="break-all font-semibold">{item.sku}</h4>
                <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                  {[["Tecido", [item.tecido.nome, item.tecido.referencia].filter(Boolean).join(" · ")], ["Quantidade", `${item.quantidade} UN`], ["Consumo de tecido", `${item.quantidadeTecido} MT`], ["Estampa", item.estampa || "—"], ["Variante", item.variante || "—"], ["Tamanho", item.tamanho || "—"], ["Tipo de produto", item.tipoProduto || "—"], ["Corte a laser", item.corteLaser ? "Sim" : "Não"]].map(([rotulo, valor]) => <div key={rotulo} className="min-w-0"><dt className="text-slate-500">{rotulo}</dt><dd className="mt-1 break-words">{valor}</dd></div>)}
                </dl>
              </article>)}
            </section>
          </>}
        </>}
      </div>
    </div>
  </dialog>;
}
