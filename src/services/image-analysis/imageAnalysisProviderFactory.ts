import type {
  ImageAnalysisDetail,
  ImageAnalysisProvider,
} from "@/services/image-analysis/ImageAnalysisProvider";
import { OpenAIImageAnalysisProvider } from "@/services/image-analysis/OpenAIImageAnalysisProvider";

export function criarImageAnalysisProvider(
  model?: string,
  imageDetail?: ImageAnalysisDetail,
): ImageAnalysisProvider {
  const provider = process.env.IMAGE_ANALYSIS_PROVIDER?.trim().toLowerCase() || "openai";

  if (provider === "openai") {
    return new OpenAIImageAnalysisProvider({ model, imageDetail });
  }
  throw new Error(`Provider de análise visual não suportado: ${provider}.`);
}
