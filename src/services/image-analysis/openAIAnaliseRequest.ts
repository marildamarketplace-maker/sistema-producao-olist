import { AI_MAX_OUTPUT_TOKENS } from "@/config/ai";
import type { ImageAnalysisDetail, StructuredOutputDefinition } from "./ImageAnalysisProvider";

export function criarRequisicaoOpenAIAnalise<T>(input: { model: string; imageDetail: ImageAnalysisDetail; imageUrl: string; prompt: string; promptVersion: string; output: StructuredOutputDefinition<T> }) {
  return {
    model: input.model, store: false, max_output_tokens: AI_MAX_OUTPUT_TOKENS, prompt_cache_key: input.promptVersion.trim(),
    text: { format: { type: "json_schema", name: input.output.name, strict: true, schema: input.output.jsonSchema } },
    input: [
      { role: "developer", content: [{ type: "input_text", text: input.prompt.trim() }] },
      { role: "user", content: [{ type: "input_image", detail: input.imageDetail, image_url: input.imageUrl }] },
    ],
  };
}
