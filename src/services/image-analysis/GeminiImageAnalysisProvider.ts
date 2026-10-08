import { obterConfiguracaoGemini, type GeminiThinkingLevel } from "@/config/gemini";
import { ImageAnalysisProviderError } from "./ImageAnalysisProviderError";
import type { ImageAnalysisDetail, ImageAnalysisInput, ImageAnalysisProvider, ImageAnalysisResult } from "./ImageAnalysisProvider";
import { criarRequisicaoGeminiAnalise } from "./geminiAnaliseRequest";
import { obterProblemasSchema } from "./schemaValidationDiagnostics";

export type GeminiPayload = {
  responseId?: string; modelVersion?: string;
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number };
};

type Options = { apiKey?: string; model: string; imageDetail?: ImageAnalysisDetail; thinkingLevel?: GeminiThinkingLevel; maxOutputTokens?: number; timeoutMs?: number; fetchImpl?: typeof fetch };

export class GeminiImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly config: ReturnType<typeof obterConfiguracaoGemini>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Options) {
    this.model = options.model;
    this.apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
    const padroes = obterConfiguracaoGemini();
    this.config = { imageDetail: options.imageDetail ?? padroes.imageDetail, thinkingLevel: options.thinkingLevel ?? padroes.thinkingLevel,
      maxOutputTokens: options.maxOutputTokens ?? padroes.maxOutputTokens, timeoutMs: options.timeoutMs ?? padroes.timeoutMs };
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.apiKey || !/^gemini-[a-z0-9.-]+$/u.test(this.model) || !Number.isInteger(this.config.timeoutMs) || this.config.timeoutMs <= 0 || !Number.isInteger(this.config.maxOutputTokens) || this.config.maxOutputTokens <= 0 || !["low", "medium", "high"].includes(this.config.thinkingLevel) || !["low", "high", "auto"].includes(this.config.imageDetail)) {
      throw new ImageAnalysisProviderError("Configuração Gemini inválida ou GEMINI_API_KEY ausente.", { code: "CONFIGURATION_ERROR", provider: this.name });
    }
  }

  async analyzeImage<T>(input: ImageAnalysisInput<T>): Promise<ImageAnalysisResult<T>> {
    if (!input.prompt.trim() || !input.promptVersion.trim() || !input.image.buffer.length || !["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(input.image.mimeType)) {
      throw new ImageAnalysisProviderError("Entrada inválida para análise Gemini.", { code: "CONFIGURATION_ERROR", provider: this.name });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: "POST", signal: controller.signal, redirect: "error",
        headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(criarRequisicaoGeminiAnalise(input, this.config)),
      });
      if (!response.ok) {
        // Não incluir mensagem/corpo HTTP, pois podem repetir conteúdo ou credenciais.
        const code = response.status === 401 || response.status === 403 ? "AUTHENTICATION_ERROR" : response.status === 429 ? "RATE_LIMIT" : response.status === 408 || response.status >= 500 ? "PROVIDER_TEMPORARY_ERROR" : "PROVIDER_ERROR";
        throw new ImageAnalysisProviderError("Falha HTTP na API Gemini.", { code, provider: this.name, status: response.status, retriable: code === "RATE_LIMIT" || code === "PROVIDER_TEMPORARY_ERROR" });
      }
      let payload: GeminiPayload;
      try {
        const value: unknown = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        payload = value as GeminiPayload;
      } catch { throw new ImageAnalysisProviderError("Resposta inválida da API Gemini.", { code: "INVALID_RESPONSE", provider: this.name }); }
      const data = interpretarRespostaGemini(payload, input);
      return { provider: this.name, model: payload.modelVersion || this.model, analyzedAt: new Date().toISOString(), promptVersion: input.promptVersion,
        fallbackUsed: false, fallbackReason: null, primaryModel: this.model, primaryAttempts: 1, imageDetail: this.config.imageDetail,
        data, requestId: payload.responseId ?? null, usage: obterUsoGemini(payload) };
    } catch (error) {
      if (error instanceof ImageAnalysisProviderError) throw error;
      throw new ImageAnalysisProviderError(controller.signal.aborted ? "Timeout na análise Gemini." : "Falha de rede na análise Gemini.", {
        code: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_TEMPORARY_ERROR", provider: this.name, retriable: true,
      });
    } finally { clearTimeout(timeout); }
  }
}

export function obterUsoGemini(payload: GeminiPayload): ImageAnalysisResult<unknown>["usage"] {
  const usage = payload.usageMetadata;
  const inteiro = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const saida = inteiro(usage?.candidatesTokenCount);
  const pensamento = inteiro(usage?.thoughtsTokenCount) ?? 0;
  return { inputTokens: inteiro(usage?.promptTokenCount), outputTokens: saida === null ? null : saida + pensamento,
    totalTokens: inteiro(usage?.totalTokenCount), cachedInputTokens: inteiro(usage?.cachedContentTokenCount) ?? 0 };
}

export function interpretarRespostaGemini<T>(payload: GeminiPayload, input: Pick<ImageAnalysisInput<T>, "output">): T {
  const details = { usage: obterUsoGemini(payload) };
  const falhar = (code: ConstructorParameters<typeof ImageAnalysisProviderError>[1]["code"], retriable = false): never => {
    throw new ImageAnalysisProviderError("Resposta Gemini não aceita.", { code, provider: "gemini", retriable, details });
  };
  if (payload.promptFeedback?.blockReason) falhar("REFUSAL");
  const candidato = payload.candidates?.[0];
  if (candidato?.finishReason === "MAX_TOKENS") falhar("OUTPUT_TRUNCATED");
  if (candidato?.finishReason && ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"].includes(candidato.finishReason)) falhar("REFUSAL");
  if (candidato?.finishReason !== "STOP") falhar("INCOMPLETE_RESPONSE", true);
  const texto = candidato?.content?.parts?.filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("").trim();
  if (!texto) falhar("INVALID_RESPONSE");
  let parsed: unknown;
  try { parsed = JSON.parse(texto!); } catch { falhar("INVALID_JSON", true); }
  try { return input.output.parse(parsed); } catch (error) {
    throw new ImageAnalysisProviderError("Resposta Gemini fora do schema.", { code: "INVALID_STRUCTURED_OUTPUT", provider: "gemini", retriable: true,
      details: { ...details, validationIssues: obterProblemasSchema(error, input.output.jsonSchema) } });
  }
}
