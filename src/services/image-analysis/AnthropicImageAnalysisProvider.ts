import { obterConfiguracaoAnthropic } from "@/config/anthropic";
import type { ImageAnalysisInput, ImageAnalysisProvider, ImageAnalysisResult } from "./ImageAnalysisProvider";
import { ImageAnalysisProviderError } from "./ImageAnalysisProviderError";
import { obterProblemasSchema } from "./schemaValidationDiagnostics";
import { criarRequisicaoAnthropicAnalise } from "./anthropicAnaliseRequest";

export type AnthropicPayload = {
  id?: string; model?: string; stop_reason?: string; stop_details?: { type?: string };
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};
type Options = { apiKey?: string; model: string; maxOutputTokens?: number; timeoutMs?: number; fetchImpl?: typeof fetch };

export class AnthropicImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly config: ReturnType<typeof obterConfiguracaoAnthropic>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Options) {
    const padroes = obterConfiguracaoAnthropic();
    this.model = options.model;
    this.apiKey = options.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
    this.config = { timeoutMs: options.timeoutMs ?? padroes.timeoutMs, maxOutputTokens: options.maxOutputTokens ?? padroes.maxOutputTokens };
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.apiKey || !/^claude-[a-z0-9-]+$/u.test(this.model) || !Number.isInteger(this.config.timeoutMs) || this.config.timeoutMs <= 0 || !Number.isInteger(this.config.maxOutputTokens) || this.config.maxOutputTokens <= 0) {
      throw new ImageAnalysisProviderError("Configuração Anthropic inválida ou chave ausente.", { code: "CONFIGURATION_ERROR", provider: this.name });
    }
  }

  async analyzeImage<T>(input: ImageAnalysisInput<T>): Promise<ImageAnalysisResult<T>> {
    if (!input.prompt.trim() || !input.promptVersion.trim() || !input.image.buffer.length) throw new ImageAnalysisProviderError("Entrada Anthropic inválida.", { code: "CONFIGURATION_ERROR", provider: this.name });
    // A API limita o tamanho depois da codificação base64, não apenas os bytes.
    if (Math.ceil(input.image.buffer.length / 3) * 4 > 10 * 1024 * 1024) throw new ImageAnalysisProviderError("Imagem excede o limite Anthropic de 10 MB em base64.", { code: "CONFIGURATION_ERROR", provider: this.name });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(criarRequisicaoAnthropicAnalise(this.model, input, this.config.maxOutputTokens)) });
      if (!response.ok) {
        const details = classificarErroHttpAnthropic(await response.json().catch(() => null));
        const code = response.status === 401 || response.status === 403 ? "AUTHENTICATION_ERROR" : response.status === 429 ? "RATE_LIMIT" : response.status === 408 || response.status >= 500 ? "PROVIDER_TEMPORARY_ERROR" : "PROVIDER_ERROR";
        throw new ImageAnalysisProviderError("Falha HTTP na API Anthropic.", { code, provider: this.name, status: response.status, retriable: code === "RATE_LIMIT" || code === "PROVIDER_TEMPORARY_ERROR", details });
      }
      let payload: AnthropicPayload;
      try {
        const value: unknown = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        payload = value as AnthropicPayload;
      } catch { throw new ImageAnalysisProviderError("Resposta Anthropic inválida.", { code: "INVALID_RESPONSE", provider: this.name }); }
      const data = interpretarRespostaAnthropic(payload, input);
      return { provider: this.name, model: payload.model || this.model, analyzedAt: new Date().toISOString(), promptVersion: input.promptVersion,
        fallbackUsed: false, fallbackReason: null, primaryModel: this.model, primaryAttempts: 1, data, requestId: payload.id ?? null, usage: obterUsoAnthropic(payload) };
    } catch (error) {
      if (error instanceof ImageAnalysisProviderError) throw error;
      throw new ImageAnalysisProviderError("Falha na chamada Anthropic.", { code: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_TEMPORARY_ERROR", provider: this.name, retriable: true });
    } finally { clearTimeout(timer); }
  }
}

