"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Send } from "lucide-react";
import { EnviarPedidoFilaOlist } from "@/components/enviar-pedido-fila-olist";
import { filtrosStatusFila, rotulosStatusFila } from "@/lib/fila-fornecedor-contrato";
import type { StatusFila, FilialFila, ListaFilaAdministracao, PedidoFilaAdministracao, SituacaoFila } from "@/lib/fila-fornecedor-contrato";

const API = "/api/fornecedores/fila/administracao";
const secundario = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50";
const primario = "min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50";
const dataHora = (valor: string) => new Date(valor).toLocaleString("pt-BR");

function MaisOpcoesFila({ disabled, aoEnviar, consulta = false }: { disabled: boolean; aoEnviar: () => void; consulta?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!aberto) return;
    function fecharFora(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setAberto(false);
    }
    document.addEventListener("pointerdown", fecharFora);
    return () => document.removeEventListener("pointerdown", fecharFora);
  }, [aberto]);
  return (
    <div ref={container} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAberto(false); }} onKeyDown={(event) => {
      if (event.key === "Escape" && aberto) { event.preventDefault(); event.stopPropagation(); setAberto(false); botao.current?.focus(); }
    }}>
      <button ref={botao} type="button" disabled={disabled} aria-expanded={aberto} aria-controls={painelId}
        onClick={() => setAberto((valor) => !valor)} className={`${secundario} inline-flex items-center gap-2`}>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />Mais opções
      </button>
      {aberto && !disabled && (
        <div id={painelId} role="group" aria-label="Mais opções do pedido" className="absolute right-0 z-10 mt-2 w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <button type="button" onClick={() => { setAberto(false); botao.current?.focus(); aoEnviar(); }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500">
            <Send className="h-4 w-4 shrink-0" aria-hidden="true" />{consulta ? "Consultar envio na Olist" : "Enviar para a Olist"}
          </button>
        </div>
      )}
    </div>
  );
}

