import type { ImageAnalysisDetail } from "@/services/image-analysis/ImageAnalysisProvider";

export type GeminiThinkingLevel = "low" | "medium" | "high";

export function obterConfiguracaoGemini() {
  const thinkingLevel = process.env.GEMINI_THINKING_LEVEL?.trim() || "low";
  const imageDetail = process.env.GEMINI_IMAGE_ANALYSIS_DETAIL?.trim() || "high";
  if (!["low", "medium", "high"].includes(thinkingLevel)) throw new Error("GEMINI_THINKING_LEVEL deve ser low, medium ou high.");
  if (!["low", "high", "auto"].includes(imageDetail)) throw new Error("GEMINI_IMAGE_ANALYSIS_DETAIL deve ser low, high ou auto.");
  return {
    thinkingLevel: thinkingLevel as GeminiThinkingLevel,
    imageDetail: imageDetail as ImageAnalysisDetail,
    maxOutputTokens: inteiroEnv("GEMINI_MAX_OUTPUT_TOKENS", 4096, 300, 16384),
    timeoutMs: inteiroEnv("GEMINI_IMAGE_ANALYSIS_TIMEOUT_MS", 90000, 1000, 300000),
  };
}

function inteiroEnv(nome: string, padrao: number, minimo: number, maximo: number) {
  const valor = process.env[nome]?.trim();
  const numero = valor ? Number(valor) : padrao;
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) throw new Error(`${nome} deve ser inteiro entre ${minimo} e ${maximo}.`);
  return numero;
}
