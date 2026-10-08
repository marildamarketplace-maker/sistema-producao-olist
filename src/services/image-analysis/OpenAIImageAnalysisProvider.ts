import { criarRequisicaoOpenAIAnalise } from "./openAIAnaliseRequest";
import { interpretarRespostaOpenAI, obterUsoOpenAI, type OpenAIResponsesPayload } from "./openAIAnaliseResponse";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";
export { ImageAnalysisProviderError, type CodigoErroImageAnalysis } from "@/services/image-analysis/ImageAnalysisProviderError";
import type {
  ImageAnalysisInput,
  ImageAnalysisDetail,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from "@/services/image-analysis/ImageAnalysisProvider";
import { AI_OPENAI_PRIMARY_MODEL, AI_PRIMARY_IMAGE_DETAIL } from "@/config/ai";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 60_000;

export type OpenAIImageAnalysisProviderOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  endpoint?: string;
  imageDetail?: ImageAnalysisDetail;
  fetchImpl?: typeof fetch;
};

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
    this.model = options.model?.trim() || AI_OPENAI_PRIMARY_MODEL;
    this.timeoutMs = options.timeoutMs ?? numeroEnv("OPENAI_IMAGE_ANALYSIS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    this.endpoint = options.endpoint?.trim() || OPENAI_RESPONSES_URL;
    this.imageDetail = options.imageDetail ?? AI_PRIMARY_IMAGE_DETAIL;
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
        body: JSON.stringify(criarRequisicaoOpenAIAnalise({ model: this.model, imageDetail: this.imageDetail, imageUrl: `data:${input.image.mimeType};base64,${input.image.buffer.toString("base64")}`, prompt: input.prompt, promptVersion: input.promptVersion, output: input.output })),
      });
      const payload = await lerPayload(response);

      if (!response.ok) throw erroHttpOpenAI(response.status, payload);
      const data = interpretarRespostaOpenAI(payload, input.output);

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
        usage: obterUsoOpenAI(payload),
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
