import React from "react";
import { secundario } from "./estilos";

export type ExecucaoHistorico = {
  id: string; status: string; tipo: string; previstoEm: string;
  rotina: { nome: string }; versao: { numero: number };
  tentativas: {
    iniciadaEm: string; encerradaEm: string | null; status: string; resultado: string | null;
    avisos: { notification: { id: string; status: string } }[];
  }[];
};

const formato = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
export function dataHistorico(valor: string) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "Data indisponível" : formato.format(data);
}

export const statusLabel: Record<string, string> = {
  PENDENTE: "Pendente", EM_EXECUCAO: "Em execução", AGUARDANDO_RETRY: "Aguardando retentativa",
  CONCLUIDA: "Concluída", FALHA_FINAL: "Falha final", RESERVA_EXPIRADA: "Reserva expirada",
  INDISPONIVEL: "Executor indisponível", SOBREPOSICAO: "Execução anterior em aberto",
  FALHA_ANTERIOR: "Falha anterior bloqueia a rotina", SUPERADO: "Horário mais recente priorizado",
  ATRASO_AGREGADO: "Janela anterior ignorada por atraso",
};
export const statusWhatsApp: Record<string, string> = {
  PENDENTE: "Pendente", SUCESSO: "Aceito pelo provedor", ERRO: "Falha no envio",
};

export function SituacaoHistorico({ status }: { status: string }) {
  const cor = status === "CONCLUIDA" || status === "SUCESSO"
    ? "bg-emerald-50 text-emerald-700 dark:text-emerald-300"
    : ["FALHA_FINAL", "ERRO", "RESERVA_EXPIRADA"].includes(status)
      ? "bg-red-50 text-red-700"
      : ["PENDENTE", "AGUARDANDO_RETRY", "EM_EXECUCAO"].includes(status)
        ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex max-w-full items-center rounded-md px-2 py-1 text-xs font-medium ${cor}`}>
    {statusLabel[status] ?? statusWhatsApp[status] ?? status}
  </span>;
}

export function HistoricoExecucao({ item, podeIntervir, ocupado, onRetentar }: {
  item: ExecucaoHistorico; podeIntervir: boolean; ocupado: boolean;
  onRetentar: (id: string, reenviar?: boolean) => void;
}) {
  return <article className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-slate-500">{item.tipo === "TESTE_ROTINA" ? "Teste de rotina" : "Execução de rotina"}</p>
          <h3 className="break-words font-semibold text-slate-900">{item.rotina.nome}</h3>
        </div>
        <div className="shrink-0"><SituacaoHistorico status={item.status} /></div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Horário previsto · Brasília</dt><dd className="mt-1">{dataHistorico(item.previstoEm)}</dd></div>
        <div><dt className="text-xs text-slate-500">Habilidade</dt><dd className="mt-1">Versão {item.versao.numero}</dd></div>
        <div><dt className="text-xs text-slate-500">Tentativas</dt><dd className="mt-1">{item.tentativas.length || "Ainda não iniciada"}</dd></div>
      </dl>
      {podeIntervir && item.tipo !== "TESTE_ROTINA" && item.status === "FALHA_FINAL" &&
        <button className={secundario} disabled={ocupado} onClick={() => onRetentar(item.id)}>Retentar execução</button>}
    </div>
    {item.tentativas.length > 0 && <details className="group border-t border-slate-200">
      <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-offset-[-2px]">Ver tentativas, resultados e WhatsApp ({item.tentativas.length})</summary>
      <ol className="space-y-4 border-t border-slate-200 bg-slate-50 p-4 sm:p-5" aria-label="Tentativas, mais recentes primeiro">
        {item.tentativas.map((tentativa, indice) => <li key={`${tentativa.iniciadaEm}-${indice}`} className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Tentativa {item.tentativas.length - indice}{indice === 0 && <span className="ml-2 text-xs font-normal text-slate-500">Mais recente</span>}</h4>
            <SituacaoHistorico status={tentativa.status} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Início · Brasília</dt><dd className="mt-1">{dataHistorico(tentativa.iniciadaEm)}</dd></div>
            <div><dt className="text-xs text-slate-500">Encerramento · Brasília</dt><dd className="mt-1">{tentativa.encerradaEm ? dataHistorico(tentativa.encerradaEm) : "Não registrado"}</dd></div>
          </dl>
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <p className="text-xs font-medium text-slate-500">Notificações WhatsApp</p>
            {!tentativa.avisos.length ? <p className="text-sm text-slate-500">Não aplicável</p> : <ul className="space-y-2">
              {tentativa.avisos.map(({ notification }, i) => <li key={notification.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>Aviso {i + 1}</span><SituacaoHistorico status={notification.status} />
                {podeIntervir && notification.status === "ERRO" && <button className={secundario} disabled={ocupado} onClick={() => onRetentar(notification.id, true)}>Reenviar aviso {i + 1}</button>}
              </li>)}
            </ul>}
          </div>
          {tentativa.resultado && <div className="space-y-2 border-t border-slate-200 pt-3">
            <p className="text-xs font-medium text-slate-500">Resultado da tentativa</p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed [overflow-wrap:anywhere]" tabIndex={0} aria-label="Resultado da tentativa">{tentativa.resultado}</pre>
          </div>}
        </li>)}
      </ol>
    </details>}
  </article>;
}
