import { Buffer } from "node:buffer";

const OPENAI_IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

type OpenAIImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type OpenAIImageQuality = "low" | "medium" | "high" | "auto";
type OpenAIImageBackground = "transparent" | "opaque" | "auto";
type OpenAIImageOutputFormat = "png" | "jpeg" | "webp";

export type OpenAIImageReferenceRole = "mockup" | "estampa" | "referencia";

export type OpenAIImageReference = {
  url: string;
  role?: OpenAIImageReferenceRole;
  name?: string;
};

export type GenerateOpenAIImageInput = {
  prompt: string;
  images: OpenAIImageReference[];
  model?: string;
  size?: OpenAIImageSize;
  quality?: OpenAIImageQuality;
  background?: OpenAIImageBackground;
  outputFormat?: OpenAIImageOutputFormat;
};

export type GenerateMockupWithEstampaInput = Omit<GenerateOpenAIImageInput, "images"> & {
  mockupUrl: string;
  estampaUrl: string;
};

export type GeneratedOpenAIImage = {
  buffer: Buffer;
  base64: string;
  mimeType: string;
  model: string;
  prompt: string;
  inputImages: Array<{
    url: string;
    role: OpenAIImageReferenceRole;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};

type DownloadedImage = {
  reference: Required<Pick<OpenAIImageReference, "url">> &
    Pick<OpenAIImageReference, "role" | "name">;
  blob: Blob;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type OpenAIImageResponseData = {
  b64_json?: string;
  url?: string;
};

type OpenAIImageResponse = {
  data?: OpenAIImageResponseData[];
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
};

export class OpenAIImageServiceError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "OpenAIImageServiceError";
    this.status = options?.status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export async function gerarImagemOpenAI(
  input: GenerateOpenAIImageInput,
): Promise<GeneratedOpenAIImage> {
  const apiKey = getRequiredEnv("OPENAI_API_KEY");
  const model = input.model || process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new OpenAIImageServiceError("Prompt da imagem e obrigatorio.");
  }

  if (!input.images.length) {
    throw new OpenAIImageServiceError(
      "Informe ao menos uma imagem de referencia por URL.",
    );
  }

  console.info("[openai-image-service] Iniciando geracao de imagem", {
    model,
    totalImages: input.images.length,
  });

  try {
    const downloadedImages = await Promise.all(
      input.images.map((image, index) => downloadImage(image, index)),
    );

    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", prompt);
    appendIfDefined(formData, "size", input.size);
    appendIfDefined(formData, "quality", input.quality);
    appendIfDefined(formData, "background", input.background);
    appendIfDefined(formData, "output_format", input.outputFormat);

    downloadedImages.forEach((image) => {
      formData.append("image[]", image.blob, image.filename);
    });

    console.info("[openai-image-service] Enviando imagens para OpenAI", {
      endpoint: OPENAI_IMAGES_EDIT_URL,
      files: downloadedImages.map((image) => ({
        name: image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        role: image.reference.role || "referencia",
      })),
    });

    const response = await fetch(OPENAI_IMAGES_EDIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const payload = await parseOpenAIResponse(response);

    if (!response.ok) {
      throw new OpenAIImageServiceError(
        payload.error?.message || "Erro ao gerar imagem na OpenAI.",
        {
          status: response.status,
          code: payload.error?.code || payload.error?.type,
          details: payload.error || payload,
        },
      );
    }

    const imageData = payload.data?.[0];
    const generated = await resolveGeneratedImage(imageData, input.outputFormat);

    console.info("[openai-image-service] Imagem gerada com sucesso", {
      model,
      outputBytes: generated.buffer.length,
      mimeType: generated.mimeType,
    });

    return {
      ...generated,
      model,
      prompt,
      inputImages: downloadedImages.map((image) => ({
        url: image.reference.url,
        role: image.reference.role || "referencia",
        name: image.reference.name || image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
      })),
    };
  } catch (error) {
    if (error instanceof OpenAIImageServiceError) {
      console.error("[openai-image-service] Falha controlada", {
        message: error.message,
        status: error.status,
        code: error.code,
      });
      throw error;
    }

    console.error("[openai-image-service] Falha inesperada", error);
    throw new OpenAIImageServiceError("Falha inesperada ao gerar imagem.", {
      cause: error,
    });
  }
}

export function gerarImagemMockupComEstampa(
  input: GenerateMockupWithEstampaInput,
): Promise<GeneratedOpenAIImage> {
  return gerarImagemOpenAI({
    ...input,
    images: [
      { url: input.mockupUrl, role: "mockup", name: "mockup" },
      { url: input.estampaUrl, role: "estampa", name: "estampa" },
    ],
  });
}

async function downloadImage(
  reference: OpenAIImageReference,
  index: number,
): Promise<DownloadedImage> {
  validateImageUrl(reference.url);

  console.info("[openai-image-service] Baixando imagem temporaria", {
    index,
    role: reference.role || "referencia",
    url: reference.url,
  });

  const response = await fetch(reference.url);

  if (!response.ok) {
    throw new OpenAIImageServiceError("Nao foi possivel baixar imagem por URL.", {
      status: response.status,
      details: {
        url: reference.url,
        role: reference.role,
      },
    });
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";

  if (!isSupportedImageMimeType(mimeType)) {
    throw new OpenAIImageServiceError("Formato de imagem nao suportado.", {
      details: {
        url: reference.url,
        mimeType,
        supported: ["image/png", "image/jpeg", "image/webp"],
      },
    });
  }

  const arrayBuffer = await response.arrayBuffer();

  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new OpenAIImageServiceError("Imagem excede o limite de 50MB.", {
      details: {
        url: reference.url,
        sizeBytes: arrayBuffer.byteLength,
      },
    });
  }

  return {
    reference: {
      url: reference.url,
      role: reference.role,
      name: reference.name,
    },
    blob: new Blob([arrayBuffer], { type: mimeType }),
    filename: buildImageFilename(reference, index, mimeType),
    mimeType,
    sizeBytes: arrayBuffer.byteLength,
  };
}

async function parseOpenAIResponse(response: Response): Promise<OpenAIImageResponse> {
  try {
    return (await response.json()) as OpenAIImageResponse;
  } catch (error) {
    throw new OpenAIImageServiceError("Resposta invalida da OpenAI.", {
      status: response.status,
      cause: error,
    });
  }
}

async function resolveGeneratedImage(
  imageData: OpenAIImageResponseData | undefined,
  outputFormat: OpenAIImageOutputFormat | undefined,
): Promise<Pick<GeneratedOpenAIImage, "buffer" | "base64" | "mimeType">> {
  if (imageData?.b64_json) {
    return {
      buffer: Buffer.from(imageData.b64_json, "base64"),
      base64: imageData.b64_json,
      mimeType: mimeTypeFromOutputFormat(outputFormat),
    };
  }

  if (imageData?.url) {
    const response = await fetch(imageData.url);

    if (!response.ok) {
      throw new OpenAIImageServiceError("Nao foi possivel baixar imagem gerada.", {
        status: response.status,
        details: { url: imageData.url },
      });
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      buffer,
      base64: buffer.toString("base64"),
      mimeType,
    };
  }

  throw new OpenAIImageServiceError("A OpenAI nao retornou imagem gerada.");
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new OpenAIImageServiceError(`Variavel de ambiente ${name} nao configurada.`);
  }

  return value;
}

function appendIfDefined(formData: FormData, key: string, value?: string): void {
  if (value) {
    formData.append(key, value);
  }
}

function validateImageUrl(url: string): void {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new OpenAIImageServiceError("URL de imagem invalida.", {
      details: { url },
      cause: error,
    });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new OpenAIImageServiceError("URL de imagem deve usar HTTP ou HTTPS.", {
      details: { url },
    });
  }
}

function buildImageFilename(
  reference: OpenAIImageReference,
  index: number,
  mimeType: string,
): string {
  const extensionByMimeType: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = extensionByMimeType[mimeType] || "png";
  const baseName = (reference.name || reference.role || `imagem-${index + 1}`)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `${baseName || `imagem-${index + 1}`}.${extension}`;
}

function isSupportedImageMimeType(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/webp"].includes(mimeType);
}

function mimeTypeFromOutputFormat(outputFormat: OpenAIImageOutputFormat | undefined) {
  const mimeTypeByFormat: Record<OpenAIImageOutputFormat, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };

  return outputFormat ? mimeTypeByFormat[outputFormat] : "image/png";
}
