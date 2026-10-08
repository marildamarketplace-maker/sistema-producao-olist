import { AI_PRIMARY_MODEL, AI_FALLBACK_MODEL, AI_FALLBACK_IMAGE_DETAIL } from "@/config/ai";
import type { ImageAnalysisProvider } from "./ImageAnalysisProvider";
import { AnthropicImageAnalysisProvider } from "./AnthropicImageAnalysisProvider";
import { OpenAIImageAnalysisProvider } from "./OpenAIImageAnalysisProvider";

// O cron usa Anthropic primeiro, independente do provider do worker local.
// Construção tardia permite fallback mesmo quando falta a chave Anthropic.
export function criarProvidersEstampasCron(): { primary: ImageAnalysisProvider; fallback: ImageAnalysisProvider } {
  const model = AI_PRIMARY_MODEL;
  return {
    primary: {
      name: "anthropic",
      model,
      analyzeImage: input => new AnthropicImageAnalysisProvider({ model }).analyzeImage(input),
    },
    fallback: new OpenAIImageAnalysisProvider({ model: AI_FALLBACK_MODEL, imageDetail: AI_FALLBACK_IMAGE_DETAIL }),
  };
}
