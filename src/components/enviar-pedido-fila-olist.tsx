"use client";
import { useEffect, useId, useRef, useState } from "react";
import { detalharErrosFilaOlist, type ErrosComerciaisFila } from "@/lib/fila-olist-validacao";
import { PessoasDestinoFila } from "@/components/pessoas-destino-fila";
import { DadosComerciaisFilaOlist } from "@/components/dados-comerciais-fila-olist";
import { criarRascunhoFilaOlist, mesclarSelecoesRecuperadas, serializarRascunhoFilaOlist, selecoesFilaOlistSchema } from "@/lib/fila-olist-contrato";
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
type Recuperacao = { campos: Array<{ chave: string; estado: "RECUPERADO" | "PENDENTE"; mensagem: string }>; restantes: string[] };
type Previa = { previaId: string; payload: PedidoPrevia; produtos: Record<string, string>; cliente: string; vendedor: string; forma: string; plano: string };

function rotuloCampo(chave: string, pedido: PedidoFilaAdministracao) {
  const nomes: Record<string, string> = { clienteId: "Cliente", vendedorId: "Vendedor", formaId: "Forma de recebimento", planoId: "Plano de recebimento", laser: "Corte a laser" };
  return nomes[chave] ?? `Produto ${pedido.dadosPedido?.itens.find(i => i.tecido.id === chave.slice(7))?.tecido.nome ?? "do pedido"}`;
}
export function EnviarPedidoFilaOlist({ pedido, token, aoFechar, aoConcluir }: { pedido: PedidoFilaAdministracao; token: string; aoFechar: () => void; aoConcluir: () => void }) {
  const api = `/api/fornecedores/fila/${pedido.id}/olist`;
  const dialog = useRef<HTMLDialogElement>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const tituloId = useId();
  const ocupado = useRef(false);
  const alterado = useRef(false);
  const contaInicializada = useRef("");
  const vendedorVinculadoId = useRef<number | null>(null);
  const [recuperacao, setRecuperacao] = useState<Recuperacao | null>(null);
  const [recuperando, setRecuperando] = useState(false);
  const [tentativaRecuperacao, setTentativaRecuperacao] = useState(0);
  const [edicaoManual, setEdicaoManual] = useState(false);
  const [temEdicoes, setTemEdicoes] = useState(false);
  const edicaoManualRef = useRef(false); edicaoManualRef.current = edicaoManual || temEdicoes;
  const [editarDados, setEditarDados] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [errosCampos, setErrosCampos] = useState<ErrosComerciaisFila>({});
  const [mensagem, setMensagem] = useState("");
  const [vendedorFixo, setVendedorFixo] = useState(false);
  const [origemVinculada, setOrigemVinculada] = useState(false);
  const [vendedorFonte, setVendedorFonte] = useState<"VINCULO" | "MANUAL">("MANUAL");
  const [escolhaManualConfirmada, setEscolhaManualConfirmada] = useState(false);
  const [envio, setEnvio] = useState<EstadoEnvioFila | null>(null);
  const [versao, setVersao] = useState(pedido.versao);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [idExistente, setIdExistente] = useState("");
  const [ausencia, setAusencia] = useState(false);
  const [selecoes, setSelecoes] = useState<RascunhoFilaOlist>(() => criarRascunhoFilaOlist(pedido.dadosPedido?.itens.map((i) => i.tecido.id) ?? []));
  const bloqueado = !!envio && !["LIBERADO", "REJEITADO"].includes(envio.estado);
  const temPendencias = !!recuperacao && (!selecoesFilaOlistSchema.safeParse(selecoes).success || pedido.dadosPedido?.itens.some(i => i.corteLaser) && !selecoes.laser);
  const concluido = envio?.estado === "CONCLUIDO" || pedido.status === "CONCLUIDO";
  useEffect(() => {
    const anterior = document.activeElement, elemento = dialog.current; elemento?.showModal();
    return () => { elemento?.close(); if (anterior instanceof HTMLElement) anterior.focus(); };
  }, []);
  async function requisitar(body?: unknown) {
    const response = await fetch(api, { method: body ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const dados = await response.json(); if (!response.ok) {
      if (dados.campos && typeof dados.campos === "object" && !Array.isArray(dados.campos)) {
        const campos = Object.fromEntries(Object.entries(dados.campos).filter(([k,v]) => /^(clienteId|vendedorId|formaId|planoId|tipoVenda|laser(\.(id|preco))?|tecidos(\.\d+(\.(id|preco|tecidoId))?)?)$/.test(k) && typeof v === "string"));
        setErrosCampos(campos as ErrosComerciaisFila); if (Object.keys(campos).length) { setEditarDados(true); setEdicaoManual(true); }
      }
      throw new Error(dados.error || "Falha na operação.");
    } return dados;
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(async (d) => {
        if (controller.signal.aborted) return;
        setEnvio(d.envio);
        if (d.envio?.estado === "REJEITADO" && d.envio.diagnostico) setErro(d.envio.diagnostico);
        if (pedido.status === "PROCESSAR" && d.envio?.estado === "INCERTO") alterado.current = true;
        const conta = `${api}:${d.filial.id}:${pedido.versao}`;
        const inicializar = contaInicializada.current !== conta;
        const recuperar = inicializar || tentativaRecuperacao > 0 || d.recuperacao?.restantes.length > 0;
        if (contaInicializada.current !== conta) {
          setEditarDados(!(d.selecoes?.recursoForma === "RECEBIMENTO" && pedido.dadosPedido?.olist?.filialId === d.filial.id));
          setVendedorFixo(Boolean(d.vendedorFixo) && (pedido.tipoOrigem === "MANUAL" || d.vendedorOrigem?.aplicativoId === d.filial.id));
          vendedorVinculadoId.current = d.vendedorOrigem?.tipo === "VINCULO" ? d.vendedorOrigem.vendedorOlistId : null;
          setOrigemVinculada(d.vendedorOrigem?.tipo === "VINCULO" && d.vendedorOrigem?.aplicativoId === d.filial.id);
          setVendedorFonte(d.vendedorOrigem?.tipo === "VINCULO" && d.vendedorOrigem?.aplicativoId === d.filial.id ? "VINCULO" : "MANUAL");
          setEscolhaManualConfirmada(Boolean(d.vendedorOrigem));
          setSelecoes(criarRascunhoFilaOlist(pedido.dadosPedido?.itens.map((i) => i.tecido.id) ?? [], d.selecoes ?? undefined, d.recuperacao ? null : d.vendedorOlistPadraoId));
          contaInicializada.current = conta;
          setVersao(d.versao ?? pedido.versao);
          setPrevia(null);
          setRecuperacao(d.recuperacao ?? null);
          if (d.recuperacao) setEditarDados(true);
        }
        if (!recuperar || edicaoManualRef.current || !d.recuperacao || d.envio && !["LIBERADO", "REJEITADO"].includes(d.envio.estado)) return;
        const chaves: string[] = tentativaRecuperacao > 0
          ? [...d.recuperacao.restantes, ...d.recuperacao.campos.filter((c: Recuperacao["campos"][number]) => c.estado === "PENDENTE").map((c: Recuperacao["campos"][number]) => c.chave)]
          : [...d.recuperacao.restantes];
        chaves.sort((a, b) => (a === "planoId" ? 1 : 0) - (b === "planoId" ? 1 : 0));
        if (!chaves.length) { setEditarDados(true); return; }
        setCarregando(false);
        setRecuperando(true); setEditarDados(true);
        let versaoAtual = d.versao ?? pedido.versao;
        for (const chave of chaves) {
          if (controller.signal.aborted) return;
          alterado.current = true;
          const r = await fetch(api, { method: "POST", signal: controller.signal, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ acao: "recuperar", versao: versaoAtual, filialId: d.filial.id, chave }) });
          const resultado = await r.json();
          if (!r.ok) throw new Error(resultado.error || "A recuperação foi interrompida. Os cadastros já recuperados foram preservados.");
          if (controller.signal.aborted) return;
          versaoAtual = resultado.versao;
          setVersao(versaoAtual);
          setRecuperacao(atual => atual ? { campos: [...atual.campos.filter(c => c.chave !== chave), resultado.campo], restantes: atual.restantes.filter(c => c !== chave) } : null);
          setSelecoes(atual => criarRascunhoFilaOlist(pedido.dadosPedido?.itens.map(i => i.tecido.id) ?? [], mesclarSelecoesRecuperadas(serializarRascunhoFilaOlist(atual), resultado.alteracoes)));
          alterado.current = true;
        }
      })
      .catch((e) => { if (!controller.signal.aborted) setErro(e.message); }).finally(() => { if (!controller.signal.aborted) { setCarregando(false); setRecuperando(false); } });
    return () => controller.abort();
  }, [api, token, pedido.status, pedido.dadosPedido, pedido.filial?.id, pedido.versao, pedido.tipoOrigem, tentativaRecuperacao]);
  useEffect(() => { if (erro || mensagem || previa) alerta.current?.focus(); }, [erro, mensagem, previa]);
  useEffect(() => {
    const chave = Object.keys(errosCampos)[0];
    if (!chave) return;
    const alvo = [...(dialog.current?.querySelectorAll<HTMLElement>("[data-campo-comercial]") ?? [])].find(el => el.dataset.campoComercial === chave);
    const campo = alvo?.querySelector<HTMLElement>("select, [aria-expanded], input, button");
    campo?.focus(); campo?.scrollIntoView({ block: "nearest" });
  }, [errosCampos]);
  async function operar(body: unknown, acao: "preview" | "confirmar" | "conciliar") {
    if (ocupado.current) return;
    if (acao === "preview") {
      const validacao = selecoesFilaOlistSchema.safeParse(selecoes);
      const campos = validacao.success ? {} : detalharErrosFilaOlist(validacao.error).campos;
      if (pedido.dadosPedido?.itens.some(i => i.corteLaser) && !selecoes.laser) campos.laser = "Selecione o serviço de corte a laser e informe o preço por metro.";
      if (Object.keys(campos).length) {
        setErrosCampos(campos); setErro(Object.values(campos).join(" ")); setEditarDados(true); setEdicaoManual(true); return;
      }
    }
    setErrosCampos({});
    ocupado.current = true; setSalvando(true); setErro("");
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
  function alterarEscolhaManual(escolhaManual: boolean) {
    setEditarDados(true);
    setEscolhaManualConfirmada(escolhaManual);
    setVendedorFonte(escolhaManual ? "MANUAL" : origemVinculada ? "VINCULO" : "MANUAL");
    setVendedorFixo(origemVinculada && !escolhaManual);
    if (origemVinculada && !escolhaManual) {
      setSelecoes(atuais => ({ ...atuais, vendedorId: vendedorVinculadoId.current ?? 0, clienteId: 0 }));
    }
  }
  function fechar() { aoFechar(); if (alterado.current) aoConcluir(); }
  return createPortal(<dialog ref={dialog} aria-labelledby={tituloId}
    onKeyDown={conterFocoNoDialogo} onCancel={(e) => { if (salvando) e.preventDefault(); else fechar(); }}
    className="m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-slate-900 backdrop:bg-black/50 sm:p-6">
    <div className="space-y-4" aria-busy={salvando || carregando || recuperando}>
      <h2 id={tituloId} className="text-lg font-semibold">{concluido ? "Resultado do envio" : "Enviar pedido para a Olist"}</h2>
      <p className="break-words text-sm">Conta destinatária: <strong>{pedido.filial?.nome}</strong>. Os dados revisados da fila serão usados neste pedido.</p>
      <p ref={alerta} tabIndex={-1} role={erro ? "alert" : "status"} className={`break-words text-sm ${erro ? "text-red-700" : "text-slate-600"}`}>{erro || mensagem || (previa ? "Revise os itens e confirme a criação real na Olist." : "Consulte os cadastros e revise todos os valores antes de criar.")}</p>
      {carregando ? <p role="status">Carregando configurações...</p> : envio && bloqueado ? <div className="space-y-3 rounded-md border border-amber-300 p-4">
        <p className="font-medium">{concluido ? "CONCLUIDO" : envio.estado === "RESERVADO" ? "PROCESSAR · envio reservado" : "FALHADO · resultado incerto"}</p>
        <p className="break-words text-sm">Conta da tentativa: <strong>{envio.aplicativoNome ?? envio.aplicativoId}</strong></p>
        {envio.pedidoOlistId && <p className="break-all">ID Olist: {envio.pedidoOlistId}</p>}
        <p className="text-sm">{envio.diagnostico || "A reserva impede criar outro pedido para esta solicitação."}</p>
        {!concluido && <>
          <p className="text-sm">Confira a conta destinatária da tentativa. Uma tentativa interrompida só pode ser conciliada após 10 minutos. O vínculo exige o identificador da fila ou solicitação nas observações internas do pedido Olist.</p>
          <label className="block text-sm">ID do pedido existente<input className="input mt-1 min-h-11" inputMode="numeric" value={idExistente} onChange={(e) => setIdExistente(e.target.value)} /></label>
          <label className="block text-sm">Justificativa da conferência (mínimo 10 caracteres)<textarea className="input mt-1" value={justificativa} maxLength={1000} onChange={(e) => setJustificativa(e.target.value)} /></label>
          <button type="button" className={botao} disabled={salvando || !idExistente || justificativa.trim().length < 10} onClick={() => void operar({ acao: "vincular", pedidoOlistId: idExistente, tentativaId: envio.tentativaId, justificativa }, "conciliar")}>Verificar na Olist e vincular pedido</button>
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={ausencia} onChange={(e) => setAusencia(e.target.checked)} />Conferi a conta Olist da tentativa e confirmo que nenhum pedido foi criado para esta solicitação.</label>
          <button type="button" className={botao} disabled={salvando || !ausencia || justificativa.trim().length < 10 || !!envio.pedidoOlistId} onClick={() => void operar({ acao: "confirmar-ausencia", ausenciaConfirmada: true, tentativaId: envio.tentativaId, justificativa }, "conciliar")}>Registrar ausência e liberar nova tentativa</button>
        </>}
      </div> : !mensagem && !previa ? <div className="space-y-4">
        {envio?.estado === "REJEITADO" && <p role="status" className="rounded-md border border-amber-200 p-3 text-sm text-amber-800">A última tentativa foi rejeitada pela Olist. A fila ficou como Falhado e os dados foram preservados. Corrija os campos indicados e gere uma nova prévia antes de confirmar outro envio.</p>}
        {pedido.tipoOrigem !== "MANUAL" && (origemVinculada || !escolhaManualConfirmada) && <label className="flex min-h-11 items-start gap-3 rounded-md border border-slate-200 p-3 text-sm">
          <input type="checkbox" className="mt-1" disabled={recuperando} checked={vendedorFonte === "MANUAL" && escolhaManualConfirmada} onChange={(event) => alterarEscolhaManual(event.target.checked)} />
          {origemVinculada ? "Usar uma escolha manual de vendedor para este pedido, após revisar os dados comerciais." : "Revisei e confirmo a escolha manual do vendedor deste pedido, que não possui vínculo de origem registrado."}
        </label>}
        {recuperacao && <div className="space-y-2 rounded-md border border-slate-200 p-3 text-sm">
          <p role="status">{recuperando ? `Recuperando cadastros no novo aplicativo · ${recuperacao.campos.length} campos consultados` : "Cadastros do aplicativo destinatário"}</p>
          <p>Os preços recuperados vêm da nova conta. O total será apresentado na revisão.</p>
          {recuperacao.campos.some(c => c.estado === "RECUPERADO") && <p className="break-words">Recuperados: {recuperacao.campos.filter(c => c.estado === "RECUPERADO").map(c => rotuloCampo(c.chave, pedido)).join(", ")}</p>}
          {!recuperando && recuperacao.campos.filter(c => c.estado === "PENDENTE").map(c => <p key={c.chave} className="text-amber-700">{rotuloCampo(c.chave, pedido)}: {c.mensagem}</p>)}
          {!recuperando && !edicaoManual && !temEdicoes && (recuperacao.restantes.length > 0 || recuperacao.campos.some(c => c.estado === "PENDENTE")) && <button type="button" className={botao} onClick={() => { setErro(""); setTentativaRecuperacao(v => v + 1); }}>Tentar recuperar pendências</button>}
          {!recuperando && !edicaoManual && <button type="button" className={botao} onClick={() => setEdicaoManual(true)}>Revisar todos os campos</button>}
        </div>}
        {editarDados && pedido.dadosPedido?.olist && pedido.dadosPedido.olist.selecoes.recursoForma !== "RECEBIMENTO" && <p role="status" className="text-sm text-amber-700">Selecione novamente a forma e o plano de recebimento. Os demais dados do pedido foram preservados.</p>}
        {!editarDados ? <div className="space-y-3 rounded-md border border-slate-200 p-3 text-sm">
          <p className="font-medium">Dados selecionados na criação do pedido</p>
          <dl className="grid gap-3 sm:grid-cols-2">{[["Cliente Olist",selecoes.clienteId||"Pendente"],["Vendedor Olist",selecoes.vendedorId||"Pendente"],["Forma de recebimento",selecoes.formaId||"Pendente"],["Plano",selecoes.planoId||"Pendente"],["Tipo de venda",selecoes.tipoVenda||"Pendente"]].map(([label,valor])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words">{valor}</dd></div>)}</dl>
          <PessoasDestinoFila pedidoId={pedido.id} token={token}/>
          <ul className="divide-y divide-slate-200">{selecoes.tecidos.map(t=><li key={t.tecidoId} className="space-y-1 py-2"><p className="break-words font-medium">{pedido.dadosPedido?.itens.find(i=>i.tecido.id===t.tecidoId)?.tecido.nome||"Produto"}</p><p>Produto Olist: {t.id||"Pendente"} · Preço/m: {t.preco==null?"Pendente":moeda(t.preco)}</p></li>)}</ul>
          {selecoes.laser && <p>Corte a laser: ID {selecoes.laser.id} · Preço/m: {selecoes.laser.preco==null?"Pendente":moeda(selecoes.laser.preco)}</p>}
          <button type="button" className={botao} disabled={salvando} onClick={()=>setEditarDados(true)}>Editar dados comerciais</button>
        </div> : <>
        <DadosComerciaisFilaOlist exigirSelecaoForma={!!pedido.dadosPedido?.olist && pedido.dadosPedido.olist.selecoes.recursoForma !== "RECEBIMENTO"} api={api} token={token} itens={pedido.dadosPedido?.itens.map((i) => ({ tecidoId: i.tecido.id, nome: i.tecido.nome, corteLaser: i.corteLaser })) ?? []} selecoes={selecoes} errosCampos={errosCampos} aoAlterar={valor => { setTemEdicoes(true); setSelecoes(valor); setErrosCampos({}); setErro(""); }} disabled={salvando || recuperando} somentePendentes={!!recuperacao && !edicaoManual} vendedorFixo={vendedorFixo} />
        </>}

        {!recuperando && temPendencias && <p className="text-sm text-slate-600">Preencha os campos pendentes para revisar o pedido.</p>}
        <button type="button" className={primario} disabled={salvando || recuperando || temPendencias || (pedido.tipoOrigem !== "MANUAL" && vendedorFonte === "MANUAL" && !escolhaManualConfirmada)} onClick={() => void operar({ acao: "preview", versao, selecoes, ...(pedido.tipoOrigem !== "MANUAL" ? { vendedorFonte } : {}) }, "preview")}>{salvando ? "Validando na Olist..." : "Revisar pedido"}</button>
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
