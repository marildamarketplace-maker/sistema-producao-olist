"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import { BloqueioExplicado } from "./bloqueio-explicado";

export type DisponibilidadeEnvioFornecedor = { temFornecedor: boolean; podeEnviar: boolean; motivoBloqueio: string | null };
const classe = "inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 disabled:opacity-40";

export function AcaoFilaProducao({ solicitacaoId, status, aoVerDetalhes, autenticado, filaDisponivel, podeSolicitar, disponibilidade }: {
  solicitacaoId: string; status?: string; aoVerDetalhes: () => void; autenticado: boolean; filaDisponivel: boolean;
  podeSolicitar: boolean; disponibilidade: DisponibilidadeEnvioFornecedor | null;
}) {
  if (status) return <button type="button" onClick={aoVerDetalhes} aria-haspopup="dialog" aria-label={`Ver detalhes da fila: ${status}`}
    disabled={!autenticado || !filaDisponivel} className={classe}><Send className="h-4 w-4" aria-hidden="true" />{status}</button>;
  if (disponibilidade?.temFornecedor === false) return null;
  const motivo = !autenticado ? "Entre no sistema para enviar solicitações." : !filaDisponivel || !disponibilidade
    ? "Não foi possível verificar a disponibilidade da fila. Atualize os dados."
    : !podeSolicitar ? "Sem permissão para enviar solicitações de produção."
    : !disponibilidade.podeEnviar ? disponibilidade.motivoBloqueio || "Configure o vendedor no fornecedor antes de enviar." : null;
  if (motivo) return <BloqueioExplicado nome="Envio para fornecedor indisponível" motivo={motivo}>
    <button type="button" disabled className={`${classe} pointer-events-none`}><Send className="h-4 w-4" aria-hidden="true" />{filaDisponivel ? "Enviar para fila do Fornecedor" : "Status da fila indisponível"}</button>
  </BloqueioExplicado>;
  return <Link href={`/olist/pedidos/criar?${new URLSearchParams({ solicitacaoId })}`} className={classe}>
    <Send className="h-4 w-4" aria-hidden="true" />Enviar para fila do Fornecedor
  </Link>;
}
