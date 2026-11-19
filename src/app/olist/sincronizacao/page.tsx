"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, Play } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { ConfiguracaoSync } from "@/components/olist-sync-configuracao";
import { DecisaoSyncDialog, ExecutarSyncDialog, OrigemSyncDialog } from "@/components/olist-sync-decisoes";
import { dataSync, duracaoSync, DialogoSync, OrigemSync, PaginacaoSync, PrevisaoValidacaoSync, ResumoFilaSync, StatusSync, syncButton, syncPanel, syncPrimary } from "@/components/olist-sync-ui";
import {
  ENTIDADES_SYNC_LABEL, ORIGENS_SYNC_LABEL, execucaoSyncAtiva, intervaloPollingSync,
  type ConfiguracaoSyncDto, type EntidadeSyncApi, type ExecucaoSyncDetalheDto, type ExecucaoSyncDto,
  type ModoExecucaoSync, type PaginaSyncDto, type PendenciaSyncDetalheDto, type PendenciaSyncDto,
  type RegistroSyncDto, type ResumoSyncDto, type SalvarConfiguracaoSync, type PrevisaoValidacaoSyncDto,
} from "@/lib/olist-sync/api-contract";

const ABAS = { resumo: "Visão geral", registros: "Registros", pendencias: "Pendências", execucoes: "Execuções", configuracao: "Configuração" } as const;
type Aba = keyof typeof ABAS;
const LIMITE = 25;
const FILTROS = { entidade: "", aplicativoId: "", status: "", severidade: "", tipo: "", origemTipo: "", aplicativoOrigemId: "", ultimaFonteAppId: "" };
type Filtros = typeof FILTROS;
const VAZIO = { total: 0, limit: LIMITE, offset: 0 };

