"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Feedback, painel, secundario, TelaAutomatizacao, useAutomatizacaoApi } from "@/components/automatizacao/compartilhado";

import { dataHistorico, HistoricoExecucao, statusLabel, statusWhatsApp, type ExecucaoHistorico } from "@/components/automatizacao/historico-execucao";

type Historico = {
  execucoes: ExecucaoHistorico[];
  disparos: { rotina: { nome: string }; previstoEm: string; motivo: string }[];
  temMais: boolean;
};
type Rotina = { id: string; nome: string };
type Habilidade = { id: string; nome: string };

export default function HistoricoPage() {
  return <TelaAutomatizacao titulo="Histórico" descricao="Acompanhe execuções, tentativas e notificações."><Suspense fallback={<Feedback carregando />}><HistoricoFiltrosUrl /></Suspense></TelaAutomatizacao>;
}

function HistoricoFiltrosUrl() {
  const busca = useSearchParams();
  const router = useRouter();
  const rotinaId = busca.get("rotinaId") ?? "";
  const habilidadeId = busca.get("habilidadeId") ?? "";
  function mudarEscopo(rotina: string, habilidade: string) {
    const query = new URLSearchParams();
    if (rotina) query.set("rotinaId", rotina);
    if (habilidade) query.set("habilidadeId", habilidade);
    router.replace(`/automatizacao/historico${query.size ? `?${query}` : ""}`, { scroll: false });
  }
  return <HistoricoConteudo key={`${rotinaId}:${habilidadeId}`} {...{ rotinaId, habilidadeId, mudarEscopo }} />;
}

