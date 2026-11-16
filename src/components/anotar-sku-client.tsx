"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Download, Loader2, RefreshCw, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { criarBuscaSkuSchema, ESTADOS_ABERTOS_SKU, SITUACOES_SKU, type JobSkuResumo } from "@/lib/anotar-sku/contrato";

type Busca = { id: string; situacoes: string[]; quantidadePedidos: number; quantidadeSkus: number; createdAt: string };
type Detalhe = Busca & { pedidos: string[]; skus: { sku: string; tituloProduto: string | null; quantidade: number }[] };
type Pendente = { chave: string; situacoes: string[] };
class FalhaEnvio extends Error { constructor(message: string, readonly status: number) { super(message); } }
const endpoint = "/api/olist/anotar-sku";
const botao = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const primario = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const data = (valor: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(valor));
const situacoes = (valores: string[]) => valores.map(s => SITUACOES_SKU.find(v => v.value === s)?.label ?? s).join(", ");
const estados: Record<string, string> = { PENDENTE: "Na fila", PROCESSANDO: "Em andamento", AGUARDANDO_RETRY: "Nova tentativa agendada", FALHOU: "Precisa de atenção", CONCLUIDO: "Concluída", CANCELADO: "Cancelada" };

function Dialogo({ titulo, fechar, children, rodape, ocupado = false }: { titulo: string; fechar: () => void; children: ReactNode; rodape?: ReactNode; ocupado?: boolean }) {
  const ref = useModalFocus(() => { if (!ocupado) fechar(); });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sku-dialogo-titulo" aria-busy={ocupado} className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-4 sm:px-6"><h2 id="sku-dialogo-titulo" className="pt-2 text-lg font-semibold text-slate-900">{titulo}</h2><button type="button" className={botao} aria-label="Fechar diálogo" onClick={fechar} disabled={ocupado}><X className="h-5 w-5" aria-hidden="true" /></button></div>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6">{children}</div>
      {rodape && <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200 p-4">{rodape}</div>}
    </div>
  </div>;
}
function CartaoJob({ job, ocupado, pausado, gerenciar, visualizar, podeVisualizar }: {
  job: JobSkuResumo; ocupado: boolean; pausado: boolean; podeVisualizar: boolean;
  gerenciar: (job: JobSkuResumo, acao: "retomar" | "cancelar") => void; visualizar: (id: string) => void;
}) {
  const aberto = ESTADOS_ABERTOS_SKU.includes(job.status), falhou = job.status === "FALHOU", concluido = job.status === "CONCLUIDO";
  const etapa = job.etapa === "LISTAGEM" ? job.passagem === 1 ? "Conferindo a lista de pedidos" : "Localizando pedidos" : job.etapa === "DETALHAMENTO" ? "Separando os SKUs dos pedidos" : "Salvando o resultado";
  const cor = falhou ? "border-red-200 bg-red-50 text-red-700" : concluido ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:text-emerald-200" : "border-slate-200 bg-slate-50 text-slate-700";
  const Icone = falhou ? AlertCircle : concluido ? CheckCircle2 : Clock3;
  return <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium ${cor}`}><Icone className="h-4 w-4 shrink-0" aria-hidden="true" />{estados[job.status] ?? job.status}</span><time dateTime={job.createdAt} className="text-xs text-slate-500">Solicitada em {data(job.createdAt)}</time></div>
    <p className="mt-3 break-words text-sm text-slate-600">{situacoes(job.situacoes)}</p>
    {aberto && <div className="mt-4 space-y-2"><p className="text-sm font-medium text-slate-900">{falhou ? "O progresso foi preservado." : etapa}</p>
      {job.etapa !== "LISTAGEM" && <progress className="h-2 w-full accent-slate-700 dark:accent-slate-300" aria-label="Pedidos conferidos" max={Math.max(1, job.encontrados)} value={job.processados} />}
      <p className="text-sm text-slate-600">{job.etapa === "LISTAGEM" ? `${job.encontrados} pedido(s) localizado(s). O total ainda pode mudar.` : `${job.processados} de ${job.encontrados} pedido(s) conferido(s) · ${job.ignorados} já estavam no histórico.`}</p>
      {job.status === "AGUARDANDO_RETRY" && <p className="text-sm text-slate-700">Próxima tentativa a partir de {data(job.proximaTentativaEm)}. Tentativa anterior: {job.tentativas} de 5.</p>}
      {job.erro && <p className="break-words text-sm text-red-700">{job.erro}</p>}
      {!falhou && <p className="text-xs text-slate-500">{pausado ? "Processamento pausado temporariamente. Seu progresso está salvo." : "Você pode sair desta tela. A busca continua em segundo plano."}</p>}
      <p className="text-xs text-slate-500">Último progresso ou tentativa: {data(job.updatedAt)}</p>
    </div>}
    {concluido && <p className="mt-4 text-sm text-slate-700">{job.resultadoRemovido ? "O resultado desta busca foi excluído do histórico." : job.buscaId ? "SKUs separados. O resultado está disponível no histórico." : "Nenhum SKU novo para salvar. Pedidos já registrados não foram repetidos."}</p>}
    {job.status === "CANCELADO" && <p className="mt-4 text-sm text-slate-600">Busca encerrada sem publicar resultado.</p>}
    {(job.podeGerenciar && aberto || podeVisualizar && job.buscaId) && <div className="mt-4 flex flex-wrap gap-3">
      {job.podeGerenciar && falhou && <button type="button" className={primario} disabled={ocupado || pausado} onClick={() => gerenciar(job, "retomar")}><RefreshCw className="h-4 w-4" aria-hidden="true" />Retomar busca</button>}
      {job.podeGerenciar && aberto && <button type="button" className={botao} disabled={ocupado} onClick={() => gerenciar(job, "cancelar")}>Cancelar busca</button>}
      {podeVisualizar && job.buscaId && <button type="button" className={botao} disabled={ocupado} onClick={() => visualizar(job.buscaId!)}>Ver resultado</button>}
    </div>}
  </article>;
}

export function AnotarSkuClient({ token, podeEscrever, podeVisualizar, escopo }: { token: string; podeEscrever: boolean; podeVisualizar: boolean; escopo: string }) {
  const [selecionadas, setSelecionadas] = useState(["0"]), [jobs, setJobs] = useState<JobSkuResumo[]>([]), [buscas, setBuscas] = useState<Busca[]>([]);
  const [emAberto, setEmAberto] = useState(false), [habilitado, setHabilitado] = useState(false), [carregando, setCarregando] = useState(true), [atualizando, setAtualizando] = useState(false);
  const [erroAtualizacao, setErroAtualizacao] = useState<string | null>(null), [erro, setErro] = useState<string | null>(null), [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null), [pendente, setPendente] = useState<Pendente | null>(null), [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [confirmacao, setConfirmacao] = useState<{ tipo: "cancelar" | "excluir"; id: string } | null>(null), [erroDialogo, setErroDialogo] = useState<string | null>(null), [maisJobs, setMaisJobs] = useState(false);
  const erroRef = useRef<HTMLParagraphElement>(null), mensagemRef = useRef<HTMLParagraphElement>(null), erroDialogoRef = useRef<HTMLParagraphElement>(null);
  const requisicao = useRef<AbortController | null>(null), bloqueio = useRef(false);
  const historicoCarregado = useRef(false), conclusoesAnteriores = useRef("");
  const storageKey = `anotar-sku-pendente:${escopo}`;
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token]);
  useEffect(() => { if (erro) erroRef.current?.focus(); }, [erro]);
  useEffect(() => { if (mensagem) mensagemRef.current?.focus(); }, [mensagem]);
  useEffect(() => { if (erroDialogo) erroDialogoRef.current?.focus(); }, [erroDialogo]);
  useEffect(() => {
    try { const salvo = criarBuscaSkuSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? "null")); if (salvo.success) { setPendente(salvo.data); setSelecionadas(salvo.data.situacoes); } } catch { /* Storage opcional. */ }
  }, [storageKey]);
  const atualizar = useCallback(async (recarregarHistorico = false) => {
    if (!token) return;
    requisicao.current?.abort(); const controller = new AbortController(); requisicao.current = controller; setAtualizando(true);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      const resposta = await fetch(`${endpoint}/jobs`, { headers: headers(), cache: "no-store", signal });
      const payload = await resposta.json(); if (!resposta.ok) throw new Error(payload.error ?? "Não foi possível acompanhar a busca.");
      if (controller.signal.aborted) return;
      setJobs(payload.jobs); setEmAberto(payload.emAberto); setHabilitado(payload.habilitado);
      const conclusoes = JSON.stringify((payload.jobs as JobSkuResumo[]).filter(j => j.status === "CONCLUIDO").map(j => [j.id, j.buscaId]));
      if (podeVisualizar && (!historicoCarregado.current || recarregarHistorico || conclusoes !== conclusoesAnteriores.current)) {
        const historico = await fetch(endpoint, { headers: headers(), cache: "no-store", signal }); const dados = await historico.json();
        if (!historico.ok) throw new Error(dados.error ?? "Não foi possível atualizar o histórico.");
        if (controller.signal.aborted) return; setBuscas(dados.buscas); historicoCarregado.current = true;
      }
      conclusoesAnteriores.current = conclusoes;
      setErroAtualizacao(null);
    } catch (falha) { if (!controller.signal.aborted) setErroAtualizacao(falha instanceof Error ? falha.message : "Falha ao atualizar."); }
    finally { if (!controller.signal.aborted) { setCarregando(false); setAtualizando(false); } }
  }, [token, headers, podeVisualizar]);
  useEffect(() => { void atualizar(); return () => requisicao.current?.abort(); }, [atualizar]);
  useEffect(() => {
    const atualizarVisivel = () => { if (document.visibilityState === "visible" && !atualizando) void atualizar(); };
    const timer = window.setInterval(atualizarVisivel, emAberto ? 10_000 : 30_000);
    window.addEventListener("focus", atualizarVisivel); document.addEventListener("visibilitychange", atualizarVisivel);
    return () => { clearInterval(timer); window.removeEventListener("focus", atualizarVisivel); document.removeEventListener("visibilitychange", atualizarVisivel); };
  }, [atualizar, atualizando, emAberto]);
  function guardarPendente(valor: Pendente | null) { setPendente(valor); try { if (valor) localStorage.setItem(storageKey, JSON.stringify(valor)); else localStorage.removeItem(storageKey); } catch { /* Chave mantida em memória. */ } }
  async function executar(chave: string, acao: () => Promise<void>, noDialogo = false) {
    if (bloqueio.current) return; bloqueio.current = true; setOcupado(chave); setErro(null); setErroDialogo(null); setMensagem(null);
    try { await acao(); } catch (falha) { const texto = falha instanceof Error ? falha.message : "Não foi possível concluir a operação."; if (noDialogo) setErroDialogo(texto); else setErro(texto); }
    finally { bloqueio.current = false; setOcupado(null); }
  }
  async function enviar(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    const payload = await response.json(); if (!response.ok) throw new FalhaEnvio(payload.error ?? "Não foi possível concluir a operação.", response.status); return payload;
  }
  function buscar() { void executar("buscar", async () => {
    const entrada = pendente ?? { chave: crypto.randomUUID(), situacoes: selecionadas }; guardarPendente(entrada);
    try {
      const payload = await enviar(`${endpoint}/jobs`, "POST", entrada); guardarPendente(null);
      setMensagem(payload.job.status === "CONCLUIDO" ? "Esta solicitação já foi concluída. Consulte o resultado abaixo." : payload.job.status === "CANCELADO" ? "Esta solicitação já foi cancelada. Você pode iniciar uma nova busca." : "Busca registrada. Você pode sair desta tela e acompanhar o resultado depois.");
    } catch (falha) {
      if (falha instanceof FalhaEnvio && [400, 401, 403, 409].includes(falha.status)) guardarPendente(null);
      await atualizar(); throw falha;
    }
    await atualizar();
  }); }
  function gerenciar(job: JobSkuResumo, acao: "retomar" | "cancelar") {
    if (acao === "cancelar") { setErroDialogo(null); setConfirmacao({ tipo: "cancelar", id: job.id }); return; }
    void executar(job.id, async () => { await enviar(`${endpoint}/jobs/${job.id}`, "PATCH", { acao }); setMensagem("Busca retomada a partir do progresso salvo."); await atualizar(); });
  }
  function visualizar(id: string) { void executar(id, async () => { const payload = await enviar(`${endpoint}?id=${encodeURIComponent(id)}`, "GET"); setDetalhe(payload.busca); }); }
  function baixar(id: string, formato: string) { void executar(`${id}:${formato}`, async () => {
    const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}&formato=${formato}`, { headers: headers() });
    if (!response.ok) throw new Error((await response.json()).error ?? "Não foi possível baixar o arquivo.");
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a"); link.href = url; link.download = `anotar-sku-${id}.${formato}`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMensagem(`Download de ${formato.toUpperCase()} iniciado.`);
  }); }
  function confirmar() { if (!confirmacao) return; void executar(confirmacao.id, async () => {
    if (confirmacao.tipo === "cancelar") await enviar(`${endpoint}/jobs/${confirmacao.id}`, "PATCH", { acao: "cancelar" }); else await enviar(`${endpoint}?id=${encodeURIComponent(confirmacao.id)}`, "DELETE");
    setConfirmacao(null); setMensagem(confirmacao.tipo === "cancelar" ? "Busca cancelada. Você já pode iniciar outra." : "Resultado excluído. Os pedidos podem ser buscados novamente."); await atualizar(true);
  }, true); }
  const atual = jobs.find(j => ESTADOS_ABERTOS_SKU.includes(j.status)), anteriores = jobs.filter(j => !ESTADOS_ABERTOS_SKU.includes(j.status));
  return <div className="space-y-6">
    <PageHeader title="Anotar SKU" description="Separe os SKUs de pedidos novos da Olist. A busca continua mesmo quando você sai desta tela." />
    {erro && <p ref={erroRef} tabIndex={-1} role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</p>}
    {mensagem && <p ref={mensagemRef} tabIndex={-1} role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:text-emerald-200">{mensagem}</p>}
    {erroAtualizacao && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p className="min-w-0 flex-1">{erroAtualizacao} A falha de atualização da tela não cancela uma busca já registrada.</p><button type="button" className={botao} onClick={() => void atualizar(true)} disabled={atualizando}>Tentar atualizar</button></div>}
    {!carregando && !habilitado && !erroAtualizacao && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Novas buscas e retomadas estão temporariamente pausadas. O histórico continua disponível.</p>}
    <div className="grid items-start gap-6 xl:grid-cols-2">
      {podeEscrever && <section className={`${emAberto ? "order-2" : "order-1"} rounded-lg border border-slate-200 bg-white p-4 sm:p-6 xl:order-1`} aria-labelledby="sku-nova">
        <h2 id="sku-nova" className="text-lg font-semibold text-slate-900">Nova busca</h2><p className="mt-1 text-sm text-slate-600">Escolha as situações dos pedidos. Os já registrados no histórico serão ignorados.</p>
        <fieldset className="mt-5" disabled={Boolean(ocupado) || emAberto || Boolean(pendente) || !habilitado || carregando}><legend className="mb-2 text-sm font-medium text-slate-900">Situações dos pedidos</legend><div className="grid gap-2 sm:grid-cols-2">
          {SITUACOES_SKU.map(s => <label key={s.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm text-slate-700 ${selecionadas.includes(s.value) ? "border-slate-400 bg-slate-50" : "border-slate-200"}`}><input type="checkbox" className="h-4 w-4 shrink-0 accent-slate-700" checked={selecionadas.includes(s.value)} onChange={() => setSelecionadas(valores => valores.includes(s.value) ? valores.filter(v => v !== s.value) : [...valores, s.value])} />{s.label}</label>)}
        </div></fieldset>
        {pendente && ocupado !== "buscar" && <p className="mt-4 text-sm text-amber-800">Há uma solicitação sem confirmação nesta sessão. Confirme o envio para recuperar a mesma busca, sem duplicá-la.</p>}
        <button type="button" className={`${primario} mt-5 w-full sm:w-auto`} onClick={buscar} disabled={Boolean(ocupado) || (!pendente && emAberto) || !selecionadas.length || !token || !habilitado || carregando || Boolean(erroAtualizacao)}>
          {ocupado === "buscar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}{ocupado === "buscar" ? "Registrando busca…" : pendente ? "Confirmar solicitação" : "Iniciar busca"}
        </button><p className="mt-3 text-xs text-slate-500">{emAberto ? "Uma busca por vez neste aplicativo. Conclua, retome ou cancele a busca em aberto." : !selecionadas.length ? "Selecione ao menos uma situação para continuar." : "Depois de registrada, a busca não depende desta página aberta."}</p>
      </section>}
      <section className={`${emAberto ? "order-1" : "order-2"} min-w-0 space-y-3 xl:order-2 ${!podeEscrever ? "xl:col-span-2" : ""}`} aria-labelledby="sku-acompanhamento">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="sku-acompanhamento" className="text-lg font-semibold text-slate-900">Acompanhamento</h2><button type="button" className={botao} disabled={atualizando} onClick={() => void atualizar(true)}><RefreshCw className={`h-4 w-4 ${atualizando ? "animate-spin" : ""}`} aria-hidden="true" />{atualizando ? "Atualizando…" : "Atualizar"}</button></div>
        <p className="sr-only" role="status">{atual ? `${estados[atual.status]}. ${atual.processados} de ${atual.encontrados} pedidos conferidos.` : "Nenhuma busca sua em andamento."}</p>
        {carregando ? <p role="status" className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Carregando buscas…</p> : atual ? <CartaoJob job={atual} ocupado={Boolean(ocupado)} pausado={!habilitado} gerenciar={gerenciar} visualizar={visualizar} podeVisualizar={podeVisualizar} /> : <div className="rounded-lg border border-slate-200 bg-white p-6"><Clock3 className="mb-3 h-6 w-6 text-slate-500" aria-hidden="true" /><p className="text-sm font-medium text-slate-900">{emAberto ? "Há uma busca de outro usuário em aberto." : "Nenhuma busca em andamento"}</p><p className="mt-1 text-sm text-slate-600">{emAberto ? "Aguarde a conclusão ou peça ao solicitante para retomar ou cancelar." : "O andamento da próxima busca aparecerá aqui."}</p></div>}
        {anteriores.slice(0, maisJobs ? 20 : 1).map(job => <CartaoJob key={job.id} job={job} ocupado={Boolean(ocupado)} pausado={!habilitado} gerenciar={gerenciar} visualizar={visualizar} podeVisualizar={podeVisualizar} />)}
        {anteriores.length > 1 && <button type="button" className={botao} aria-expanded={maisJobs} onClick={() => setMaisJobs(!maisJobs)}>{maisJobs ? "Mostrar apenas a última" : "Ver solicitações anteriores"}</button>}
      </section>
    </div>
    {podeVisualizar && <section className="space-y-4" aria-labelledby="sku-historico"><div><h2 id="sku-historico" className="text-lg font-semibold text-slate-900">Resultados salvos</h2><p className="mt-1 text-sm text-slate-600">Abra os SKUs ou baixe o arquivo. Somente buscas concluídas aparecem aqui.</p>{emAberto && podeEscrever && <p className="mt-2 text-xs text-slate-500">A exclusão fica disponível após concluir ou cancelar a busca em aberto.</p>}</div>
      {!carregando && buscas.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Nenhum resultado salvo ainda.</p>}
      {buscas.map(busca => <article key={busca.id} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h3 className="font-medium text-slate-900">Busca de {data(busca.createdAt)}</h3><p className="mt-1 break-words text-sm text-slate-600">{situacoes(busca.situacoes)}</p></div><p className="text-sm text-slate-700"><strong>{busca.quantidadePedidos}</strong> pedidos · <strong>{busca.quantidadeSkus}</strong> SKUs</p></div>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primario} disabled={Boolean(ocupado)} onClick={() => visualizar(busca.id)}>{ocupado === busca.id ? "Abrindo…" : "Ver SKUs"}</button>{["csv", "xlsx", "pdf"].map(formato => <button key={formato} type="button" className={botao} disabled={Boolean(ocupado)} onClick={() => baixar(busca.id, formato)}><Download className="h-4 w-4" aria-hidden="true" />{ocupado === `${busca.id}:${formato}` ? "Baixando…" : formato === "xlsx" ? "Excel" : formato.toUpperCase()}</button>)}{podeEscrever && <button type="button" className={`${botao} text-red-700 sm:ml-auto`} disabled={Boolean(ocupado) || emAberto} onClick={() => { setErroDialogo(null); setConfirmacao({ tipo: "excluir", id: busca.id }); }}>Excluir</button>}</div>
      </article>)}
    </section>}
    {detalhe && <Dialogo titulo="SKUs da busca" fechar={() => setDetalhe(null)}><p className="text-sm text-slate-600">{data(detalhe.createdAt)} · {detalhe.quantidadePedidos} pedidos · {detalhe.quantidadeSkus} SKUs</p><details className="mt-3 rounded-md border border-slate-200 p-3 text-sm text-slate-600"><summary className="min-h-11 cursor-pointer py-3 font-medium">Identificadores dos pedidos</summary><p className="break-words pt-2">{detalhe.pedidos.join(", ") || "Nenhum"}</p></details>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Quantidades agrupadas por SKU</caption><thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="px-3 py-3">SKU</th><th scope="col" className="px-3 py-3">Produto</th><th scope="col" className="px-3 py-3 text-right">Quantidade</th></tr></thead><tbody>{detalhe.skus.map(item => <tr key={item.sku} className="border-b border-slate-100"><th scope="row" className="max-w-xs break-words px-3 py-3 font-medium">{item.sku}</th><td className="min-w-40 break-words px-3 py-3 text-slate-600">{item.tituloProduto || "—"}</td><td className="px-3 py-3 text-right font-semibold">{item.quantidade}</td></tr>)}</tbody></table></div>
    </Dialogo>}
    {confirmacao && <Dialogo titulo={confirmacao.tipo === "cancelar" ? "Cancelar esta busca?" : "Excluir este resultado?"} fechar={() => { if (!ocupado) setConfirmacao(null); }} ocupado={Boolean(ocupado)} rodape={<><button type="button" className={botao} disabled={Boolean(ocupado)} onClick={() => setConfirmacao(null)}>Voltar</button><button type="button" className={primario} disabled={Boolean(ocupado)} onClick={confirmar}>{ocupado ? "Confirmando…" : confirmacao.tipo === "cancelar" ? "Sim, cancelar busca" : "Sim, excluir resultado"}</button></>}><p className="text-sm text-slate-700">{confirmacao.tipo === "cancelar" ? "O progresso desta busca será descartado e nenhum resultado será publicado. Depois, você poderá iniciar uma nova busca." : "Os SKUs e pedidos vinculados serão removidos deste resultado. Esses pedidos poderão ser incluídos em uma nova busca."}</p>{erroDialogo && <p ref={erroDialogoRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erroDialogo}</p>}</Dialogo>}
  </div>;
}