function SincronizacaoOlist() {
  const { session, usuario } = useAuth();
  const token = session?.access_token;
  const [aba, setAba] = useState<Aba>("resumo");
  const [config, setConfig] = useState<ConfiguracaoSyncDto | null>(null);
  const [resumo, setResumo] = useState<ResumoSyncDto | null>(null);
  const [registros, setRegistros] = useState<PaginaSyncDto<RegistroSyncDto>>({ ...VAZIO, itens: [] });
  const [pendencias, setPendencias] = useState<PaginaSyncDto<PendenciaSyncDto>>({ ...VAZIO, itens: [] });
  const [execucoes, setExecucoes] = useState<PaginaSyncDto<ExecucaoSyncDto>>({ ...VAZIO, itens: [] });
  const [estimativa, setEstimativa] = useState<{ previsao: PrevisaoValidacaoSyncDto | null; falhou: boolean }>({ previsao: null, falhou: false });
  const previsaoConsultada = useRef(false);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS);
  const [consulta, setConsulta] = useState<Filtros>(FILTROS);
  const [offset, setOffset] = useState(0);
  const [versaoLista, setVersaoLista] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [listaCarregando, setListaCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falhaPolling, setFalhaPolling] = useState(false);
  const [novaExecucao, setNovaExecucao] = useState(false);
  const [pendenciaAberta, setPendenciaAberta] = useState<PendenciaSyncDetalheDto | null>(null);
  const [origemAberta, setOrigemAberta] = useState<RegistroSyncDto | null>(null);
  const [execucaoAberta, setExecucaoAberta] = useState<ExecucaoSyncDetalheDto | null>(null);
  const pedidoExecucao = useRef<{ modo: ModoExecucaoSync; completa: boolean; idempotencia: string } | null>(null);
  const gatilhoDialogo = useRef<HTMLButtonElement | null>(null);
  const botaoAbaAtual = useRef<HTMLButtonElement | null>(null);
  const devolverFoco = () => requestAnimationFrame(() => {
    const destino = gatilhoDialogo.current?.isConnected && !gatilhoDialogo.current.disabled ? gatilhoDialogo.current : botaoAbaAtual.current;
    destino?.focus();
  });
  const fecharPendencia = () => { setPendenciaAberta(null); devolverFoco(); };
  const fecharExecucao = () => { setExecucaoAberta(null); devolverFoco(); };

  const api = useCallback(async <T,>(recurso: string, init?: RequestInit): Promise<T> => {
    if (!token) throw new Error("A sessão expirou. Entre novamente.");
    const response = await fetch(`/api/olist/sincronizacao/${recurso}`, {
      ...init, cache: "no-store", headers: { ...init?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const dados: unknown = await response.json();
    if (!response.ok) {
      const mensagem = dados && typeof dados === "object" && "error" in dados && typeof dados.error === "string" ? dados.error : "Não foi possível concluir a solicitação.";
      throw new Error(mensagem);
    }
    return dados as T;
  }, [token]);

  const carregarPainel = useCallback(async (signal?: AbortSignal, atualizarPrevisao = false) => {
    setCarregando(true); setErro(null);
    try {
      const consultarPrevisao = Boolean(token) && (atualizarPrevisao || !previsaoConsultada.current);
      const [configuracao, novoResumo, novaEstimativa] = await Promise.all([
        api<ConfiguracaoSyncDto>("configuracao", { signal }), api<ResumoSyncDto>("resumo", { signal }),
        consultarPrevisao ? api<{ previsao: PrevisaoValidacaoSyncDto | null }>("previsao", { signal })
          .then(dados => ({ previsao: dados.previsao, falhou: false }), () => ({ previsao: null, falhou: true })) : null,
      ]);
      if (signal?.aborted) return;
      setConfig(configuracao); setResumo(novoResumo);
      if (novaEstimativa) { previsaoConsultada.current = true; setEstimativa(novaEstimativa); }
    } catch (error) {
      if (!signal?.aborted) setErro(error instanceof Error ? error.message : "Falha ao carregar a sincronização.");
    } finally { if (!signal?.aborted) setCarregando(false); }
  }, [api, token]);

  useEffect(() => {
    const controller = new AbortController();
    void carregarPainel(controller.signal);
    return () => controller.abort();
  }, [carregarPainel]);

  useEffect(() => {
    if (!["registros", "pendencias", "execucoes"].includes(aba)) return;
    const controller = new AbortController();
    async function carregarLista() {
      setListaCarregando(true); setErro(null);
      const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) });
      for (const [chave, valor] of Object.entries(consulta)) if (valor) params.set(chave, valor);
      try {
        if (aba === "registros") {
          const dados = await api<PaginaSyncDto<RegistroSyncDto>>(`registros?${params}`, { signal: controller.signal });
          if (!controller.signal.aborted) setRegistros(dados);
        } else if (aba === "pendencias") {
          const dados = await api<PaginaSyncDto<PendenciaSyncDto>>(`pendencias?${params}`, { signal: controller.signal });
          if (!controller.signal.aborted) setPendencias(dados);
        } else {
          const dados = await api<PaginaSyncDto<ExecucaoSyncDto>>(`execucoes?${params}`, { signal: controller.signal });
          if (!controller.signal.aborted) setExecucoes(dados);
        }
      } catch (error) { if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Falha ao carregar a lista."); }
      finally { if (!controller.signal.aborted) setListaCarregando(false); }
    }
    void carregarLista();
    return () => controller.abort();
  }, [aba, api, consulta, offset, versaoLista]);

  const statusAtivo = resumo?.execucaoAtiva?.status ?? null;
  const idAtivo = resumo?.execucaoAtiva?.id ?? null;
  const idDetalhe = execucaoAberta?.id ?? null;
  useEffect(() => {
    if (!statusAtivo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let falhas = 0;
    let encerrado = false;
    let emConsulta = false;
    const controller = new AbortController();
    function agendar() {
      clearTimeout(timer);
      const intervalo = intervaloPollingSync(statusAtivo, document.visibilityState === "visible", falhas);
      if (!encerrado && intervalo !== null) timer = setTimeout(() => { void atualizar(); }, intervalo);
    }
    async function atualizar() {
      if (encerrado || document.visibilityState !== "visible" || emConsulta) return;
      emConsulta = true;
      try {
        const novo = await api<ResumoSyncDto>("resumo", { signal: controller.signal });
        if (encerrado) return;
        let detalhe: ExecucaoSyncDetalheDto | null = null;
        if (idDetalhe && idDetalhe === idAtivo) {
          detalhe = await api<ExecucaoSyncDetalheDto>(`execucoes/${idDetalhe}`, { signal: controller.signal });
        }
        if (encerrado) return;
        // O resumo controla a vida deste efeito. Publique-o somente depois de
        // concluir a leitura do detalhe, evitando abortar a própria consulta final.
        if (detalhe) setExecucaoAberta(detalhe);
        falhas = 0; setFalhaPolling(false);
        if (!novo.execucaoAtiva || !execucaoSyncAtiva(novo.execucaoAtiva.status)) {
          encerrado = true; setVersaoLista((atual) => atual + 1);
        }
        setResumo(novo);
      } catch { if (!controller.signal.aborted) { falhas += 1; setFalhaPolling(true); } }
      finally { emConsulta = false; agendar(); }
    }
    const visibilidade = () => { if (document.visibilityState !== "visible") clearTimeout(timer); else agendar(); };
    document.addEventListener("visibilitychange", visibilidade); agendar();
    return () => { encerrado = true; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibilidade); };
  }, [api, idAtivo, idDetalhe, statusAtivo]);

  function mudarAba(proxima: Aba) {
    setAba(proxima); setOffset(0); setFiltros(FILTROS); setConsulta(FILTROS); setErro(null);
  }
  function pesquisar(event: FormEvent) { event.preventDefault(); setOffset(0); setConsulta({ ...filtros }); }
  async function executar(modo: ModoExecucaoSync, completa: boolean) {
    if (pedidoExecucao.current?.modo !== modo || pedidoExecucao.current.completa !== completa) pedidoExecucao.current = { modo, completa, idempotencia: crypto.randomUUID() };
    const resultado = await api<ExecucaoSyncDto>("execucoes", { method: "POST", body: JSON.stringify(pedidoExecucao.current) });
    pedidoExecucao.current = null;
    setAviso(`Execução ${resultado.id} aceita na fila. Acompanhe o processamento abaixo.`);
    mudarAba("execucoes"); setVersaoLista((atual) => atual + 1);
    setResumo((atual) => atual ? { ...atual, execucaoAtiva: resultado } : atual);
    try { setResumo(await api<ResumoSyncDto>("resumo")); }
    catch { setErro("A execução foi aceita, mas a atualização do resumo falhou. Consulte a aba Execuções."); }
  }
  async function salvarConfig(dados: SalvarConfiguracaoSync) {
    await api("configuracao", { method: "PUT", body: JSON.stringify(dados) });
    setAviso("Configuração salva. A liberação dos jobs continua independente.");
    try { setConfig(await api<ConfiguracaoSyncDto>("configuracao")); }
    catch { setErro("A configuração foi salva, mas a leitura atualizada falhou. Use Atualizar antes de editar novamente."); }
  }
  async function abrirPendencia(id: string, gatilho: HTMLButtonElement) {
    gatilhoDialogo.current = gatilho;
    setOcupado(true); setErro(null);
    try { setPendenciaAberta(await api<PendenciaSyncDetalheDto>(`pendencias/${id}`)); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível abrir a pendência."); devolverFoco(); }
    finally { setOcupado(false); }
  }
  async function abrirExecucao(id: string, gatilho: HTMLButtonElement) {
    gatilhoDialogo.current = gatilho;
    setOcupado(true); setErro(null);
    try { setExecucaoAberta(await api<ExecucaoSyncDetalheDto>(`execucoes/${id}`)); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível abrir a execução."); devolverFoco(); }
    finally { setOcupado(false); }
  }
  async function alterarExecucao(id: string, acao: "cancelar" | "retomar") {
    setOcupado(true); setErro(null);
    try {
      const resultado = await api<ExecucaoSyncDto>(`execucoes/${id}/${acao}`, { method: "POST", body: "{}" });
      setExecucaoAberta((atual) => ({ ...resultado, etapas: atual?.id === resultado.id ? atual.etapas : [] }));
      setVersaoLista((atual) => atual + 1);
      setAviso(acao === "cancelar" ? "Cancelamento solicitado. Operações já enviadas serão verificadas." : "Retomada solicitada; permissões e dados serão revalidados.");
      try {
        const [detalhe, novoResumo] = await Promise.all([
          api<ExecucaoSyncDetalheDto>(`execucoes/${resultado.id}`), api<ResumoSyncDto>("resumo"),
        ]);
        setExecucaoAberta(detalhe); setResumo(novoResumo);
      } catch { setErro("A solicitação foi registrada, mas a atualização dos detalhes falhou. Use Atualizar para consultar o estado."); }
    } catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível alterar a execução."); }
    finally { setOcupado(false); }
  }

  const empresas = config ? [...new Map([...config.aplicativosOrigem, ...config.aplicativosElegiveis, ...config.participantes].map((empresa) => [empresa.id, empresa])).values()] : [];
  const nomeEmpresa = (id: string) => empresas.find((empresa) => empresa.id === id)?.nome ?? id;
  const jobAplicar = config?.jobs.find((job) => job.chave === "aplicar-sincronizacao-olist");
  const permiteAplicar = Boolean(config?.ativo && config.prontidao.sincronizacaoNativaCompativel && config.prontidao.semanticaPutValidada && jobAplicar && !jobAplicar.pausado && jobAplicar.permitidoNoPai);
  const lista = aba === "registros" ? registros : aba === "pendencias" ? pendencias : execucoes;
  const temFila = Boolean(resumo?.fila && (resumo.fila.aguardandoAplicacao + resumo.fila.emAplicacao + resumo.fila.aguardandoConfirmacao > 0));
  async function processarFila() {
    setOcupado(true); setErro(null);
    try { await executar("APLICAR", false); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível iniciar o processamento da fila."); }
    finally { setOcupado(false); }
  }

  return <div className="space-y-6">
    <PageHeader title="Sincronização entre empresas" description="Audite e sincronize os cadastros dos aplicativos filhos. Controle conflitos, execuções e a origem de cada registro pelo aplicativo pai." />
    <div className="flex flex-wrap justify-between gap-3">
      <nav aria-label="Seções da sincronização" className="flex flex-wrap gap-2">{(Object.keys(ABAS) as Aba[]).map((item) => <button key={item} ref={aba === item ? botaoAbaAtual : undefined} type="button" aria-pressed={aba === item} onClick={() => mudarAba(item)} className={aba === item ? syncPrimary : syncButton}>{ABAS[item]}</button>)}</nav>
      <div className="flex flex-wrap gap-2"><button type="button" className={syncButton} disabled={carregando || listaCarregando || ocupado} onClick={() => { void carregarPainel(undefined, true); setVersaoLista((atual) => atual + 1); }}><RefreshCw className="h-4 w-4" aria-hidden="true" />Atualizar</button>{usuario?.podeExecutarSincronizacaoOlist && <button type="button" className={syncPrimary} disabled={!config || ocupado || Boolean(resumo?.execucaoAtiva)} onClick={(event) => { gatilhoDialogo.current = event.currentTarget; setNovaExecucao(true); }}><Play className="h-4 w-4" aria-hidden="true" />Nova execução</button>}</div>
    </div>
    {erro && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</div>}
    {aviso && <p role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">{aviso}</p>}
    {falhaPolling && statusAtivo && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">A atualização automática falhou. O sistema tentará novamente; o estado exibido pode estar desatualizado.</p>}
    {ocupado && <p role="status" className="text-sm text-slate-500">Consultando ou registrando a solicitação…</p>}
    {carregando && !config && <p role="status" className="text-sm text-slate-500">Carregando configuração e estado do grupo…</p>}
    {config && <>
      {!config.ativo && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">A configuração do grupo está desabilitada. O histórico permanece disponível.</p>}
      {aba === "resumo" && <>
        {resumo && <ResumoFilaSync resumo={resumo} />}
        {temFila && <section className={`${syncPanel} space-y-3`} aria-label="Continuação da fila">
          <h3 className="font-semibold">Continuar a sincronização com os dados já coletados</h3>
          <p className="text-sm text-slate-600">Cria ou atualiza na Olist as alterações já autorizadas, aproveitando os dados coletados. A fila inteira continua em lotes, com revalidação da origem e do destino antes de cada escrita. Envios anteriores são confirmados pelo ID existente.</p>
          {resumo?.execucaoAtiva ? <p role="status" className="text-sm text-slate-600">Há uma execução em andamento. Acompanhe seu processamento na aba Execuções.</p>
            : usuario?.podeExecutarSincronizacaoOlist && <button type="button" className={syncPrimary} disabled={ocupado || !permiteAplicar} onClick={() => void processarFila()}>Processar fila existente</button>}
          {!permiteAplicar && <p className="text-sm text-amber-800">A aplicação depende da configuração ativa, das validações e da liberação do job no aplicativo pai.</p>}
        </section>}
        <section className={syncPanel}><h3 className="font-semibold">Empresas participantes</h3><p className="mt-1 text-sm text-slate-500">Administradas por {config.aplicativoPaiNome}</p><ul className="mt-4 grid gap-3 sm:grid-cols-2">{config.participantes.map((empresa) => <li className="rounded-md border border-slate-200 p-3" key={empresa.id}><span className="break-words text-sm font-medium">{empresa.nome}</span><p className="mt-1 text-xs text-slate-500">{empresa.habilitado ? "Participante habilitado" : "Participação desabilitada"}</p></li>)}</ul><p className="mt-4 text-xs text-slate-500">O aplicativo pai e os filhos não selecionados não recebem dados deste módulo.</p></section>
        <section className={`${syncPanel} grid gap-5 sm:grid-cols-2`}>
          <div><h3 className="text-sm font-medium">Última execução</h3>{resumo?.ultimaExecucao ? <div className="mt-2 space-y-2"><StatusSync status={resumo.ultimaExecucao.status} /><p className="text-xs text-slate-500">{dataSync(resumo.ultimaExecucao.criadoEm)}</p><button type="button" onClick={(event) => void abrirExecucao(resumo.ultimaExecucao!.id, event.currentTarget)} className={syncButton} disabled={ocupado}>Ver execução</button></div> : <p className="mt-2 text-sm text-slate-500">Nenhuma execução registrada.</p>}</div>
          <div><h3 className="text-sm font-medium">Agendamento diário</h3><p className="mt-2 text-sm">{config.horaDiaria} · {config.fusoHorario}</p><p className="mt-1 text-xs text-slate-500">Próxima: {dataSync(config.proximaExecucaoEm)}</p>{resumo?.execucaoAtiva && <div className="mt-3 flex flex-wrap gap-2"><StatusSync status={resumo.execucaoAtiva.status} /><button type="button" className={syncButton} disabled={ocupado} onClick={(event) => void abrirExecucao(resumo.execucaoAtiva!.id, event.currentTarget)}>Acompanhar execução</button></div>}</div>
        </section>
        <p className="text-sm text-slate-500">“Sincronizado” considera apenas os campos habilitados. Estoque, preços, custos e dados fiscais ficam fora do fluxo. Formas de pagamento e vendedores permitem auditoria e equivalência manual.</p>
      </>}
      {aba === "configuracao" && <ConfiguracaoSync key={config.versao} configuracao={config} podeEditar={Boolean(usuario?.podeConfigurarSincronizacaoOlist)} salvar={salvarConfig} />}
      {["registros", "pendencias"].includes(aba) && <form onSubmit={pesquisar} className={`${syncPanel} grid gap-4 sm:grid-cols-2 xl:grid-cols-4`}>
        <label className="text-sm font-medium">Entidade<select className="input mt-1 min-h-11" value={filtros.entidade} onChange={(event) => setFiltros({ ...filtros, entidade: event.target.value })}><option value="">Todas</option>{(Object.keys(ENTIDADES_SYNC_LABEL) as EntidadeSyncApi[]).map((item) => <option key={item} value={item}>{ENTIDADES_SYNC_LABEL[item]}</option>)}</select></label>
        <label className="text-sm font-medium">Empresa<select className="input mt-1 min-h-11" value={filtros.aplicativoId} onChange={(event) => setFiltros({ ...filtros, aplicativoId: event.target.value })}><option value="">Todas</option>{empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}</select></label>
        <label className="text-sm font-medium">Estado<select className="input mt-1 min-h-11" value={filtros.status} onChange={(event) => setFiltros({ ...filtros, status: event.target.value })}><option value="">Todos</option>{(aba === "registros" ? ["NAO_VERIFICADO", "SINCRONIZADO", "AUSENTE", "DIVERGENTE", "AGUARDANDO_REVISAO", "ERRO", "INATIVO_EXCLUIDO"] : ["AGUARDANDO_REVISAO", "APROVADA", "REJEITADA", "IGNORADA", "RESOLVIDA"]).map((status) => <option key={status} value={status}>{status.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>
        {aba === "pendencias" ? <>
          <label className="text-sm font-medium">Severidade<select className="input mt-1 min-h-11" value={filtros.severidade} onChange={(event) => setFiltros({ ...filtros, severidade: event.target.value })}><option value="">Todas</option>{["CRITICA", "ALTA", "MEDIA", "INFORMATIVA"].map((valor) => <option key={valor} value={valor}>{valor.toLowerCase()}</option>)}</select></label>
          <label className="text-sm font-medium">Tipo de conflito<input className="input mt-1 min-h-11" maxLength={80} value={filtros.tipo} onChange={(event) => setFiltros({ ...filtros, tipo: event.target.value.toUpperCase() })} placeholder="Ex.: POSSIVEL_DUPLICIDADE" /></label>
        </> : <>
          <label className="text-sm font-medium">Proveniência<select className="input mt-1 min-h-11" value={filtros.origemTipo} onChange={(event) => setFiltros({ ...filtros, origemTipo: event.target.value })}><option value="">Todas</option>{Object.entries(ORIGENS_SYNC_LABEL).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></label>
          <label className="text-sm font-medium">Aplicativo original<select className="input mt-1 min-h-11" value={filtros.aplicativoOrigemId} onChange={(event) => setFiltros({ ...filtros, aplicativoOrigemId: event.target.value })}><option value="">Todos</option>{empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}</select></label>
          <label className="text-sm font-medium">Última fonte<select className="input mt-1 min-h-11" value={filtros.ultimaFonteAppId} onChange={(event) => setFiltros({ ...filtros, ultimaFonteAppId: event.target.value })}><option value="">Todas</option>{empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}</select></label>
        </>}
        <div className="flex items-end"><button type="submit" className={syncPrimary} disabled={listaCarregando}>Filtrar</button></div>
      </form>}
      {["registros", "pendencias", "execucoes"].includes(aba) && <section className={`${syncPanel} space-y-4`} aria-busy={listaCarregando}>
        <h3 className="font-semibold">{ABAS[aba]}</h3>
        {listaCarregando && <p role="status" className="text-sm text-slate-500">Carregando página…</p>}
        {!listaCarregando && lista.itens.length === 0 && <p className="text-sm text-slate-500">Nenhum resultado para os filtros selecionados.</p>}
        {aba === "registros" && registros.itens.map((registro) => <article key={registro.id} className="grid min-w-0 gap-5 rounded-lg border border-slate-200 p-4 xl:grid-cols-3">
          <div className="min-w-0"><h4 className="break-words font-medium">{registro.nome || registro.chaveExibicao}</h4><p className="mt-1 break-all text-xs text-slate-500">{ENTIDADES_SYNC_LABEL[registro.entidade]} · {registro.chaveExibicao} · Revisão {registro.revisao}</p>{usuario?.podeResolverSincronizacaoOlist && <button type="button" className={`${syncButton} mt-3`} onClick={(event) => { gatilhoDialogo.current = event.currentTarget; setOrigemAberta(registro); }}>Declarar origem</button>}</div>
          <OrigemSync registro={registro} empresas={empresas} />
          <ul className="space-y-3">{registro.estados.map((estado) => <li key={estado.aplicativoId}><p className="mb-1 break-words text-xs font-medium">{nomeEmpresa(estado.aplicativoId)}</p><StatusSync status={estado.status} /><p className="mt-1 text-xs text-slate-500">Verificado: {dataSync(estado.verificadoEm)}</p></li>)}</ul>
        </article>)}
        {aba === "pendencias" && pendencias.itens.map((pendencia) => <article key={pendencia.id} className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2"><div className="flex flex-wrap gap-2"><StatusSync status={pendencia.severidade} /><StatusSync status={pendencia.status} /></div><h4 className="break-words text-sm font-medium">{pendencia.resumo}</h4><p className="break-words text-xs text-slate-500">{ENTIDADES_SYNC_LABEL[pendencia.entidade]} · {pendencia.tipo} · {dataSync(pendencia.criadoEm)}</p></div><button type="button" className={`${syncButton} shrink-0`} disabled={ocupado} onClick={(event) => void abrirPendencia(pendencia.id, event.currentTarget)}>Ver diferenças</button>
        </article>)}
        {aba === "execucoes" && execucoes.itens.map((execucao) => <article key={execucao.id} className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusSync status={execucao.status} /><span className="text-xs text-slate-500">{execucao.modo.replaceAll("_", " ").toLowerCase()} · {execucao.origem.toLowerCase()}</span></div><p className="mt-2 break-all text-xs text-slate-500">{execucao.id}</p><p className="mt-1 text-xs text-slate-500">Criada: {dataSync(execucao.criadoEm)} · Finalizada: {dataSync(execucao.finalizadoEm)} · Duração: {duracaoSync(execucao.iniciadoEm, execucao.finalizadoEm)}</p></div><button type="button" className={syncButton} onClick={(event) => void abrirExecucao(execucao.id, event.currentTarget)} disabled={ocupado}>Detalhes</button></div>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{Object.entries(execucao.contadores).map(([nome, valor]) => <div key={nome} className="text-sm"><dt className="inline text-slate-500">{nome.replaceAll("_", " ")}: </dt><dd className="inline font-medium">{valor}</dd></div>)}</dl>
          {execucaoSyncAtiva(execucao.status) && execucao.modo !== "APLICAR" && <PrevisaoValidacaoSync previsao={estimativa.previsao?.execucaoId === execucao.id ? estimativa.previsao : null} falhou={estimativa.falhou} />}
        </article>)}
        <PaginacaoSync offset={offset} total={lista.total} limit={LIMITE} ocupado={listaCarregando} mudar={setOffset} />
      </section>}
    </>}
    {novaExecucao && config && <ExecutarSyncDialog fechar={() => { setNovaExecucao(false); devolverFoco(); }} executar={executar} permiteAplicar={permiteAplicar} limite={config.limiteAlteracoes} />}
    {pendenciaAberta && <DecisaoSyncDialog detalhe={pendenciaAberta} empresas={config?.participantes ?? []} podeResolver={Boolean(usuario?.podeResolverSincronizacaoOlist)} fechar={fecharPendencia} decidir={async (input) => { await api(`pendencias/${pendenciaAberta.id}/decisao`, { method: "POST", body: JSON.stringify(input) }); setAviso("Decisão registrada. Aplicação e nova auditoria permanecem sujeitas às permissões e à revalidação."); setVersaoLista((atual) => atual + 1); try { setResumo(await api<ResumoSyncDto>("resumo")); } catch { setErro("A decisão foi registrada, mas o resumo não pôde ser atualizado."); } }} />}
    {origemAberta && <OrigemSyncDialog registro={origemAberta} empresas={empresas} fechar={() => { setOrigemAberta(null); devolverFoco(); }} salvar={async (input) => { await api(`registros/${origemAberta.id}/origem`, { method: "POST", body: JSON.stringify(input) }); setAviso("Origem declarada e registrada na auditoria."); setVersaoLista((atual) => atual + 1); }} />}
    {execucaoAberta && <DialogoSync titulo="Detalhes da execução" ocupado={ocupado} fechar={fecharExecucao}>
      <div className="space-y-4"><StatusSync status={execucaoAberta.status} /><p className="break-all text-xs text-slate-500">{execucaoAberta.id}</p><p className="text-sm text-slate-600">Início: {dataSync(execucaoAberta.iniciadoEm)} · Fim: {dataSync(execucaoAberta.finalizadoEm)} · Duração: {duracaoSync(execucaoAberta.iniciadoEm, execucaoAberta.finalizadoEm)}</p>
        {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <dl className="flex flex-wrap gap-x-5 gap-y-2">{Object.entries(execucaoAberta.contadores).map(([nome, valor]) => <div key={nome} className="text-sm"><dt className="inline text-slate-500">{nome.replaceAll("_", " ")}: </dt><dd className="inline font-medium">{valor}</dd></div>)}</dl>
        <div className="grid gap-3 sm:grid-cols-2">{execucaoAberta.etapas.map((etapa) => <section className="min-w-0 rounded-md border border-slate-200 p-3" key={etapa.id}><h3 className="break-words text-sm font-medium">{nomeEmpresa(etapa.aplicativoId)} · {ENTIDADES_SYNC_LABEL[etapa.entidade]}</h3><p className="my-2 text-xs text-slate-500">{etapa.fase.toLowerCase()} · Tentativas: {etapa.tentativas}</p><StatusSync status={etapa.status} />{etapa.confirmacoesDivergentes && <p className="mt-2 text-sm text-amber-800">Aplicação pausada após três confirmações com diferenças reais. Confira as pendências antes de continuar. Os IDs enviados foram preservados para reconciliação, sem nova criação.</p>}{etapa.plano && <div className="mt-3 space-y-1 text-xs text-slate-600"><p>Leitura efetiva: {etapa.plano.modo === "INCREMENTAL" ? "Incremental" : "Completa"}</p><p>Início da coleta: {dataSync(etapa.plano.iniciadaEm)}</p>{etapa.plano.desde && <p>Alterações desde: {dataSync(etapa.plano.desde)} · janela sobreposta</p>}</div>}<p className="mt-2 text-xs text-slate-500">Disponível: {dataSync(etapa.disponivelEm)}</p></section>)}</div>
        {usuario?.podeExecutarSincronizacaoOlist && <div className="flex flex-wrap justify-end gap-2">{execucaoSyncAtiva(execucaoAberta.status) && <button type="button" className={syncButton} disabled={ocupado} onClick={() => void alterarExecucao(execucaoAberta.id, "cancelar")}>Solicitar cancelamento</button>}{["CONCLUIDA_COM_PENDENCIAS", "FALHOU", "CANCELADA"].includes(execucaoAberta.status) && <button type="button" className={syncPrimary} disabled={ocupado || Boolean(resumo?.execucaoAtiva)} onClick={() => void alterarExecucao(execucaoAberta.id, "retomar")}>Retomar trabalho pendente</button>}</div>}
      </div>
    </DialogoSync>}
  </div>;
}

export default function SincronizacaoOlistPage() {
  return <AccessGuard permissions={["podeVisualizarSincronizacaoOlist"]}><SincronizacaoOlist /></AccessGuard>;
}
