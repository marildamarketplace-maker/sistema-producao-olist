import type { GeminiThinkingLevel } from "@/config/gemini";
import type { ImageAnalysisDetail, ImageAnalysisInput } from "./ImageAnalysisProvider";

// Subconjunto documentado pela API Gemini. As restrições locais continuam no Zod.
export function criarSchemaGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const aceitos = new Set(["type", "format", "title", "description", "enum", "minimum", "maximum", "minItems", "maxItems", "required", "$ref", "$id", "$anchor"]);
  const resultado: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (aceitos.has(key)) resultado[key] = value;
    else if (["properties", "$defs"].includes(key) && value && typeof value === "object") {
      resultado[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, criarSchemaGemini(child as Record<string, unknown>)]));
    } else if (["items", "additionalProperties"].includes(key)) {
      resultado[key] = value && typeof value === "object" ? criarSchemaGemini(value as Record<string, unknown>) : value;
    } else if (["anyOf", "oneOf", "prefixItems"].includes(key) && Array.isArray(value)) {
      resultado[key] = value.map(child => criarSchemaGemini(child));
    }
  }
  return resultado;
}

export function criarRequisicaoGeminiAnalise<T>(input: ImageAnalysisInput<T>, config: { imageDetail: ImageAnalysisDetail; thinkingLevel: GeminiThinkingLevel; maxOutputTokens: number }) {
  return {
    store: false,
    systemInstruction: { parts: [{ text: input.prompt.trim() }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: input.image.mimeType, data: input.image.buffer.toString("base64") } }] }],
    generationConfig: {
      responseMimeType: "application/json", responseJsonSchema: criarSchemaGemini(input.output.jsonSchema),
      maxOutputTokens: config.maxOutputTokens,
      thinkingConfig: { thinkingLevel: config.thinkingLevel.toUpperCase(), includeThoughts: false },
      ...(config.imageDetail === "auto" ? {} : { mediaResolution: config.imageDetail === "high" ? "MEDIA_RESOLUTION_HIGH" : "MEDIA_RESOLUTION_LOW" }),
    },
  };
}
