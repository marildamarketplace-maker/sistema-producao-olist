"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { PageHeader } from "@/components/page-header";
import type { EstampaJobPainel } from "@/services/consultarEstampaJobsPainelService";

const STATUS = ["TODOS", "PENDING", "PROCESSING", "WAITING_PROVIDER", "COMPLETED", "FAILED"] as const;
type FiltroStatus = (typeof STATUS)[number];

const rotulosStatus: Record<FiltroStatus, string> = {
  TODOS: "Todos", PENDING: "Pendentes", PROCESSING: "Processando",
  WAITING_PROVIDER: "Aguardando provedor", COMPLETED: "Concluídos", FAILED: "Falhas",
};

const statusClasses: Record<Exclude<FiltroStatus, "TODOS">, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  PROCESSING: "bg-blue-50 text-blue-700",
  WAITING_PROVIDER: "bg-violet-50 text-violet-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

export function EstampaJobsClient() {
  const { session, usuario } = useAuth();
  const podeReprocessar = Boolean(usuario?.podeEditarEstampas);
  const [status, setStatus] = useState<FiltroStatus>("TODOS");
  const [pagina, setPagina] = useState(1);
  const [atualizacao, setAtualizacao] = useState(0);
  const limite = 100;
  const [jobs, setJobs] = useState<EstampaJobPainel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<EstampaJobPainel | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    if (!session?.access_token) return;
    setLoading(true);
    setJobs([]);
    setErro(null);
    try {
      const params = new URLSearchParams({ limite: String(limite), offset: String((pagina - 1) * limite) });
      if (status !== "TODOS") params.set("status", status);
      const resposta = await fetch(`/api/estampas/jobs?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal,
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "Erro ao carregar os jobs.");
      if (signal.aborted) return;
      const ultimaPagina = Math.max(1, Math.ceil(dados.total / limite));
      if (pagina > ultimaPagina) { setPagina(ultimaPagina); return; }
      setJobs(dados.jobs);
      setTotal(dados.total);
    } catch (cause) {
      if (signal.aborted) return;
      setErro(cause instanceof Error ? cause.message : "Erro ao carregar os jobs.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [session?.access_token, status, pagina]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar, atualizacao]);

  function filtrar(proximoStatus: FiltroStatus) {
    setPagina(1);
    setStatus(proximoStatus);
  }

  async function reprocessar(job: EstampaJobPainel) {
    if (!session?.access_token || !podeReprocessar) return;
    if (!window.confirm(`Solicitar novo processamento para ${codigoCompleto(job)}?`)) return;
    setReprocessando(job.estampaId);
    setMensagem(null);
    setErro(null);
    try {
      const resposta = await fetch(`/api/estampas/${job.estampaId}/reprocessar-ia`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "Erro ao solicitar reprocessamento.");
      setMensagem(`Reprocessamento de ${codigoCompleto(job)} solicitado com sucesso.`);
      setAtualizacao((valor) => valor + 1);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Erro ao solicitar reprocessamento.");
    } finally {
      setReprocessando(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Jobs de IA das estampas" description="Acompanhe o processamento visual e solicite novas análises quando necessário." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700 sm:hidden">
          Status
          <select value={status} onChange={(event) => filtrar(event.target.value as FiltroStatus)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base">
            {STATUS.map((item) => <option key={item} value={item}>{rotulosStatus[item]}</option>)}
          </select>
        </label>
        <div className="hidden flex-wrap gap-2 sm:flex" aria-label="Filtrar jobs por status">
          {STATUS.map((item) => (
            <button key={item} type="button" aria-pressed={status === item} onClick={() => filtrar(item)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition ${status === item ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>
              {rotulosStatus[item]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAtualizacao((valor) => valor + 1)} disabled={loading}
          className="inline-flex min-h-11 items-center gap-2 self-end rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      {mensagem && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{mensagem}</p>}
      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
          {loading ? "Carregando..." : `${jobs.length} de ${total} job(s)`}
        </div>
        <div className="divide-y divide-slate-200 sm:hidden">
          {!loading && jobs.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">Nenhum job encontrado.</p>}
          {jobs.map((job) => (
            <article key={job.id} aria-label={`Job da estampa ${codigoCompleto(job)}`} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="shrink-0"><Preview job={job} /></div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h2 className="break-words font-semibold text-slate-900">{codigoCompleto(job)}</h2>
                  <StatusJob job={job} />
                </div>
              </div>
              <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
                <Info titulo="Tentativa atual" valor={`${job.tentativas} / ${job.maxTentativas}`} />
                <Info titulo="Data" valor={formatarData(job.finalizadoEm ?? job.iniciadoEm ?? job.criadoEm)} />
                <div className="col-span-2"><Info titulo="Modelo" valor={job.modeloUtilizado} /></div>
              </dl>
              {job.status === "FAILED" && <p className="break-words rounded-md bg-red-50 p-3 text-sm text-red-700">{job.ultimoErro ?? "Falha sem detalhe."}</p>}
              <AcoesJob job={job} podeReprocessar={podeReprocessar} reprocessando={reprocessando} onDetalhes={setSelecionado} onReprocessar={reprocessar} />
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>{["Preview", "Código", "Variante", "Status", "Tentativa atual", "Modelo", "Data", "Erro", "Ações"].map((titulo) => <th key={titulo} className="px-4 py-3">{titulo}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {!loading && jobs.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Nenhum job encontrado.</td></tr>}
              {jobs.map((job) => (
                <tr key={job.id} className="align-middle">
                  <td className="px-4 py-3"><Preview job={job} /></td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{job.codigo}</td>
                  <td className="px-4 py-3 text-slate-600">{job.variante ?? "—"}</td>
                  <td className="px-4 py-3"><StatusJob job={job} /></td>
                  <td className="px-4 py-3 text-slate-600">{job.tentativas} / {job.maxTentativas}</td>
                  <td className="max-w-44 truncate px-4 py-3 text-slate-600" title={job.modeloUtilizado ?? undefined}>{job.modeloUtilizado ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatarData(job.finalizadoEm ?? job.iniciadoEm ?? job.criadoEm)}</td>
                  <td className="max-w-64 px-4 py-3 text-slate-600">{job.status === "FAILED" ? <details><summary className="min-h-11 cursor-pointer py-3 font-medium text-red-700">Ver erro completo</summary><p className="whitespace-pre-wrap break-words text-red-700">{job.ultimoErro ?? "Falha sem detalhe."}</p></details> : "—"}</td>
                  <td className="px-4 py-3"><AcoesJob job={job} podeReprocessar={podeReprocessar} reprocessando={reprocessando} onDetalhes={setSelecionado} onReprocessar={reprocessar} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {total > limite && <nav aria-label="Paginação dos jobs" className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" disabled={loading || pagina <= 1} onClick={() => setPagina((valor) => valor - 1)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm disabled:opacity-50">Anterior</button>
        <span role="status" className="text-sm text-slate-600">Página {pagina} de {Math.max(1, Math.ceil(total / limite))}</span>
        <button type="button" disabled={loading || pagina >= Math.ceil(total / limite)} onClick={() => setPagina((valor) => valor + 1)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm disabled:opacity-50">Próxima</button>
      </nav>}
      {selecionado && <Detalhes job={selecionado} onClose={() => setSelecionado(null)} />}
    </div>
  );
}

function StatusJob({ job }: { job: EstampaJobPainel }) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[job.status]}`}>{rotulosStatus[job.status]}</span>;
}

function AcoesJob({ job, podeReprocessar, reprocessando, onDetalhes, onReprocessar }: {
  job: EstampaJobPainel;
  podeReprocessar: boolean;
  reprocessando: string | null;
  onDetalhes: (job: EstampaJobPainel) => void;
  onReprocessar: (job: EstampaJobPainel) => Promise<void>;
}) {
  return <div className="flex flex-wrap items-center gap-2">
    {job.analise && <button type="button" onClick={() => onDetalhes(job)} aria-label={`Visualizar análise de ${codigoCompleto(job)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-100"><Eye className="h-4 w-4" /><span className="sm:hidden">Ver análise</span></button>}
    {podeReprocessar && job.status !== "PENDING" && job.status !== "PROCESSING" && job.status !== "WAITING_PROVIDER" && <button type="button" onClick={() => void onReprocessar(job)} disabled={reprocessando === job.estampaId} className="min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">{reprocessando === job.estampaId ? "Solicitando..." : "Reprocessar IA"}</button>}
  </div>;
}

function Preview({ job }: { job: EstampaJobPainel }) {
  return job.previewUrl
    // A URL é dinâmica e pode vir de diferentes buckets autorizados do catálogo.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={job.previewUrl} alt={`Preview da estampa ${codigoCompleto(job)}`} width={56} height={56} className="h-14 w-14 rounded-md border border-slate-200 object-cover" loading="lazy" />
    : <div className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-500">Sem preview</div>;
}

function Detalhes({ job, onClose }: { job: EstampaJobPainel; onClose: () => void }) {
  const modal = useModalFocus(onClose);
  return <div ref={modal} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Resultado da análise de IA">
    <section className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold text-slate-900">Análise de {codigoCompleto(job)}</h3><p className="mt-1 text-sm text-slate-500">Resultado atual do catálogo; pode pertencer a uma execução posterior a este job.</p></div><button type="button" onClick={onClose} className="min-h-11 min-w-11 shrink-0 rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100" aria-label="Fechar"><X className="h-4 w-4" /></button></div>
      <dl className="mt-6 grid gap-4 rounded-md bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <Info titulo="Modelo" valor={job.modeloUtilizado} /><Info titulo="Modelo da análise atual" valor={job.analise?.modelo} /><Info titulo="Provider" valor={job.analise?.provider} /><Info titulo="Confiança" valor={formatarConfianca(job.analise?.confianca)} /><Info titulo="Data da análise" valor={formatarData(job.analise?.analisadoEm)} /><Info titulo="Fallback" valor={job.analise?.fallbackUtilizado == null ? null : job.analise.fallbackUtilizado ? "Sim" : "Não"} /><Info titulo="Solicitação manual" valor={job.processamentoManual ? "Sim" : "Não"} />
      </dl>
      <div className="mt-5"><h4 className="text-sm font-semibold text-slate-900">Resultado estruturado</h4><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(job.analise?.resultado ?? {}, null, 2)}</pre></div>
    </section>
  </div>;
}

function Info({ titulo, valor }: { titulo: string; valor: string | null | undefined }) { return <div><dt className="text-xs font-semibold uppercase text-slate-500">{titulo}</dt><dd className="mt-1 break-words text-slate-800">{valor ?? "—"}</dd></div>; }
function codigoCompleto(job: Pick<EstampaJobPainel, "codigo" | "variante">) { return [job.codigo, job.variante].filter(Boolean).join("-"); }
function formatarData(valor: string | null | undefined) { return valor ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(valor)) : "—"; }
function formatarConfianca(valor: number | null | undefined) { return valor == null ? null : `${Math.round(valor * 100)}%`; }
