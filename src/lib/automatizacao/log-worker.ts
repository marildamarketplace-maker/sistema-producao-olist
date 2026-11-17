import type { DiagnosticoCodex } from "@/services/image-analysis/diagnosticoCodexCli";

type Etapa = "AGUARDANDO_TAREFA" | "INICIANDO_CODEX" | "EXECUTANDO" | "REGISTRANDO_RESULTADO" | "FINALIZADA" | "RESERVA_PERDIDA" | "FALHA_EXECUTOR";

export function eventoWorker(etapa: Etapa, nome?: string, inicio?: number, desfecho?: string, falha?: { codigo: string; diagnostico?: DiagnosticoCodex }) {
  return JSON.stringify({
    horario: new Date().toISOString(), etapa,
    ...(nome ? { rotina: nome.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120) } : {}),
    ...(inicio !== undefined ? { duracaoMs: Math.max(0, Date.now() - inicio) } : {}),
    ...(desfecho ? { desfecho } : {}),
    ...(falha ? { codigo: falha.codigo, ...falha.diagnostico } : {}),
  });
}
