/** Somente metadados públicos de cota; nunca recebe tokens ou payloads do ERP. */
export type CotaLeituraSync = { limite: number; restante: number; resetSegundos: number };
export const INTERVALO_AUDITORIA_MS = 2_000;

/** Aplicação: usa até 80% da cota, com teto de 48 GET/min e 60 HTTP de escrita/min.
 * Cada escrita exige um GET fresco de identidade, limitando envios a menos de 30/min.
 * Sem headers assume o menor plano (30/min), reservando 20% para outros usos.
 * A janela é compartilhada entre métodos: conservadora, sem rajadas paralelas.
 */
export function proximaChamadaAplicacaoSync(inicio: number, respostaEm: number,
  cota: CotaLeituraSync | null, escrita = false, limitada = false, retryAfterMs = 0): number {
  const limite = cota?.limite ?? 30;
  const cadencia = Math.ceil(60_000 / Math.min(escrita ? 60 : 48, limite * 0.8));
  const reserva = Math.max(1, Math.ceil(limite * 0.2));
  const saldo = cota ? cota.restante - reserva : 0;
  const esperaSaldo = !cota ? 0 : saldo > 0
    ? Math.ceil(cota.resetSegundos * 1_000 / saldo)
    : Math.ceil(cota.resetSegundos * 1_000) + 250;
  return Math.max(respostaEm, inicio + cadencia,
    esperaSaldo > cadencia ? respostaEm + esperaSaldo : 0,
    limitada ? respostaEm + Math.max(60_000, (cota?.resetSegundos ?? 0) * 1_000 + 250) : 0,
    respostaEm + (Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0));
}

const reservaLeitura = (cota: CotaLeituraSync) => Math.max(1, Math.ceil(cota.limite * 0.1));

export function interpretarCotaSync(limite: unknown, restante: unknown, reset: unknown): CotaLeituraSync | null {
  const numero = (valor: unknown) => typeof valor === "number" ? valor : typeof valor === "string" && /^\d+(?:\.\d+)?$/.test(valor) ? Number(valor) : NaN;
  const l = numero(limite), r = numero(restante), s = numero(reset);
  if (!Number.isSafeInteger(l) || l < 1 || l > 100_000 || !Number.isSafeInteger(r) || r < 0 || r > l || !Number.isFinite(s) || s < 0 || s > 86_400) return null;
  return { limite: l, restante: r, resetSegundos: s };
}

export function cotaDaRespostaSync(resposta: unknown): CotaLeituraSync | null {
  if (!resposta || typeof resposta !== "object" || !("cotaLeitura" in resposta)) return null;
  const cota = resposta.cotaLeitura;
  if (!cota || typeof cota !== "object" || !("limite" in cota) || !("restante" in cota) || !("resetSegundos" in cota)) return null;
  return interpretarCotaSync(cota.limite, cota.restante, cota.resetSegundos);
}

/** Teto de 30/min e até metade da cota anunciada. Reserva 10% para outros usos. */
export function esperaAuditoriaSync(cota: CotaLeituraSync | null, limitada = false, retryAfterMs = 0): number {
  let intervalo = INTERVALO_AUDITORIA_MS;
  if (cota) {
    const reserva = reservaLeitura(cota);
    const disponivel = cota.restante - reserva;
    intervalo = Math.max(intervalo, Math.ceil(120_000 / cota.limite), disponivel > 0
      ? Math.ceil(cota.resetSegundos * 1_000 / disponivel)
      : Math.ceil(cota.resetSegundos * 1_000) + 250);
  }
  if (limitada) intervalo = Math.max(intervalo, 60_000, (cota?.resetSegundos ?? 0) * 1_000 + 250);
  return Math.max(intervalo, Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0);
}

/** Cadência entre inícios; restrições de saldo/reset e Retry-After valem após a resposta. */
export function proximaLeituraAuditoriaSync(inicio: number, respostaEm: number, cota: CotaLeituraSync | null,
  limitada = false, retryAfterMs = 0): number {
  const intervalo = esperaAuditoriaSync(cota, limitada);
  const cadencia = Math.max(INTERVALO_AUDITORIA_MS, cota ? Math.ceil(120_000 / cota.limite) : 0);
  const saldoReservado = cota !== null && cota.restante <= reservaLeitura(cota);
  // Não desconta latência de uma restrição anunciada apenas na resposta.
  const referencia = limitada || saldoReservado || intervalo > cadencia ? respostaEm : inicio;
  return Math.max(respostaEm, referencia + intervalo,
    respostaEm + (Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0));
}
