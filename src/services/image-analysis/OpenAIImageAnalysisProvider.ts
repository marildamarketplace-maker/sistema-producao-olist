import type {
  ImageAnalysisInput,
  ImageAnalysisDetail,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from "@/services/image-analysis/ImageAnalysisProvider";
import { AI_MAX_OUTPUT_TOKENS, AI_PRIMARY_MODEL } from "@/config/ai";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 60_000;

type OpenAIResponsesPayload = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
  };
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  incomplete_details?: unknown;
};

export type OpenAIImageAnalysisProviderOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  endpoint?: string;
  imageDetail?: ImageAnalysisDetail;
  fetchImpl?: typeof fetch;
};

export type CodigoErroImageAnalysis =
  | "CONFIGURATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "RATE_LIMIT"
  | "PROVIDER_TEMPORARY_ERROR"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "INVALID_STRUCTURED_OUTPUT";

export class ImageAnalysisProviderError extends Error {
  readonly code: CodigoErroImageAnalysis;
  readonly provider: string;
  readonly status?: number;
  readonly retriable: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      code: CodigoErroImageAnalysis;
      provider: string;
      status?: number;
      retriable?: boolean;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ImageAnalysisProviderError";
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.retriable = options.retriable ?? false;
    this.details = options.details;
  }
}

export class OpenAIImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly endpoint: string;
  private readonly imageDetail: ImageAnalysisDetail;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIImageAnalysisProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
    this.model = options.model?.trim() || AI_PRIMARY_MODEL;
    this.timeoutMs = options.timeoutMs ?? numeroEnv("OPENAI_IMAGE_ANALYSIS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    this.endpoint = options.endpoint?.trim() || OPENAI_RESPONSES_URL;
    this.imageDetail = options.imageDetail ?? "auto";
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.apiKey) {
      throw new ImageAnalysisProviderError("OPENAI_API_KEY não configurada.", {
        code: "CONFIGURATION_ERROR",
        provider: this.name,
      });
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ImageAnalysisProviderError("Timeout do provider deve ser um inteiro maior que zero.", {
        code: "CONFIGURATION_ERROR",
        provider: this.name,
      });
    }
  }

  async analyzeImage<T>(input: ImageAnalysisInput<T>): Promise<ImageAnalysisResult<T>> {
    if (!input.prompt.trim()) {
      throw new ImageAnalysisProviderError("Prompt de análise visual vazio.", {
        code: "CONFIGURATION_ERROR",
        provider: this.name,
      });
    }
    if (!input.promptVersion.trim()) {
      throw new ImageAnalysisProviderError("Versão do prompt de análise visual vazia.", {
        code: "CONFIGURATION_ERROR",
        provider: this.name,
      });
    }
    if (input.image.buffer.length === 0) {
      throw new ImageAnalysisProviderError("Imagem de análise vazia.", {
        code: "CONFIGURATION_ERROR",
        provider: this.name,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("OpenAI timeout")), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          max_output_tokens: AI_MAX_OUTPUT_TOKENS,
          prompt_cache_key: input.promptVersion.trim(),
          text: {
            format: {
              type: "json_schema",
              name: input.output.name,
              strict: true,
              schema: input.output.jsonSchema,
            },
          },
          input: [
            {
              role: "developer",
              content: [
                { type: "input_text", text: input.prompt.trim() },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_image",
                  detail: this.imageDetail,
                  image_url: `data:${input.image.mimeType};base64,${input.image.buffer.toString("base64")}`,
                },
              ],
            },
          ],
        }),
      });
      const payload = await lerPayload(response);

      if (!response.ok) throw erroHttpOpenAI(response.status, payload);
      const text = extrairTexto(payload);
      if (!text) {
        throw new ImageAnalysisProviderError("A OpenAI não retornou texto de análise.", {
          code: "INVALID_RESPONSE",
          provider: this.name,
          status: response.status,
          details: { requestId: payload.id, incompleteDetails: payload.incomplete_details },
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new ImageAnalysisProviderError("A OpenAI retornou JSON inválido.", {
          code: "INVALID_STRUCTURED_OUTPUT",
          provider: this.name,
          status: response.status,
          retriable: true,
          details: { requestId: payload.id },
          cause: error,
        });
      }
      let data: T;
      try {
        data = input.output.parse(parsed);
      } catch (error) {
        throw new ImageAnalysisProviderError("A resposta da OpenAI não passou na validação do schema.", {
          code: "INVALID_STRUCTURED_OUTPUT",
          provider: this.name,
          status: response.status,
          retriable: true,
          details: { requestId: payload.id },
          cause: error,
        });
      }

      return {
        provider: this.name,
        model: payload.model || this.model,
        analyzedAt: new Date().toISOString(),
        promptVersion: input.promptVersion.trim(),
        fallbackUsed: false,
        fallbackReason: null,
        primaryModel: this.model,
        primaryAttempts: 1,
        imageDetail: this.imageDetail,
        data,
        requestId: payload.id ?? null,
        usage: {
          inputTokens: payload.usage?.input_tokens ?? null,
          outputTokens: payload.usage?.output_tokens ?? null,
          totalTokens: payload.usage?.total_tokens ?? null,
          cachedInputTokens:
            payload.usage?.input_tokens_details?.cached_tokens ?? null,
        },
      };
    } catch (error) {
      if (error instanceof ImageAnalysisProviderError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new ImageAnalysisProviderError("Timeout na análise visual da OpenAI.", {
          code: "TIMEOUT",
          provider: this.name,
          retriable: true,
          details: { timeoutMs: this.timeoutMs, model: this.model },
          cause: error,
        });
      }
      throw new ImageAnalysisProviderError("Falha de rede ao chamar a OpenAI.", {
        code: "PROVIDER_TEMPORARY_ERROR",
        provider: this.name,
        retriable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function lerPayload(response: Response): Promise<OpenAIResponsesPayload> {
  try {
    return (await response.json()) as OpenAIResponsesPayload;
  } catch (error) {
    throw new ImageAnalysisProviderError("Resposta inválida da OpenAI.", {
      code: "INVALID_RESPONSE",
      provider: "openai",
      status: response.status,
      cause: error,
    });
  }
}

function extrairTexto(payload: OpenAIResponsesPayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n")
    .trim();
}

function erroHttpOpenAI(status: number, payload: OpenAIResponsesPayload) {
  const message = payload.error?.message || `Erro HTTP ${status} na OpenAI.`;
  const details = { status, error: payload.error };
  if (status === 401 || status === 403) {
    return new ImageAnalysisProviderError(message, {
      code: "AUTHENTICATION_ERROR",
      provider: "openai",
      status,
      details,
    });
  }
  if (status === 429) {
    return new ImageAnalysisProviderError(message, {
      code: "RATE_LIMIT",
      provider: "openai",
      status,
      retriable: true,
      details,
    });
  }
  if (status === 408 || status >= 500) {
    return new ImageAnalysisProviderError(message, {
      code: "PROVIDER_TEMPORARY_ERROR",
      provider: "openai",
      status,
      retriable: true,
      details,
    });
  }
  return new ImageAnalysisProviderError(message, {
    code: "PROVIDER_ERROR",
    provider: "openai",
    status,
    details,
  });
}

function numeroEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}
