export const AI_PRIMARY_MODEL =
  process.env.AI_PRIMARY_MODEL?.trim() || "gpt-4o-mini";

export const AI_FALLBACK_MODEL =
  process.env.AI_FALLBACK_MODEL?.trim() || "gpt-5.4-mini";

export const AI_PRIMARY_IMAGE_DETAIL = detalheImagem(
  process.env.AI_PRIMARY_IMAGE_DETAIL,
  "low",
  "AI_PRIMARY_IMAGE_DETAIL",
);

export const AI_FALLBACK_IMAGE_DETAIL = detalheImagem(
  process.env.AI_FALLBACK_IMAGE_DETAIL,
  "high",
  "AI_FALLBACK_IMAGE_DETAIL",
);

if (AI_FALLBACK_MODEL === AI_PRIMARY_MODEL) {
  throw new Error("AI_FALLBACK_MODEL deve ser diferente de AI_PRIMARY_MODEL.");
}

export const AI_MIN_CONFIDENCE = numeroEntreZeroEUm(
  process.env.AI_MIN_CONFIDENCE,
  0.7,
  "AI_MIN_CONFIDENCE",
);

export const AI_MIN_SEGMENTATION_CONFIDENCE = numeroEntreZeroEUm(
  process.env.AI_MIN_SEGMENTATION_CONFIDENCE,
  0.7,
  "AI_MIN_SEGMENTATION_CONFIDENCE",
);

export const AI_MIN_TEXTILE_PATTERN_CONFIDENCE = numeroEntreZeroEUm(
  process.env.AI_MIN_TEXTILE_PATTERN_CONFIDENCE,
  0.7,
  "AI_MIN_TEXTILE_PATTERN_CONFIDENCE",
);

export const AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS = inteiroEntre(
  process.env.AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS,
  1,
  1,
  3,
  "AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS",
);

export const AI_ANALYSIS_PROMPT_VERSION = "estampa-visual-v5-vocabulario-textil";

function numeroEntreZeroEUm(value: string | undefined, fallback: number, name: string) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} deve ser um número entre 0 e 1.`);
  }
  return parsed;
}

function detalheImagem(
  value: string | undefined,
  fallback: "low" | "high" | "auto",
  name: string,
) {
  const normalized = value?.trim().toLowerCase() || fallback;
  if (normalized !== "low" && normalized !== "high" && normalized !== "auto") {
    throw new Error(`${name} deve ser low, high ou auto.`);
  }
  return normalized;
}

function inteiroEntre(
  value: string | undefined,
  fallback: number,
  minimo: number,
  maximo: number,
  name: string,
) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimo || parsed > maximo) {
    throw new Error(`${name} deve ser um inteiro entre ${minimo} e ${maximo}.`);
  }
  return parsed;
}
