type Etapa = "AGUARDANDO_TAREFA" | "INICIANDO_CODEX" | "EXECUTANDO" | "REGISTRANDO_RESULTADO" | "FINALIZADA" | "RESERVA_PERDIDA";

export function eventoWorker(etapa: Etapa, nome?: string, inicio?: number, desfecho?: string) {
  return JSON.stringify({
    horario: new Date().toISOString(), etapa,
    ...(nome ? { rotina: nome.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120) } : {}),
    ...(inicio !== undefined ? { duracaoMs: Math.max(0, Date.now() - inicio) } : {}),
    ...(desfecho ? { desfecho } : {}),
  });
}