function PedidoFilaCard({ pedido, filiais, token, aoSalvar, aoAtualizar }: {
  pedido: PedidoFilaAdministracao; filiais: FilialFila[]; token: string; aoSalvar: (filial: string, status: StatusFila) => void; aoAtualizar: () => void;
}) {
  const [filialId, setFilialId] = useState(pedido.filial?.id ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const podeAlterar = pedido.status === "PENDENTE" || pedido.status === "FALHADO";
  const [conflito, setConflito] = useState(false);
  const envioEmAndamento = useRef(false);
  const filialAtualDisponivel = !pedido.filial || filiais.some((filial) => filial.id === pedido.filial?.id);

  async function direcionar(event: React.FormEvent) {
    event.preventDefault();
    if (envioEmAndamento.current || !filialId || conflito || !podeAlterar) return;
    await salvarFilial(false);
  }

  async function salvarFilial(enviarOlist: boolean) {
    if (envioEmAndamento.current || !filialId || conflito || !podeAlterar) return;
    envioEmAndamento.current = true;
    setSalvando(true);
    setErro("");
    try {
      const response = await fetch(API, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId: pedido.id, filialId, versao: pedido.versao, enviarOlist }),
      });
      const json = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflito(true);
        throw new Error(json.error || "Não foi possível direcionar o pedido.");
      }
      setConfirmando(false);
      aoSalvar(filiais.find((filial) => filial.id === filialId)?.nome ?? "selecionada", json.status);
    } catch (error) { setErro(error instanceof Error ? error.message : "Falha ao direcionar o pedido."); }
    finally { envioEmAndamento.current = false; setSalvando(false); }
  }

  return (
    <article className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby={`pedido-${pedido.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`pedido-${pedido.id}`} className="break-words font-semibold text-slate-900">{pedido.origem}</h3>
          <p className="mt-1 break-all text-xs text-slate-500">Pedido da fila: {pedido.id}</p>
          <p className="mt-1 break-all text-xs text-slate-500">Solicitação de produção: {pedido.solicitacaoProducaoId}</p>
          <p className="mt-1 text-xs text-slate-500">Recebido em {dataHora(pedido.createdAt)}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">{rotulosStatusFila[pedido.status]}</span>
      </div>
      {pedido.filial && <p className="break-words text-sm text-slate-600">Filial atual: <strong>{pedido.filial.nome}</strong>{pedido.direcionadoEm ? ` · ${dataHora(pedido.direcionadoEm)}` : ""}</p>}
      {pedido.dadosPedido ? (
        <details className="rounded-md border border-slate-200">
          <summary className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2">Consultar itens ({pedido.dadosPedido.itens.length})</summary>
          <div className="space-y-3 border-t border-slate-200 p-3">
            {pedido.dadosPedido.itens.map((item, index) => (
              <div key={`${item.produtoId}-${index}`} className="space-y-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <p className="break-words font-medium">{item.tecido.nome}{item.tecido.referencia ? ` · Ref. ${item.tecido.referencia}` : ""}</p>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div><dt className="text-xs text-slate-500">Quantidade do pedido</dt><dd>{item.quantidade.toLocaleString("pt-BR")} un.</dd></div>
                  <div><dt className="text-xs text-slate-500">Consumo de tecido</dt><dd>{item.quantidadeTecido.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} m</dd></div>
                  <div><dt className="text-xs text-slate-500">Estampa / variante</dt><dd className="break-words">{item.estampa || "Não informada"}{item.variante ? ` / ${item.variante}` : ""}</dd></div>
                  <div><dt className="text-xs text-slate-500">Corte a laser</dt><dd>{item.corteLaser ? "Sim" : "Não"}</dd></div>
                  <div><dt className="text-xs text-slate-500">Tamanho</dt><dd className="break-words">{item.tamanho || "Não informado"}</dd></div>
                  <div><dt className="text-xs text-slate-500">Tipo de produto</dt><dd className="break-words">{item.tipoProduto || "Não informado"}</dd></div>
                </dl>
                <p className="break-all text-xs text-slate-500">SKU: {item.sku}</p>
              </div>
            ))}
            {pedido.dadosPedido.observacao && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">Observação: {pedido.dadosPedido.observacao}</p>}
          </div>
        </details>
      ) : <p role="alert" className="text-sm text-red-700">Os dados deste pedido estão em um formato não reconhecido.</p>}
      <form onSubmit={direcionar} className="space-y-3" aria-busy={salvando}>
        <label htmlFor={`filial-${pedido.id}`} className="block text-sm font-medium text-slate-700">{pedido.filial ? "Trocar filial" : "Direcionar para filial"}</label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <select id={`filial-${pedido.id}`} required className="input min-h-11 min-w-0 flex-1 sm:w-auto" value={filialId} disabled={salvando || conflito || !podeAlterar || filiais.length === 0} onChange={(event) => setFilialId(event.target.value)}>
            <option value="">Selecione a filial</option>
            {!filialAtualDisponivel && pedido.filial && <option value={pedido.filial.id} disabled>{pedido.filial.nome} (sem vínculo atual)</option>}
            {filiais.map((filial) => <option key={filial.id} value={filial.id}>{filial.nome}</option>)}
          </select>
          <div className="flex flex-wrap items-start gap-2">
            <button type="submit" className={primario} disabled={salvando || conflito || !podeAlterar || !filialId || !filiais.some((filial) => filial.id === filialId)}>
              {salvando ? "Salvando..." : "Salvar filial"}
            </button>
            <MaisOpcoesFila
              consulta={pedido.status === "PROCESSAR" || pedido.status === "CONCLUIDO"}
              disabled={salvando || conflito || pedido.status === "CANCELADO" || !filialId || filialId !== pedido.filial?.id}
              aoEnviar={() => { setErro(""); setConfirmando(true); }}
            />
          </div>
        </div>
        {erro && !confirmando && <p role="alert" className="break-words text-sm text-red-700">{erro}</p>}
        {conflito && <button type="button" onClick={aoAtualizar} className={secundario}>Atualizar fila</button>}
      </form>
      {filialId && filialId !== pedido.filial?.id && <p className="text-sm text-slate-600">Salve a filial antes de configurar o envio para a Olist.</p>}
      {pedido.status === "PROCESSAR" && <p className="text-sm text-slate-600">Envio reservado. Consulte o resultado em Mais opções antes de tentar novamente.</p>}
      {confirmando && <EnviarPedidoFilaOlist pedido={pedido} token={token} aoFechar={() => setConfirmando(false)} aoConcluir={aoAtualizar} />}
    </article>
  );
}

export function FilaPedidosFornecedorClient({ token }: { token: string }) {
  const [situacao, setSituacao] = useState<SituacaoFila>("pendente");
  const [pagina, setPagina] = useState(1);
  const [atualizacao, setAtualizacao] = useState(0);
  const [dados, setDados] = useState<ListaFilaAdministracao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const mensagemRef = useRef<HTMLParagraphElement>(null);
  const focarAtualizacao = useRef(false);

  useEffect(() => { if (!carregando && focarAtualizacao.current) { focarAtualizacao.current = false; mensagemRef.current?.focus(); } }, [carregando]);
  useEffect(() => { if (mensagem) mensagemRef.current?.focus(); }, [mensagem]);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setErro("");
    async function carregar() {
      try {
        const query = new URLSearchParams({ situacao, pagina: String(pagina) });
        const response = await fetch(`${API}?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar a fila.");
        if (!controller.signal.aborted) setDados(json);
      } catch (error) {
        if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Falha ao carregar a fila.");
      } finally { if (!controller.signal.aborted) setCarregando(false); }
    }
    void carregar();
    return () => controller.abort();
  }, [token, situacao, pagina, atualizacao]);

  function atualizar() { setAtualizacao((valor) => valor + 1); }
  function atualizarAposEnvio() { focarAtualizacao.current = true; setMensagem("Resultado atualizado. Consulte o status do pedido na fila."); atualizar(); }
  function aoSalvar(filial: string, status: StatusFila) {
    setMensagem(`Pedido atribuído a ${filial}. Status: ${rotulosStatusFila[status]}.`);
    atualizar();
  }

  return (
    <section className="space-y-4" aria-label="Administração da fila de pedidos">
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:w-64">
          <label htmlFor="situacao-fila" className="mb-2 block text-sm font-medium text-slate-700">Status</label>
          <select id="situacao-fila" className="input min-h-11" value={situacao} onChange={(event) => { setSituacao(event.target.value as SituacaoFila); setPagina(1); setMensagem(""); }}>
            {Object.entries(filtrosStatusFila).map(([valor, status]) => <option key={valor} value={valor}>{rotulosStatusFila[status]}</option>)}
            <option value="todos">Todos</option>
          </select>
        </div>
        <button type="button" onClick={atualizar} disabled={carregando} className={secundario}>Atualizar fila</button>
      </div>
      {mensagem && <p ref={mensagemRef} tabIndex={-1} role="status" className="break-words rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">{mensagem}</p>}
      {erro && <div role="alert" className="rounded-lg border border-red-200 bg-white p-5"><p className="mb-3 text-sm text-red-700">{erro}</p><button type="button" onClick={atualizar} className={secundario}>Tentar novamente</button></div>}
      {carregando ? <p role="status" className="text-sm text-slate-600">Carregando fila de pedidos...</p> : !erro && dados ? (
        <>
          {dados.filiais.length === 0 && <p role="status" className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">Seu aplicativo não possui filiais vinculadas. Vincule uma filial para direcionar os pedidos.</p>}
          <p role="status" className="text-sm text-slate-600">{dados.total} pedido(s) com o filtro selecionado.</p>
          {dados.pedidos.length === 0 ? <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">Nenhum pedido encontrado nesta página.</p> : dados.pedidos.map((pedido) => (
            <PedidoFilaCard key={`${pedido.id}-${pedido.versao}`} pedido={pedido} filiais={dados.filiais} token={token} aoSalvar={aoSalvar} aoAtualizar={atualizarAposEnvio} />
          ))}
          <nav aria-label="Páginas da fila" className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={pagina === 1} onClick={() => setPagina((valor) => valor - 1)} className={secundario}>Anterior</button>
            <span className="text-sm text-slate-600">Página {pagina} de {Math.max(1, Math.ceil(dados.total / dados.porPagina))}</span>
            <button type="button" disabled={pagina * dados.porPagina >= dados.total} onClick={() => setPagina((valor) => valor + 1)} className={secundario}>Próxima</button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
