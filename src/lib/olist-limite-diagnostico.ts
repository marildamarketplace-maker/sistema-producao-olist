/** Somente cotas públicas numéricas. Nunca copia corpo, cookies ou credenciais. */
export function diagnosticarLimiteOlist(headers: Record<string, unknown>, agora = Date.now()) {
  const numero = (chave: string) => {
    const valor = headers[chave];
    if (typeof valor !== "number" && typeof valor !== "string") return null;
    if (typeof valor === "string" && !/^\d+(?:\.\d+)?$/.test(valor)) return null;
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 && n <= 86_400_000 ? n : null;
  };
  const valor = headers["retry-after"];
  const segundos = numero("retry-after");
  const data = typeof valor === "string" && /^[A-Za-z]{3}, /.test(valor) ? Date.parse(valor) : NaN;
  const informado = segundos !== null ? segundos * 1000 : Number.isFinite(data) ? Math.max(0, data - agora) : null;
  const esperaMs = Math.max(1000, informado ?? 60_000);
  return {
    metodo: "POST", recurso: "/pedidos", status: 429,
    origemPrazo: informado === null ? "ESTIMATIVA_LOCAL" : "RETRY_AFTER_OLIST",
    tentarNovamenteEm: new Date(agora + esperaMs).toISOString(),
    limite: numero("x-ratelimit-limit"), restante: numero("x-ratelimit-remaining"), resetSegundos: numero("x-ratelimit-reset"),
  };
}
