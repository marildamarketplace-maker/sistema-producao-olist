import { AI_ANALYSIS_PROMPT_VERSION, AI_MAX_OUTPUT_TOKENS, AI_PRIMARY_MODEL } from "@/config/ai";
import { analiseVisualEstampaStructuredOutput } from "@/schemas/analiseVisualEstampaSchema";
import { PROMPT_ANALISE_VISUAL_ESTAMPA } from "@/services/analisarVisualEstampaService";
import { validarUrlPreviewEstampa } from "@/services/carregarPreviewEstampaService";

export function criarCustomIdBatchEstampa(input: {
  estampaId: string;
  contentHash: string;
}) {
  const contentHash = input.contentHash.trim();
  if (!/^\d+$/u.test(input.estampaId) || !contentHash) {
    throw new Error("Identificadores inválidos para o item do batch.");
  }
  return `estampa:${input.estampaId}:hash:${contentHash}:prompt:${AI_ANALYSIS_PROMPT_VERSION}`;
}

export function criarLinhaBatchAnaliseEstampa(input: {
  customId: string;
  previewUrl: string;
}) {
  const previewUrl = validarUrlPreviewEstampa(input.previewUrl).toString();
  return {
    custom_id: input.customId,
    method: "POST",
    url: "/v1/responses",
    body: {
      model: AI_PRIMARY_MODEL,
      store: false,
      max_output_tokens: AI_MAX_OUTPUT_TOKENS,
      prompt_cache_key: AI_ANALYSIS_PROMPT_VERSION,
      text: {
        format: {
          type: "json_schema",
          name: analiseVisualEstampaStructuredOutput.name,
          strict: true,
          schema: analiseVisualEstampaStructuredOutput.jsonSchema,
        },
      },
      input: [
        { role: "developer", content: [{ type: "input_text", text: PROMPT_ANALISE_VISUAL_ESTAMPA }] },
        { role: "user", content: [{ type: "input_image", detail: "low", image_url: previewUrl }] },
      ],
    },
  };
}

export function serializarLinhasBatch(linhas: readonly Record<string, unknown>[]) {
  if (linhas.length === 0) throw new Error("Batch sem itens.");
  return `${linhas.map((linha) => JSON.stringify(linha)).join("\n")}\n`;
}
