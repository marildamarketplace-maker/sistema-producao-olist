import type { PreviewEstampaCarregado } from "@/services/carregarPreviewEstampaService";

export type StructuredOutputDefinition<T> = {
  name: string;
  jsonSchema: Record<string, unknown>;
  parse: (value: unknown) => T;
};

export type ImageAnalysisDetail = "low" | "high" | "auto";

export type ImageAnalysisInput<T> = {
  image: Pick<PreviewEstampaCarregado, "buffer" | "mimeType" | "sizeBytes">;
  prompt: string;
  promptVersion: string;
  output: StructuredOutputDefinition<T>;
};

export type ImageAnalysisResult<T> = {
  provider: string;
  model: string;
  analyzedAt: string;
  promptVersion: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  primaryModel: string;
  primaryAttempts: number;
  imageDetail?: ImageAnalysisDetail;
  data: T;
  requestId: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cachedInputTokens?: number | null;
  };
};

export interface ImageAnalysisProvider {
  readonly name: string;
  readonly model: string;
  analyzeImage<T>(input: ImageAnalysisInput<T>): Promise<ImageAnalysisResult<T>>;
}

export type ImageAnalysisProviderFactory = () => ImageAnalysisProvider;
