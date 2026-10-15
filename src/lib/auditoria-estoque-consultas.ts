import { LimiteRequisicoesOlistError } from "@/lib/olist-errors";

/** Instância por execução, compartilhada entre listagem, saldos e aplicativos. */
export function criarConsultorAuditoria(input: {
  limiteEm: number;
  agora?: () => number;
  aguardar?: (ms: number) => Promise<void>;
  registrarEspera?: (esperaMs: number, tentativa: number) => void;
}) {
  const agora = input.agora ?? Date.now;
  const aguardar = input.aguardar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let proximaConsultaEm = 0;
  return async function consultar<T>(operacao: () => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      const esperaMs = Math.max(0, proximaConsultaEm - agora());
      // Reserva um timeout HTTP completo antes de iniciar outra chamada.
      if (agora() + esperaMs + 20_000 >= input.limiteEm) {
        throw new Error("Prazo da auditoria excedido; resultado incompleto.");
      }
      if (esperaMs > 0) await aguardar(esperaMs);
      proximaConsultaEm = agora() + 2_100; // abaixo de 30 leituras/minuto nesta execução
      try {
        return await operacao();
      } catch (error) {
        if (!(error instanceof LimiteRequisicoesOlistError) || tentativa >= 3) throw error;
        const informado = error.retryAfterMs;
        const espera = informado !== null && Number.isFinite(informado) && informado >= 0
          ? Math.max(2_100, informado) : 60_000;
        proximaConsultaEm = Math.max(proximaConsultaEm, agora() + espera);
        input.registrarEspera?.(espera, tentativa);
      }
    }
  };
}