function HistoricoConteudo({ rotinaId, habilidadeId, mudarEscopo }: {
  rotinaId: string; habilidadeId: string; mudarEscopo: (rotina: string, habilidade: string) => void;
}) {
  const api = useAutomatizacaoApi();
  const { usuario } = useAuth();
  const [historico, setHistorico] = useState<Historico>({ execucoes: [], disparos: [], temMais: false });
  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [habilidades, setHabilidades] = useState<Habilidade[]>([]);
  const [status, setStatus] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [desde, setDesde] = useState("");
  const [pagina, setPagina] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const ultimaConsulta = useRef(0);
  const carregar = useCallback(async () => {
    const consulta = ++ultimaConsulta.current;
    setCarregando(true);
    setErro("");
    const query = new URLSearchParams({ pagina: String(pagina) });
    if (rotinaId) query.set("rotinaId", rotinaId);
    if (habilidadeId) query.set("habilidadeId", habilidadeId);
    if (status) query.set("status", status);
    if (whatsapp) query.set("whatsapp", whatsapp);
    if (desde) query.set("desde", desde);
    try {
      const resultado = await api<Historico>(`historico?${query}`);
      if (consulta === ultimaConsulta.current) setHistorico(resultado);
    } catch (error) {
      if (consulta === ultimaConsulta.current) setErro((error as Error).message);
    } finally {
      if (consulta === ultimaConsulta.current) setCarregando(false);
    }
  }, [api, desde, pagina, rotinaId, habilidadeId, status, whatsapp]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    let ativa = true;
    void Promise.all([api<Rotina[]>("rotinas"), api<Habilidade[]>("habilidades")]).then(([listaRotinas, listaHabilidades]) => {
      if (ativa) { setRotinas(listaRotinas); setHabilidades(listaHabilidades); }
    }).catch(() => { if (ativa) setErro("Não foi possível carregar os filtros de rotinas e habilidades."); });
    return () => { ativa = false; };
  }, [api]);

  async function retentar(id: string, reenviar = false) {
    setSalvando(true);
    setSucesso("");
    setErro("");
    try {
      await api(`historico?id=${id}${reenviar ? "&acao=reenviar" : ""}`, "POST");
      setSucesso(reenviar ? "Notificação reenfileirada." : "Execução reenfileirada.");
      await carregar();
    } catch (error) { setErro((error as Error).message); }
    finally { setSalvando(false); }
  }

  return <div className="space-y-4">
    <section aria-label="Filtros do histórico" className={painel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Filtros do histórico</h2><p className="mt-1 text-xs text-slate-500">Combine filtros para localizar uma execução.</p></div>
        <div className="flex flex-wrap gap-2">
          <button className={secundario} disabled={!rotinaId && !habilidadeId && !status && !whatsapp && !desde} onClick={() => { mudarEscopo("", ""); setStatus(""); setWhatsapp(""); setDesde(""); setPagina(0); }}>Limpar filtros</button>
          <button className={secundario} disabled={carregando} onClick={() => void carregar()}>Atualizar</button>
        </div>
      </div>
      <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 text-sm">Habilidade<select className="input mt-1 min-h-11 w-full" value={habilidadeId} onChange={(e) => mudarEscopo("", e.target.value)}>
          <option value="">Todas</option>{habilidades.map((habilidade) => <option key={habilidade.id} value={habilidade.id}>{habilidade.nome}</option>)}
        </select></label>
        <label className="min-w-0 text-sm">Rotina<select className="input mt-1 min-h-11 w-full" value={rotinaId} onChange={(e) => mudarEscopo(e.target.value, habilidadeId)}>
          <option value="">Todas</option>{rotinas.map((rotina) => <option key={rotina.id} value={rotina.id}>{rotina.nome}</option>)}
        </select></label>
        <label className="text-sm">Situação<select className="input mt-1 min-h-11 w-full" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(0); }}>
          <option value="">Todas</option>{["PENDENTE", "EM_EXECUCAO", "AGUARDANDO_RETRY", "CONCLUIDA", "FALHA_FINAL"].map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}
        </select></label>
        <label className="min-w-0 text-sm">Desde<input type="date" className="input mt-1 min-h-11 w-full" value={desde} onChange={(e) => { setDesde(e.target.value); setPagina(0); }} /></label>
        <label className="text-sm">WhatsApp<select className="input mt-1 min-h-11 w-full" value={whatsapp} onChange={(e) => { setWhatsapp(e.target.value); setPagina(0); }}>
          <option value="">Todos</option>
          {Object.entries(statusWhatsApp).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="NAO_APLICAVEL">Não aplicável</option>
        </select></label>
      </div>
    </section>
    {habilidadeId && <p className="break-words text-sm text-slate-600" role="status">Histórico da habilidade: {habilidades.find((item) => item.id === habilidadeId)?.nome ?? habilidadeId}. Inclui todas as versões executadas. Disparos ignorados podem ser consultados pelo filtro de rotina, sem filtro de habilidade.</p>}
    <Feedback {...{ carregando, erro, sucesso }} />
    <section aria-labelledby="execucoes-titulo" aria-busy={carregando} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 id="execucoes-titulo" className="text-lg font-semibold">Execuções</h2><p className="text-xs text-slate-500">Mais recentes primeiro · horários de Brasília</p></div>
        <span className="text-sm text-slate-500">{historico.execucoes.length} nesta página</span>
      </div>
      {!carregando && !erro && !historico.execucoes.length && <div className={`${painel} text-center`}>
        <p className="font-medium">Nenhuma execução encontrada</p><p className="text-sm text-slate-500">Ajuste os filtros ou atualize o histórico para consultar novos registros.</p>
      </div>}
      {historico.execucoes.map((item) => <HistoricoExecucao key={item.id} item={item} podeIntervir={!!usuario?.podeIntervirAutomatizacao} ocupado={salvando || carregando} onRetentar={(id, reenviar) => void retentar(id, reenviar)} />)}
    </section>
    {historico.disparos.length > 0 && <section className={painel} aria-labelledby="disparos-titulo">
      <div><h2 id="disparos-titulo" className="font-semibold">Disparos ignorados <span className="text-sm font-normal text-slate-500">({historico.disparos.length})</span></h2>
      <p className="mt-1 text-xs text-slate-500">Horários que não geraram execução e seus motivos. Os filtros de situação e WhatsApp se aplicam somente às execuções.</p></div>
      <ul className="divide-y divide-slate-200">{historico.disparos.map((item, indice) => <li className="grid min-w-0 gap-2 py-3 text-sm first:pt-0 last:pb-0 lg:grid-cols-3" key={indice}>
        <span className="break-words font-medium">{item.rotina.nome}</span>
        <span className="text-slate-500">{dataHistorico(item.previstoEm)}</span>
        <span className="break-words text-slate-600">{statusLabel[item.motivo] ?? item.motivo}</span>
      </li>)}</ul>
    </section>}
    <nav aria-label="Paginação do histórico" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <button className={secundario} disabled={pagina === 0 || carregando} onClick={() => setPagina(pagina - 1)}>Anterior</button>
      <span className="text-sm">Página {pagina + 1}</span>
      <button className={secundario} disabled={!historico.temMais || carregando} onClick={() => setPagina(pagina + 1)}>Próxima</button>
    </nav>
  </div>;
}
