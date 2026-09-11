import { AI_PRIMARY_MODEL, AI_FALLBACK_MODEL, AI_PRIMARY_IMAGE_DETAIL, AI_FALLBACK_IMAGE_DETAIL } from "@/config/ai";
import { obterNomeImageAnalysisProvider } from "@/config/imageAnalysisProvider";
import type { ImageAnalysisProvider } from "@/services/image-analysis/ImageAnalysisProvider";
import { CodexLocalImageAnalysisProvider } from "@/services/image-analysis/CodexLocalImageAnalysisProvider";
import { OpenAIImageAnalysisProvider } from "@/services/image-analysis/OpenAIImageAnalysisProvider";

export function criarImageAnalysisProvider(
  etapa: "primary" | "fallback" = "primary",
): ImageAnalysisProvider {
  if (obterNomeImageAnalysisProvider() === "codex-local") {
    const primaryModel = process.env.CODEX_CLI_PRIMARY_MODEL?.trim() || "gpt-5.4-mini";
    const fallbackModel = process.env.CODEX_CLI_FALLBACK_MODEL?.trim() || "gpt-5.4";
    if (primaryModel === fallbackModel) {
      throw new Error("CODEX_CLI_FALLBACK_MODEL deve ser diferente de CODEX_CLI_PRIMARY_MODEL.");
    }
    return new CodexLocalImageAnalysisProvider({ model: etapa === "primary" ? primaryModel : fallbackModel });
  }
  return new OpenAIImageAnalysisProvider({
    model: etapa === "primary" ? AI_PRIMARY_MODEL : AI_FALLBACK_MODEL,
    imageDetail: etapa === "primary" ? AI_PRIMARY_IMAGE_DETAIL : AI_FALLBACK_IMAGE_DETAIL,
  });
}
