"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Feedback, painel, secundario, TelaAutomatizacao, useAutomatizacaoApi } from "@/components/automatizacao/compartilhado";

type Execucao = {
  id: string; status: string; tipo: string; previstoEm: string;
  rotina: { nome: string }; versao: { numero: number };
  tentativas: {
    iniciadaEm: string; encerradaEm: string | null; status: string; resultado: string | null;
    avisos: { notification: { id: string; status: string } }[];
  }[];
};
type Historico = {
  execucoes: Execucao[];
  disparos: { rotina: { nome: string }; previstoEm: string; motivo: string }[];
  temMais: boolean;
};
type Rotina = { id: string; nome: string };

const formato = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const statusLabel: Record<string, string> = {
  PENDENTE: "Pendente", EM_EXECUCAO: "Em execução", AGUARDANDO_RETRY: "Aguardando retentativa",
  CONCLUIDA: "Concluída", FALHA_FINAL: "Falha final", RESERVA_EXPIRADA: "Reserva expirada",
  INDISPONIVEL: "Executor indisponível", SOBREPOSICAO: "Execução anterior em aberto",
  FALHA_ANTERIOR: "Falha anterior bloqueia a rotina", SUPERADO: "Horário mais recente priorizado",
  ATRASO_AGREGADO: "Janela anterior ignorada por atraso",
};
const statusWhatsApp: Record<string, string> = {
  PENDENTE: "Pendente", SUCESSO: "Aceito pelo provedor", ERRO: "Falha no envio",
};

export default function HistoricoPage() {
  return <TelaAutomatizacao titulo="Histórico" descricao="Acompanhe execuções, tentativas e notificações."><HistoricoConteudo /></TelaAutomatizacao>;
}

function HistoricoConteudo() {
  const api = useAutomatizacaoApi();
  const { usuario } = useAuth();
  const [historico, setHistorico] = useState<Historico>({ execucoes: [], disparos: [], temMais: false });
  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [rotinaId, setRotinaId] = useState("");
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
  }, [api, desde, pagina, rotinaId, status, whatsapp]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { void api<Rotina[]>("rotinas").then(setRotinas).catch(() => setErro("Não foi possível carregar as rotinas.")); }, [api]);

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
      <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 text-sm">Rotina<select className="input mt-1 min-h-11 w-full" value={rotinaId} onChange={(e) => { setRotinaId(e.target.value); setPagina(0); }}>
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
        <button className={secundario} disabled={carregando} onClick={() => void carregar()}>Atualizar</button>
      </div>
    </section>
    <Feedback {...{ carregando, erro, sucesso }} />
    {!carregando && !historico.execucoes.length && !historico.disparos.length && <p>Nenhum registro encontrado.</p>}
    {historico.execucoes.map((item) => <article className={painel} key={item.id}>
      <h2 className="break-words font-semibold">{item.rotina.nome}</h2>
      <p className="text-sm">{statusLabel[item.status]} · {formato.format(new Date(item.previstoEm))} · Habilidade v{item.versao.numero}</p>
      {item.tentativas.length > 0 && <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">Ver tentativas e WhatsApp</summary>
        <ul className="space-y-3">{item.tentativas.map((tentativa, indice) => <li key={indice} className="border-t border-slate-200 pt-2 text-sm">
          <p>{formato.format(new Date(tentativa.iniciadaEm))} · {statusLabel[tentativa.status]}</p>
          <p>WhatsApp · {tentativa.avisos.length ? tentativa.avisos.map(({ notification }) => statusWhatsApp[notification.status]).join(", ") : "Não aplicável"}</p>
          {usuario?.podeIntervirAutomatizacao && tentativa.avisos.filter(({ notification }) => notification.status === "ERRO").map(({ notification }, i) =>
            <button key={notification.id} className={secundario} disabled={salvando || carregando} onClick={() => void retentar(notification.id, true)}>Reenviar aviso {i + 1}</button>
          )}
          {tentativa.resultado && <pre className="mt-1 whitespace-pre-wrap break-words">{tentativa.resultado}</pre>}
        </li>)}</ul>
      </details>}
      {usuario?.podeIntervirAutomatizacao && item.status === "FALHA_FINAL" &&
        <button className={secundario} disabled={salvando || carregando} onClick={() => void retentar(item.id)}>Retentar execução</button>}
    </article>)}
    {historico.disparos.length > 0 && <section className={painel}>
      <h2 className="font-semibold">Disparos ignorados</h2>
      <ul className="space-y-2 text-sm">{historico.disparos.map((item, indice) => <li className="break-words" key={indice}>
        {formato.format(new Date(item.previstoEm))} · {item.rotina.nome} · {statusLabel[item.motivo]}
      </li>)}</ul>
    </section>}
    <nav aria-label="Paginação do histórico" className="flex flex-wrap items-center gap-2">
      <button className={secundario} disabled={pagina === 0 || carregando} onClick={() => setPagina(pagina - 1)}>Anterior</button>
      <span className="text-sm">Página {pagina + 1}</span>
      <button className={secundario} disabled={!historico.temMais || carregando} onClick={() => setPagina(pagina + 1)}>Próxima</button>
    </nav>
  </div>;
}
