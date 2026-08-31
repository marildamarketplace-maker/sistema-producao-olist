"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import type { EstampaJobPainel } from "@/services/consultarEstampaJobsPainelService";

const STATUS = ["TODOS", "PENDING", "PROCESSING", "WAITING_PROVIDER", "COMPLETED", "FAILED"] as const;
type FiltroStatus = (typeof STATUS)[number];

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
  const [jobs, setJobs] = useState<EstampaJobPainel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<EstampaJobPainel | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ limite: "100" });
      if (status !== "TODOS") params.set("status", status);
      const resposta = await fetch(`/api/estampas/jobs?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "Erro ao carregar os jobs.");
      setJobs(dados.jobs);
      setTotal(dados.total);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Erro ao carregar os jobs.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, status]);

  useEffect(() => { void carregar(); }, [carregar]);

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
      await carregar();
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
        <div className="flex flex-wrap gap-2" aria-label="Filtrar jobs por status">
          {STATUS.map((item) => (
            <button key={item} type="button" onClick={() => setStatus(item)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition ${status === item ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>
              {item === "TODOS" ? "Todos" : item}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void carregar()} disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      {mensagem && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{mensagem}</p>}
      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
          {loading ? "Carregando..." : `${jobs.length} de ${total} job(s)`}
        </div>
        <div className="overflow-x-auto">
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
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[job.status]}`}>{job.status}</span></td>
                  <td className="px-4 py-3 text-slate-600">{job.tentativas} / {job.maxTentativas}</td>
                  <td className="max-w-44 truncate px-4 py-3 text-slate-600" title={job.analise?.modelo ?? undefined}>{job.analise?.modelo ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatarData(job.finalizadoEm ?? job.iniciadoEm ?? job.criadoEm)}</td>
                  <td className="max-w-64 px-4 py-3 text-slate-600">{job.status === "FAILED" ? <span className="line-clamp-2 text-red-700" title={job.ultimoErro ?? undefined}>{job.ultimoErro ?? "Falha sem detalhe."}</span> : "—"}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2">
                    {job.analise && <button type="button" onClick={() => setSelecionado(job)} title="Visualizar análise" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"><Eye className="h-4 w-4" /></button>}
                    {podeReprocessar && job.status !== "PENDING" && job.status !== "PROCESSING" && job.status !== "WAITING_PROVIDER" && <button type="button" onClick={() => void reprocessar(job)} disabled={reprocessando === job.estampaId} className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">{reprocessando === job.estampaId ? "Solicitando..." : "Reprocessar IA"}</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selecionado && <Detalhes job={selecionado} onClose={() => setSelecionado(null)} />}
    </div>
  );
}

function Preview({ job }: { job: EstampaJobPainel }) {
  return job.previewUrl
    // A URL é dinâmica e pode vir de diferentes buckets autorizados do catálogo.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={job.previewUrl} alt={`Preview da estampa ${codigoCompleto(job)}`} width={56} height={56} className="h-14 w-14 rounded-md border border-slate-200 object-cover" loading="lazy" />
    : <div className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-500">Sem preview</div>;
}

function Detalhes({ job, onClose }: { job: EstampaJobPainel; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Resultado da análise de IA">
    <section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold text-slate-900">Análise de {codigoCompleto(job)}</h3><p className="mt-1 text-sm text-slate-500">Informações estruturadas produzidas pela IA.</p></div><button type="button" onClick={onClose} className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100" aria-label="Fechar"><X className="h-4 w-4" /></button></div>
      <dl className="mt-6 grid gap-4 rounded-md bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <Info titulo="Modelo" valor={job.analise?.modelo} /><Info titulo="Provider" valor={job.analise?.provider} /><Info titulo="Confiança" valor={formatarConfianca(job.analise?.confianca)} /><Info titulo="Data da análise" valor={formatarData(job.analise?.analisadoEm)} /><Info titulo="Fallback" valor={job.analise?.fallbackUtilizado == null ? null : job.analise.fallbackUtilizado ? "Sim" : "Não"} /><Info titulo="Solicitação manual" valor={job.processamentoManual ? "Sim" : "Não"} />
      </dl>
      <div className="mt-5"><h4 className="text-sm font-semibold text-slate-900">Resultado estruturado</h4><pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(job.analise?.resultado ?? {}, null, 2)}</pre></div>
    </section>
  </div>;
}

function Info({ titulo, valor }: { titulo: string; valor: string | null | undefined }) { return <div><dt className="text-xs font-semibold uppercase text-slate-500">{titulo}</dt><dd className="mt-1 text-slate-800">{valor ?? "—"}</dd></div>; }
function codigoCompleto(job: Pick<EstampaJobPainel, "codigo" | "variante">) { return [job.codigo, job.variante].filter(Boolean).join("-"); }
function formatarData(valor: string | null | undefined) { return valor ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(valor)) : "—"; }
function formatarConfianca(valor: number | null | undefined) { return valor == null ? null : `${Math.round(valor * 100)}%`; }
