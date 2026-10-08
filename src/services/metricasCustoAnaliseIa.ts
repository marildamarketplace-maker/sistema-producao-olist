export type UsoTokensAnaliseIa = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
};

export type PrecosModeloAnaliseIa = {
  inputPorMilhaoUsd: number;
  inputCachePorMilhaoUsd: number;
  outputPorMilhaoUsd: number;
};

export const PRECOS_GPT_4O_MINI: PrecosModeloAnaliseIa = {
  inputPorMilhaoUsd: 0.15,
  inputCachePorMilhaoUsd: 0.075,
  outputPorMilhaoUsd: 0.6,
};

export const PRECOS_GPT_5_4_MINI: PrecosModeloAnaliseIa = {
  inputPorMilhaoUsd: 0.75,
  inputCachePorMilhaoUsd: 0.075,
  outputPorMilhaoUsd: 4.5,
};

export function obterPrecosModeloAnaliseIa(model: string, analyzedAt = new Date().toISOString(), inputTokens?: number | null) {
  if (model === "claude-haiku-5-5" || model.startsWith("claude-haiku-5-5-")) {
    const longa = (inputTokens ?? 0) > 100000;
    return { inputPorMilhaoUsd: longa ? 0.5 : 0.1, inputCachePorMilhaoUsd: longa ? 0.05 : 0.01, outputPorMilhaoUsd: longa ? 2.5 : 0.5 };
  }
  if (model === "claude-sonnet-5-5" || model.startsWith("claude-sonnet-5-5-")) return { inputPorMilhaoUsd: 2, inputCachePorMilhaoUsd: 0.2, outputPorMilhaoUsd: 10 };
  if (model.startsWith("gpt-4o-mini")) return PRECOS_GPT_4O_MINI;
  if (model.startsWith("gpt-5.4-mini")) return PRECOS_GPT_5_4_MINI;
  // https://ai.google.dev/gemini-api/docs/pricing — Standard, inclui pensamento.
  if (model === "gemini-3.5-flash-lite" || model.startsWith("gemini-3.5-flash-lite-")) return { inputPorMilhaoUsd: 0.30, inputCachePorMilhaoUsd: 0.03, outputPorMilhaoUsd: 2.50 };
  if (model === "gemini-3.8-flash" || model.startsWith("gemini-3.8-flash-")) {
    const promocao = new Date(analyzedAt).getTime() < Date.parse("2027-01-01T00:00:00Z");
    return { inputPorMilhaoUsd: promocao ? 0.75 : 1.50, inputCachePorMilhaoUsd: promocao ? 0.075 : 0.15, outputPorMilhaoUsd: promocao ? 3.75 : 7.50 };
  }
  return null;
}

export function calcularCustoEstimadoAnaliseIa(
  uso: UsoTokensAnaliseIa,
  precos: PrecosModeloAnaliseIa,
  desconto = 0,
) {
  validarDesconto(desconto);
  const entradaTotal = inteiroNaoNegativo(uso.inputTokens);
  const entradaCache = Math.min(
    entradaTotal,
    inteiroNaoNegativo(uso.cachedInputTokens),
  );
  const entradaSemCache = entradaTotal - entradaCache;
  const saida = inteiroNaoNegativo(uso.outputTokens);
  const custoBruto =
    (entradaSemCache * precos.inputPorMilhaoUsd +
      entradaCache * precos.inputCachePorMilhaoUsd +
      saida * precos.outputPorMilhaoUsd) /
    1_000_000;

  return {
    inputTokens: entradaTotal,
    cachedInputTokens: entradaCache,
    outputTokens: saida,
    cacheHitRate: entradaTotal === 0 ? 0 : entradaCache / entradaTotal,
    estimatedCostUsd: custoBruto * (1 - desconto),
  };
}

function inteiroNaoNegativo(valor: number | null | undefined) {
  return Number.isInteger(valor) && Number(valor) > 0 ? Number(valor) : 0;
}

function validarDesconto(desconto: number) {
  if (!Number.isFinite(desconto) || desconto < 0 || desconto > 1) {
    throw new Error("desconto deve estar entre 0 e 1.");
  }
}
