type EnvioComEspera = { estado: string; tentativaId: string; diagnostico: string | null; iniciadoEm: Date | string; historico?: unknown };
export const mensagemLimiteEnvioOlist = "A Olist atingiu o limite de requisições (HTTP 429). Aguarde o prazo indicado antes de tentar novamente. Não é necessário corrigir os dados por causa desse limite.";

/** Somente a tentativa corrente define o prazo; nunca reenvia ou libera resultado incerto. */
export function esperaEnvioOlist(envio: EnvioComEspera | null | undefined) {
  if (!envio || envio.estado !== "REJEITADO") return { limitado: false, tentarNovamenteEm: null };
  const eventos: unknown[] = Array.isArray(envio.historico) ? envio.historico : [];
  const evento = eventos.findLast((e): e is Record<string, unknown> => !!e && typeof e === "object" && "acao" in e && e.acao === "LIMITE_REQUISICOES" && "tentativaId" in e && e.tentativaId === envio.tentativaId);
  const limitado = !!evento || /HTTP\s+429\b/.test(envio.diagnostico ?? "");
  if (!limitado) return { limitado: false, tentarNovamenteEm: null };
  const prazo = evento && typeof evento.tentarNovamenteEm === "string" ? Date.parse(evento.tentarNovamenteEm) : new Date(envio.iniciadoEm).getTime() + 60_000;
  return { limitado: true, tentarNovamenteEm: Number.isFinite(prazo) ? new Date(prazo).toISOString() : null };
}

export class ErroEsperaEnvioOlist extends Error {
  constructor(readonly tentarNovamenteEm: string) { super(mensagemLimiteEnvioOlist); }
}

export function exigirPrazoEnvioOlist(envio: EnvioComEspera | null | undefined, agora = Date.now()) {
  const espera = esperaEnvioOlist(envio);
  if (espera.tentarNovamenteEm && Date.parse(espera.tentarNovamenteEm) > agora) throw new ErroEsperaEnvioOlist(espera.tentarNovamenteEm);
}
