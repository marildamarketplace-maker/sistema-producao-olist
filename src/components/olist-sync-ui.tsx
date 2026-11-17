"use client";

import React, { type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "@/hooks/use-modal-focus";
import {
  ORIGENS_SYNC_LABEL, textoValorSync,
  type EmpresaSyncDto, type PendenciaSyncDetalheDto, type RegistroSyncDto, type PrevisaoValidacaoSyncDto,
} from "@/lib/olist-sync/api-contract";

export const syncButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50";
export const syncPrimary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50";
export const syncPanel = "rounded-lg border border-slate-200 bg-white p-5";

export function dataSync(valor: string | null): string {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function duracaoSync(iniciadoEm: string | null, finalizadoEm: string | null): string {
  if (!iniciadoEm) return "Não iniciada";
  if (!finalizadoEm) return "Em andamento";
  const segundos = Math.floor((Date.parse(finalizadoEm) - Date.parse(iniciadoEm)) / 1000);
  if (!Number.isFinite(segundos) || segundos < 0) return "—";
  if (segundos < 60) return `${segundos}s`;
  if (segundos < 3600) return `${Math.floor(segundos / 60)}min ${segundos % 60}s`;
  return `${Math.floor(segundos / 3600)}h ${Math.floor(segundos % 3600 / 60)}min`;
}

export function PrevisaoValidacaoSync({ previsao, falhou }: { previsao: PrevisaoValidacaoSyncDto | null; falhou: boolean }) {
  const mensagens = {
    SEM_RITMO: "Sem validações nos últimos 30 minutos; previsão indisponível.",
    AMOSTRA_INSUFICIENTE: "Aguardando uma amostra de pelo menos 5 validações e 1 minuto de execução.",
    LISTANDO: "Aguardando o fim da listagem para conhecer o total de cadastros.",
    LEITURA_CONCLUIDA: "Leitura concluída; aguardando as demais etapas da execução.",
    PAUSADA: "Auditoria pausada ou desabilitada; previsão indisponível.",
  };
  return <div className="mt-3 space-y-1 text-sm text-slate-600">
    {previsao?.terminoPrevisto ? <p>Fim previsto da validação: <time className="font-medium text-slate-900" dateTime={previsao.terminoPrevisto}>{dataSync(previsao.terminoPrevisto)}</time></p>
      : <p>{previsao && previsao.estado !== "ESTIMADA" ? mensagens[previsao.estado]
        : falhou ? "Não foi possível consultar a previsão. Tente Atualizar novamente." : "Previsão indisponível. Clique em Atualizar para consultar."}</p>}
    {previsao && <p className="text-xs text-slate-500">
      {previsao.porMinuto !== null && <>{previsao.porMinuto.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} validações/min · {previsao.validadosNaJanela.toLocaleString("pt-BR")} na janela de até 30 min · </>}
      Calculada em {dataSync(previsao.calculadoEm)}. Atualizada somente ao carregar a página ou clicar em Atualizar.
    </p>}
    <p className="text-xs text-slate-500">Estimativa da leitura dos cadastros; comparação e aplicação podem levar tempo adicional.</p>
  </div>;
}

const STATUS: Record<string, string> = {
  PENDENTE: "Na fila", AUDITANDO: "Auditando", APLICANDO: "Aplicando", AGUARDANDO_RETRY: "Aguardando nova tentativa",
  CONCLUIDA: "Concluída", CONCLUIDA_COM_PENDENCIAS: "Concluída com pendências", FALHOU: "Falhou", CANCELADA: "Cancelada",
  NAO_VERIFICADO: "Não verificado", SINCRONIZADO: "Sincronizado", AUSENTE: "Ausente", DIVERGENTE: "Divergente",
  AGUARDANDO_REVISAO: "Aguardando revisão", ERRO: "Erro", INATIVO_EXCLUIDO: "Inativo ou excluído",
  APROVADA: "Aprovada", REJEITADA: "Rejeitada", IGNORADA: "Ignorada", RESOLVIDA: "Resolvida", CRITICA: "Crítica", ALTA: "Alta", MEDIA: "Média", INFORMATIVA: "Informativa",
  PROPOSTA: "Proposta", AUTORIZADA: "Autorizada", EM_APLICACAO: "Em aplicação", VERIFICANDO: "Verificando",
  CONFIRMADA: "Confirmada", RESULTADO_INCONCLUSIVO: "Resultado inconclusivo", OBSOLETA: "Obsoleta", FALHA_PERMANENTE: "Falha permanente",
};
export function StatusSync({ status }: { status: string }) {
  const classe = ["ERRO", "FALHOU", "CRITICA", "FALHA_PERMANENTE"].includes(status)
    ? "bg-red-50 text-red-700"
    : ["SINCRONIZADO", "CONCLUIDA", "CONFIRMADA"].includes(status)
      ? "bg-emerald-50 text-emerald-700 dark:text-emerald-300"
      : ["DIVERGENTE", "AGUARDANDO_REVISAO", "CONCLUIDA_COM_PENDENCIAS", "RESULTADO_INCONCLUSIVO", "ALTA"].includes(status)
        ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex max-w-full rounded-md px-2 py-1 text-xs font-medium ${classe}`}>{STATUS[status] ?? status.replaceAll("_", " ").toLowerCase()}</span>;
}

export function PaginacaoSync({ offset, total, limit, ocupado, mudar }: {
  offset: number; total: number; limit: number; ocupado: boolean; mudar: (offset: number) => void;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
    <span className="text-sm text-slate-500">{total === 0 ? "Nenhum resultado" : `${offset + 1}–${Math.min(offset + limit, total)} de ${total}`}</span>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={syncButton} disabled={ocupado || offset === 0} onClick={() => mudar(Math.max(0, offset - limit))}>Anterior</button>
      <button type="button" className={syncButton} disabled={ocupado || offset + limit >= total} onClick={() => mudar(offset + limit)}>Próxima</button>
    </div>
  </div>;
}

export function DialogoSync({ titulo, fechar, ocupado, children }: {
  titulo: string; fechar: () => void; ocupado: boolean; children: ReactNode;
}) {
  const modal = useModalFocus(() => { if (!ocupado) fechar(); });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
    <div ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="olist-sync-dialog-title"
      className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:px-6">
        <h2 id="olist-sync-dialog-title" className="pt-2 text-lg font-semibold text-slate-900">{titulo}</h2>
        <button type="button" onClick={fechar} disabled={ocupado} aria-label="Fechar diálogo" className={`${syncButton} min-w-11 shrink-0 px-2`}><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
    </div>
  </div>;
}

export function OrigemSync({ registro, empresas }: { registro: RegistroSyncDto; empresas: EmpresaSyncDto[] }) {
  const nome = (id: string | null) => id ? empresas.find((empresa) => empresa.id === id)?.nome ?? id : "—";
  return <dl className="space-y-2 text-sm">
    <div><dt className="text-xs text-slate-500">Proveniência</dt><dd className="mt-1 font-medium">{ORIGENS_SYNC_LABEL[registro.origemTipo]}</dd></div>
    {registro.aplicativoOrigemId && <div><dt className="text-xs text-slate-500">Aplicativo original</dt><dd className="break-words">{nome(registro.aplicativoOrigemId)} · ID {registro.registroOlistOrigemId ?? "—"}</dd></div>}
    <div><dt className="text-xs text-slate-500">Última fonte de alteração</dt><dd className="break-words">{nome(registro.ultimaFonteAppId)}</dd></div>
    {registro.origemRegistradaEm && <div><dt className="text-xs text-slate-500">Origem registrada em</dt><dd>{dataSync(registro.origemRegistradaEm)}</dd></div>}
    {registro.origemTipo === "OBSERVADA_PELO_MODULO" && <p className="text-xs text-slate-500">Primeira observação exclusiva em auditoria completa; não comprova o criador histórico na Olist.</p>}
  </dl>;
}

/** Cards no mobile; colunas lado a lado no desktop. Valores sempre escapados pelo React. */
export function ComparacaoSync({ detalhe }: { detalhe: PendenciaSyncDetalheDto }) {
  if (detalhe.comparacao.length === 0) return <p className="text-sm text-slate-500">Não há comparação de campos disponível. Solicite uma nova auditoria antes de aplicar alterações.</p>;
  const campos = [...new Set(detalhe.comparacao.flatMap((item) => Object.keys(item.campos)))].sort();
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2">
    {detalhe.comparacao.map((item) => <section key={`${item.aplicativoId}:${item.registroOlistId}`} className="min-w-0 rounded-lg border border-slate-200 p-4">
      <h3 className="break-words font-semibold text-slate-900">{item.nome}</h3>
      <p className="mt-1 break-all text-xs text-slate-500">ID Olist {item.registroOlistId}</p>
      <dl className="mt-4 space-y-3">
        {campos.map((campo) => {
          const valores = new Set(detalhe.comparacao.map((registro) => JSON.stringify(registro.campos[campo])));
          return <div key={campo} className={valores.size > 1 ? "rounded-md bg-amber-50 p-2" : "p-2"}>
            <dt className="break-words text-xs font-medium text-slate-600">{campo}{valores.size > 1 ? " · divergente" : ""}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900 [overflow-wrap:anywhere]">{textoValorSync(item.campos[campo])}</dd>
          </div>;
        })}
      </dl>
    </section>)}
  </div>;
}
