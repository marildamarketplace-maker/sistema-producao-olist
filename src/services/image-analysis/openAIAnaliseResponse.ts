import { obterProblemasSchema } from "./schemaValidationDiagnostics";
export { obterProblemasSchema } from "./schemaValidationDiagnostics";
import { ImageAnalysisProviderError } from "./ImageAnalysisProviderError";
import type { ImageAnalysisResult, StructuredOutputDefinition } from "./ImageAnalysisProvider";

export type OpenAIResponsesPayload = {
  id?: string; model?: string; status?: string; output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string; code?: string; type?: string };
  incomplete_details?: { reason?: string } | null;
};

export function obterUsoOpenAI(payload: OpenAIResponsesPayload): ImageAnalysisResult<unknown>["usage"] {
  return { inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null,
    totalTokens: payload.usage?.total_tokens ?? null, cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null };
}

export function interpretarRespostaOpenAI<T>(payload: OpenAIResponsesPayload, output: StructuredOutputDefinition<T>): T {
  const details = { requestId: payload.id ?? null, model: payload.model, usage: obterUsoOpenAI(payload) };
  const falhar = (code: ConstructorParameters<typeof ImageAnalysisProviderError>[1]["code"], mensagem: string, retriable = false): never => {
    throw new ImageAnalysisProviderError(mensagem, { code, provider: "openai", retriable, details });
  };
  if (payload.incomplete_details?.reason === "max_output_tokens") falhar("OUTPUT_TRUNCATED", "OpenAI: saída truncada pelo limite de tokens.");
  if (payload.output?.some(item => item.content?.some(content => content.type === "refusal"))) falhar("REFUSAL", "OpenAI: recusa de análise.");
  if (payload.status && payload.status !== "completed") falhar("INCOMPLETE_RESPONSE", "OpenAI: resposta não concluída.", true);
  if (payload.incomplete_details) falhar("INCOMPLETE_RESPONSE", "OpenAI: resposta incompleta.", true);
  const texto = payload.output_text?.trim() || (payload.output ?? []).flatMap(item => item.content ?? []).filter(content => content.type === "output_text").map(content => content.text ?? "").join("\n").trim();
  if (!texto) falhar("INVALID_RESPONSE", "OpenAI: resposta sem texto.");
  let parsed: unknown;
  try { parsed = JSON.parse(texto); } catch { falhar("INVALID_JSON", "OpenAI: JSON inválido.", true); }
  try { return output.parse(parsed); } catch (error) {
    throw new ImageAnalysisProviderError("OpenAI: resposta fora do schema.", {
      code: "INVALID_STRUCTURED_OUTPUT", provider: "openai", retriable: true,
      details: { ...details, validationIssues: obterProblemasSchema(error, output.jsonSchema) },
    });
  }
}

