import type { PrevisaoValidacaoSyncDto } from "./api-contract";

export const JANELA_PREVISAO_SYNC_MS = 30 * 60_000;

export function inicioJanelaPrevisaoSync(agora: Date, iniciadaEm: Date | null): Date {
  return new Date(Math.min(agora.getTime(), Math.max(agora.getTime() - JANELA_PREVISAO_SYNC_MS, iniciadaEm?.getTime() ?? agora.getTime())));
}

/** A taxa descreve somente a leitura completa; comparação e aplicação não são cronometradas. */
export function calcularPrevisaoValidacaoSync(entrada: {
  execucaoId: string; agora: Date; iniciadaEm: Date | null; contadores: unknown;
  validadosNaJanela: number; listagemPendente: boolean; pausada: boolean;
}): PrevisaoValidacaoSyncDto {
  const inicio = inicioJanelaPrevisaoSync(entrada.agora, entrada.iniciadaEm);
  const contadores = entrada.contadores && typeof entrada.contadores === "object" ? entrada.contadores : {};
  const quantidade = (valor: unknown) => typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
  const listados = quantidade("listados" in contadores ? contadores.listados : 0);
  const analisados = quantidade("analisados" in contadores ? contadores.analisados : 0);
  const recentes = Math.min(analisados, quantidade(entrada.validadosNaJanela));
  const restantes = Math.max(0, listados - analisados);
  const minutos = (entrada.agora.getTime() - inicio.getTime()) / 60_000;
  const estado: PrevisaoValidacaoSyncDto["estado"] = entrada.pausada ? "PAUSADA"
    : entrada.listagemPendente ? "LISTANDO"
      : restantes === 0 && entrada.iniciadaEm ? "LEITURA_CONCLUIDA"
        : minutos < 1 ? "AMOSTRA_INSUFICIENTE"
          : recentes === 0 ? "SEM_RITMO"
            : recentes < 5 ? "AMOSTRA_INSUFICIENTE" : "ESTIMADA";
  const porMinuto = estado === "ESTIMADA" ? recentes / minutos : null;
  const termino = porMinuto ? entrada.agora.getTime() + Math.ceil(restantes * (entrada.agora.getTime() - inicio.getTime()) / recentes) : NaN;
  return { execucaoId: entrada.execucaoId, calculadoEm: entrada.agora.toISOString(), janelaInicio: inicio.toISOString(),
    janelaFim: entrada.agora.toISOString(), validadosNaJanela: recentes, restantes, porMinuto,
    terminoPrevisto: Number.isFinite(termino) && termino <= 8_640_000_000_000_000 ? new Date(termino).toISOString() : null, estado };
}