export const MOTIVOS_ERRO_HTTP_ANTHROPIC = ["SALDO_INSUFICIENTE", "LIMITE_GASTO", "SCHEMA_COMPLEXO", "SCHEMA_INVALIDO", "MODELO_INVALIDO", "PARAMETRO_INVALIDO", "IMAGEM_INVALIDA", "NAO_CLASSIFICADO"] as const;

// A mensagem remota pode refletir entradas. Persistir somente motivos controlados.
export function classificarErroHttpAnthropic(payload: unknown) {
  const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  let motivoHttp: typeof MOTIVOS_ERRO_HTTP_ANTHROPIC[number] = "NAO_CLASSIFICADO";
  if (/credit balance|purchase credits|balance too low/iu.test(message)) motivoHttp = "SALDO_INSUFICIENTE";
  else if (/spend limit|spending limit/iu.test(message)) motivoHttp = "LIMITE_GASTO";
  else if (/schema.*complex|too many.*(optional|union)|compilation|compiled grammar.*(large|complex)/iu.test(message)) motivoHttp = "SCHEMA_COMPLEXO";
  else if (/schema|additionalProperties|required|anyOf/iu.test(message)) motivoHttp = "SCHEMA_INVALIDO";
  else if (/model.*(not found|invalid|not exist|not supported)/iu.test(message)) motivoHttp = "MODELO_INVALIDO";
  else if (/image.*(invalid|size|exceed|format)/iu.test(message)) motivoHttp = "IMAGEM_INVALIDA";
  else if (/max_tokens|output_config|output_format|thinking/iu.test(message)) motivoHttp = "PARAMETRO_INVALIDO";
  return { motivoHttp };
}

export function obterUsoAnthropic(payload: AnthropicPayload): ImageAnalysisResult<unknown>["usage"] {
  const inteiro = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const entrada = inteiro(payload.usage?.input_tokens);
  const saida = inteiro(payload.usage?.output_tokens);
  const cache = inteiro(payload.usage?.cache_read_input_tokens) ?? 0;
  const criacao = inteiro(payload.usage?.cache_creation_input_tokens) ?? 0;
  // Cache write não é solicitado. Se vier inesperadamente, não estimar custo
  // com tarifa de entrada comum; preservar apenas o total de consumo conhecido.
  return { inputTokens: entrada === null || criacao > 0 ? null : entrada + cache, outputTokens: saida,
    totalTokens: entrada === null || saida === null ? null : entrada + cache + criacao + saida, cachedInputTokens: cache };
}

export function interpretarRespostaAnthropic<T>(payload: AnthropicPayload, input: Pick<ImageAnalysisInput<T>, "output">): T {
  const details = { usage: obterUsoAnthropic(payload) };
  const falhar = (code: ConstructorParameters<typeof ImageAnalysisProviderError>[1]["code"], retriable = false): never => {
    throw new ImageAnalysisProviderError("Resposta Anthropic não aceita.", { code, provider: "anthropic", retriable, details });
  };
  if (payload.stop_reason === "refusal" || payload.stop_details?.type === "refusal" || payload.content?.some(part => part.type === "refusal")) falhar("REFUSAL");
  if (payload.stop_reason === "max_tokens") falhar("OUTPUT_TRUNCATED");
  if (payload.stop_reason !== "end_turn") falhar("INCOMPLETE_RESPONSE", true);
  const texto = payload.content?.filter(part => part.type === "text" && typeof part.text === "string").map(part => part.text).join("").trim();
  if (!texto) falhar("INVALID_RESPONSE");
  let parsed: unknown;
  // Aceitar apenas um envelope Markdown completo, sem extrair JSON de prosa.
  const json = texto!.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/iu, "$1").trim();
  try { parsed = JSON.parse(json); } catch { falhar("INVALID_JSON", true); }
  try { return input.output.parse(parsed); } catch (error) {
    throw new ImageAnalysisProviderError("Resposta Anthropic fora do schema.", { code: "INVALID_STRUCTURED_OUTPUT", provider: "anthropic", retriable: true,
      details: { ...details, validationIssues: obterProblemasSchema(error, input.output.jsonSchema) } });
  }
}
