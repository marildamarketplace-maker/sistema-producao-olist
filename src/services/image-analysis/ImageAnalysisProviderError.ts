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
