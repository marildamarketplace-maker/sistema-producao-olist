// Prazos locais monotônicos, calculados a partir do início da requisição.
// Assim, a latência nunca aumenta o prazo que o servidor confirmou.
export const prazoReservaMs = 60_000;

export async function renovarEnquantoValida(opcoes: {
  iniciadaEm: number;
  renovar: (timeoutMs: number) => Promise<boolean>;
  esperar: (ms: number) => Promise<void>;
  agora: () => number;
  signal: AbortSignal;
}) {
  let venceEm = opcoes.iniciadaEm + prazoReservaMs;
  let intervalo = 15_000;
  while (!opcoes.signal.aborted) {
    await opcoes.esperar(Math.max(0, Math.min(intervalo, venceEm - opcoes.agora())));
    if (opcoes.signal.aborted) return true;
    const inicio = opcoes.agora();
    if (inicio >= venceEm) return false;
    try {
      if (!await opcoes.renovar(Math.min(10_000, venceEm - inicio))) return false;
      venceEm = inicio + prazoReservaMs;
      intervalo = 15_000;
    } catch {
      intervalo = 2_000;
    }
  }
  return true;
}
