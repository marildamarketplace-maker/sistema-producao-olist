"use client";

import React, { useState, type FormEvent } from "react";
import { ENTIDADES_SYNC_LABEL, type ConfiguracaoSyncDto, type EntidadeSyncApi, type SalvarConfiguracaoSync } from "@/lib/olist-sync/api-contract";
import { dataSync, syncPanel, syncPrimary } from "@/components/olist-sync-ui";
import { ConfiguracaoIncrementalSync } from "@/components/olist-sync-incremental";

export function ConfiguracaoSync({ configuracao, podeEditar, salvar }: {
  configuracao: ConfiguracaoSyncDto; podeEditar: boolean;
  salvar: (dados: SalvarConfiguracaoSync) => Promise<void>;
}) {
  const [form, setForm] = useState<SalvarConfiguracaoSync>(() => ({
    versao: configuracao.versao, ativo: configuracao.ativo, entidades: configuracao.entidades,
    participantesIds: configuracao.participantes.filter((item) => item.habilitado).map((item) => item.id),
    horaDiaria: configuracao.horaDiaria, limiteAlteracoes: configuracao.limiteAlteracoes, prontidao: configuracao.prontidao,
  }));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const alternarEntidade = (entidade: EntidadeSyncApi, habilitado: boolean) => setForm((atual) => ({
    ...atual, entidades: habilitado ? [...atual.entidades, entidade] : atual.entidades.filter((item) => item !== entidade),
  }));
  async function enviar(event: FormEvent) {
    event.preventDefault(); setErro(null); setSalvo(false);
    if (form.participantesIds.length < 2) { setErro("Selecione pelo menos dois aplicativos filhos."); return; }
    if (form.entidades.length === 0) { setErro("Selecione pelo menos uma entidade."); return; }
    setOcupado(true);
    try { await salvar({ ...form, incrementalValidacoes: form.incrementalValidacoes?.filter(v => form.participantesIds.includes(v.aplicativoId) && form.entidades.includes(v.entidade)) }); setSalvo(true); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setOcupado(false); }
  }
  return <form className="space-y-4" onSubmit={enviar}>
    <section className={syncPanel}>
      <h3 className="break-words font-semibold">Grupo administrado por {configuracao.aplicativoPaiNome}</h3>
      <p className="mt-2 text-sm text-slate-600">A sincronização ocorre entre os filhos selecionados. O aplicativo pai administra regras e permissões. Novos filhos precisam ser incluídos explicitamente.</p>
      <fieldset disabled={!podeEditar || ocupado} className="mt-4 space-y-4 disabled:opacity-60">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" checked={form.ativo} onChange={(event) => setForm({ ...form, ativo: event.target.checked })} className="h-5 w-5" />Habilitar configuração do grupo</label>
        <fieldset><legend className="mb-2 text-sm font-medium">Empresas participantes</legend>
          <div className="grid gap-2 sm:grid-cols-2">{configuracao.aplicativosElegiveis.map((app) => <label key={app.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-200 p-3 text-sm">
            <input type="checkbox" checked={form.participantesIds.includes(app.id)} onChange={(event) => setForm((atual) => ({ ...atual, participantesIds: event.target.checked ? [...atual.participantesIds, app.id] : atual.participantesIds.filter((id) => id !== app.id) }))} className="h-5 w-5 shrink-0" /><span className="break-words">{app.nome}</span>
          </label>)}</div>
        </fieldset>
        <fieldset><legend className="mb-2 text-sm font-medium">Entidades auditadas</legend>
          <div className="grid gap-2 sm:grid-cols-2">{(Object.keys(ENTIDADES_SYNC_LABEL) as EntidadeSyncApi[]).map((entidade) => <label key={entidade} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={form.entidades.includes(entidade)} onChange={(event) => alternarEntidade(entidade, event.target.checked)} className="h-5 w-5 shrink-0" />
            <span>{ENTIDADES_SYNC_LABEL[entidade]}{["FORMA_PAGAMENTO", "VENDEDOR"].includes(entidade) && <span className="block text-xs text-slate-500">Somente auditoria e equivalência manual</span>}</span>
          </label>)}</div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Horário diário ({configuracao.fusoHorario})<input required type="time" value={form.horaDiaria} onChange={(event) => setForm({ ...form, horaDiaria: event.target.value })} className="input mt-1 min-h-11" /></label>
          <label className="text-sm font-medium">Limite por execução, entidade e destino<input required type="number" min={1} max={100} value={form.limiteAlteracoes} onChange={(event) => setForm({ ...form, limiteAlteracoes: Number(event.target.value) })} className="input mt-1 min-h-11" /></label>
        </div>
      </fieldset>
      <p className="mt-4 text-xs text-slate-500">Próxima execução: {dataSync(configuracao.proximaExecucaoEm)}. A agenda usa auditoria automática. Cada execução aplica até o limite configurado; o restante autorizado continua nas próximas execuções. Conflitos reais exigem revisão.</p>
    </section>
    <ConfiguracaoIncrementalSync configuracao={configuracao} participantesIds={form.participantesIds} entidades={form.entidades} validacoes={form.incrementalValidacoes ?? []} disabled={!podeEditar || ocupado} alterar={incrementalValidacoes => setForm(atual => ({ ...atual, incrementalValidacoes }))} />
    <section className={syncPanel}>
      <h3 className="font-semibold">Validações para aplicação</h3>
      <p className="mt-2 text-sm text-slate-600">Registre somente validações realizadas nas contas participantes. Habilitar estas opções não libera os jobs pausados.</p>
      <fieldset disabled={!podeEditar || ocupado} className="mt-4 space-y-2 disabled:opacity-60">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.prontidao.sincronizacaoNativaCompativel} onChange={(event) => setForm({ ...form, prontidao: { ...form.prontidao, sincronizacaoNativaCompativel: event.target.checked } })} /><span>Conferi que a sincronização nativa Olist não inclui empresas excluídas nem propaga estoque, preços, custos ou dados fiscais deste fluxo.</span></label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.prontidao.semanticaPutValidada} onChange={(event) => setForm({ ...form, prontidao: { ...form.prontidao, semanticaPutValidada: event.target.checked } })} /><span>Validei que a atualização dos campos permitidos preserva campos omitidos, incluindo estoque, preços, custos e dados fiscais.</span></label>
      </fieldset>
      <p className="mt-4 text-xs text-slate-500">Não são sincronizados estoque, preços, custos, pedidos, notas fiscais ou movimentações financeiras. Identidades e mudanças estruturais exigem revisão; origem não define precedência.</p>
    </section>
    <section className={syncPanel}>
      <h3 className="font-semibold">Jobs e permissão no aplicativo pai</h3>
      <ul className="mt-3 space-y-3">{configuracao.jobs.map((job) => <li key={job.chave} className="flex flex-wrap justify-between gap-2 text-sm"><span className="break-all">{job.chave}</span><span className={job.pausado || !job.permitidoNoPai ? "text-amber-800" : "text-emerald-700 dark:text-emerald-300"}>{job.pausado ? "Pausado globalmente" : "Ativo globalmente"} · {job.permitidoNoPai ? "Permitido no pai" : "Sem permissão no pai"}</span></li>)}</ul>
      <p className="mt-4 text-xs text-slate-500">Os controles globais ficam em configurações de jobs. A permissão de configurar este grupo não concede administração global.</p>
    </section>
    {erro && <p role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">{erro}</p>}
    {salvo && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Configuração salva.</p>}
    {podeEditar && <button className={syncPrimary} disabled={ocupado} type="submit">{ocupado ? "Salvando…" : "Salvar configuração"}</button>}
  </form>;
}
