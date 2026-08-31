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

export function obterPrecosModeloAnaliseIa(model: string) {
  if (model.startsWith("gpt-4o-mini")) return PRECOS_GPT_4O_MINI;
  if (model.startsWith("gpt-5.4-mini")) return PRECOS_GPT_5_4_MINI;
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
