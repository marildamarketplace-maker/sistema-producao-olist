import { AI_ANALYSIS_PROMPT_VERSION, AI_PRIMARY_IMAGE_DETAIL, AI_OPENAI_PRIMARY_MODEL } from "@/config/ai";
import { criarRequisicaoOpenAIAnalise } from "./openAIAnaliseRequest";
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
  return `estampa:${input.estampaId}:hash:${contentHash}:prompt:${AI_ANALYSIS_PROMPT_VERSION}:detail:${AI_PRIMARY_IMAGE_DETAIL}`;
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
    body: criarRequisicaoOpenAIAnalise({ model: AI_OPENAI_PRIMARY_MODEL, imageDetail: AI_PRIMARY_IMAGE_DETAIL,
      imageUrl: previewUrl, prompt: PROMPT_ANALISE_VISUAL_ESTAMPA, promptVersion: AI_ANALYSIS_PROMPT_VERSION, output: analiseVisualEstampaStructuredOutput }),
  };
}

export function serializarLinhasBatch(linhas: readonly Record<string, unknown>[]) {
  if (linhas.length === 0) throw new Error("Batch sem itens.");
  return `${linhas.map((linha) => JSON.stringify(linha)).join("\n")}\n`;
}
