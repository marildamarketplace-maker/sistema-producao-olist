import { Buffer } from "node:buffer";
import { isIP } from "node:net";

import type { EstampaCatalogo } from "@/repositories/catalogo-estampas-repository";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ALLOWED_HOSTS = ["storage.googleapis.com"];
const MAX_REDIRECTS = 3;

const MIME_TYPES_SUPORTADOS = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CodigoErroPreviewEstampa =
  | "EMPTY_URL"
  | "INVALID_URL"
  | "HTTP_NOT_FOUND"
  | "HTTP_FORBIDDEN"
  | "HTTP_TEMPORARY_ERROR"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "NOT_IMAGE"
  | "UNSUPPORTED_FORMAT"
  | "TOO_LARGE"
  | "EMPTY_RESPONSE"
  | "INVALID_IMAGE";

export class CarregarPreviewEstampaError extends Error {
  readonly code: CodigoErroPreviewEstampa;
  readonly status?: number;
  readonly retriable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: CodigoErroPreviewEstampa;
      status?: number;
      retriable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "CarregarPreviewEstampaError";
    this.code = options.code;
    this.status = options.status;
    this.retriable = options.retriable ?? false;
    this.details = options.details;
  }
}

export type PreviewEstampaCarregado = {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sourceUrl: string;
  filename: string | null;
};

export type OpcoesCarregarPreviewEstampa = {
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: readonly string[];
  fetchImpl?: typeof fetch;
};

export async function carregarPreviewEstampa(
  estampa: Pick<EstampaCatalogo, "id" | "preview_url">,
  options: OpcoesCarregarPreviewEstampa = {},
): Promise<PreviewEstampaCarregado> {
  const timeoutMs = validarInteiroPositivo(
    options.timeoutMs ?? numeroEnv("ESTAMPA_PREVIEW_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    "timeoutMs",
  );
  const maxBytes = validarInteiroPositivo(
    options.maxBytes ?? numeroEnv("ESTAMPA_PREVIEW_MAX_BYTES", DEFAULT_MAX_BYTES),
    "maxBytes",
  );
  const allowedHosts = normalizarHostsPermitidos(options.allowedHosts);
  const initialUrl = validarUrlPreviewEstampa(estampa.preview_url, allowedHosts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Preview timeout")), timeoutMs);

  try {
    const { response, finalUrl } = await buscarComRedirecionamentos(
      initialUrl,
      controller.signal,
      allowedHosts,
      options.fetchImpl ?? fetch,
    );
    if (!response.ok) {
      await response.body?.cancel();
      validarStatusHttp(response, finalUrl);
    }

    const contentType = normalizarContentType(response.headers.get("content-type"));
    if (!contentType.startsWith("image/")) {
      await response.body?.cancel();
      throw new CarregarPreviewEstampaError("O preview retornado não é uma imagem.", {
        code: "NOT_IMAGE",
        status: response.status,
        details: { contentType, url: finalUrl.toString() },
      });
    }
    if (!MIME_TYPES_SUPORTADOS.has(contentType)) {
      await response.body?.cancel();
      throw new CarregarPreviewEstampaError("Formato de imagem não suportado.", {
        code: "UNSUPPORTED_FORMAT",
        status: response.status,
        details: {
          contentType,
          suportados: [...MIME_TYPES_SUPORTADOS],
          url: finalUrl.toString(),
        },
      });
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel();
      throw tamanhoExcedido(maxBytes, contentLength, finalUrl);
    }

    const buffer = await lerBufferLimitado(response, maxBytes, finalUrl);
    if (buffer.length === 0) {
      throw new CarregarPreviewEstampaError("O Cloud retornou um arquivo vazio.", {
        code: "EMPTY_RESPONSE",
        retriable: true,
        details: { url: finalUrl.toString() },
      });
    }
    validarAssinaturaImagem(buffer, contentType, finalUrl);

    return {
      buffer,
      mimeType: contentType as PreviewEstampaCarregado["mimeType"],
      sizeBytes: buffer.length,
      sourceUrl: finalUrl.toString(),
      filename: obterNomeArquivo(finalUrl),
    };
  } catch (error) {
    if (error instanceof CarregarPreviewEstampaError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new CarregarPreviewEstampaError("Tempo limite ao carregar o preview da estampa.", {
        code: "TIMEOUT",
        retriable: true,
        details: { estampaId: estampa.id, timeoutMs },
        cause: error,
      });
    }
    throw new CarregarPreviewEstampaError("Falha de rede ao carregar o preview da estampa.", {
      code: "NETWORK_ERROR",
      retriable: true,
      details: { estampaId: estampa.id, url: initialUrl.toString() },
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function buscarComRedirecionamentos(
  initialUrl: URL,
  signal: AbortSignal,
  allowedHosts: readonly string[],
  fetchImpl: typeof fetch,
) {
  let currentUrl = initialUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { Accept: "image/png,image/jpeg,image/webp" },
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) {
      throw new CarregarPreviewEstampaError("Redirecionamento sem URL de destino.", {
        code: "HTTP_ERROR",
        status: response.status,
        details: { url: currentUrl.toString() },
      });
    }
    if (redirect === MAX_REDIRECTS) {
      throw new CarregarPreviewEstampaError("O preview excedeu o limite de redirecionamentos.", {
        code: "HTTP_ERROR",
        status: response.status,
        details: { maxRedirects: MAX_REDIRECTS, url: currentUrl.toString() },
      });
    }
    currentUrl = validarUrlPreviewEstampa(
      new URL(location, currentUrl).toString(),
      allowedHosts,
    );
  }

  throw new Error("Estado de redirecionamento inválido.");
}

async function lerBufferLimitado(response: Response, maxBytes: number, url: URL) {
  if (!response.body) {
    throw new CarregarPreviewEstampaError("A resposta do preview não possui conteúdo.", {
      code: "EMPTY_RESPONSE",
      retriable: true,
      details: { url: url.toString() },
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw tamanhoExcedido(maxBytes, total, url);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function validarUrlPreviewEstampa(
  value: string | null | undefined,
  allowedHosts: readonly string[] = normalizarHostsPermitidos(),
) {
  const urlText = value?.trim();
  if (!urlText) {
    throw new CarregarPreviewEstampaError("A estampa não possui preview_url.", {
      code: "EMPTY_URL",
    });
  }

  try {
    const url = new URL(urlText);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error("URL não permitida");
    }
    if (hostPrivadoOuLocal(url.hostname)) throw new Error("Host privado ou local não permitido");
    if (!hostPermitido(url.hostname, allowedHosts)) {
      throw new Error("Host não consta na allowlist de previews");
    }
    return url;
  } catch (error) {
    if (error instanceof CarregarPreviewEstampaError) throw error;
    throw new CarregarPreviewEstampaError("preview_url inválida ou não permitida.", {
      code: "INVALID_URL",
      details: { url: urlText },
      cause: error,
    });
  }
}

function normalizarHostsPermitidos(override?: readonly string[]) {
  const configured = override ?? (
    process.env.ESTAMPA_PREVIEW_ALLOWED_HOSTS
      ?.split(",")
      .map((host) => host.trim())
      .filter(Boolean) ?? DEFAULT_ALLOWED_HOSTS
  );
  const hosts = [...new Set(configured.map((host) => host.toLowerCase()))];
  if (hosts.length === 0 || hosts.some((host) => !hostValidoParaAllowlist(host))) {
    throw new Error("ESTAMPA_PREVIEW_ALLOWED_HOSTS possui host vazio ou inválido.");
  }
  return hosts;
}

function hostValidoParaAllowlist(host: string) {
  const semWildcard = host.startsWith("*.") ? host.slice(2) : host;
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(semWildcard) &&
    !semWildcard.includes("..") &&
    !hostPrivadoOuLocal(semWildcard);
}

function hostPermitido(hostname: string, allowedHosts: readonly string[]) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((permitido) => {
    if (permitido.startsWith("*.")) {
      const sufixo = permitido.slice(1);
      return host.endsWith(sufixo) && host.length > sufixo.length;
    }
    return host === permitido;
  });
}

function hostPrivadoOuLocal(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) === 4) {
    const partes = host.split(".").map(Number);
    return partes[0] === 10 || partes[0] === 127 || partes[0] === 0 ||
      (partes[0] === 169 && partes[1] === 254) ||
      (partes[0] === 172 && partes[1] >= 16 && partes[1] <= 31) ||
      (partes[0] === 192 && partes[1] === 168);
  }
  if (isIP(host) === 6) {
    return host === "::1" || host === "::" || host.startsWith("fc") ||
      host.startsWith("fd") || /^fe[89ab]/u.test(host);
  }
  return false;
}

function validarStatusHttp(response: Response, url: URL) {
  if (response.ok) return;
  const details = { status: response.status, url: url.toString() };
  if (response.status === 404) {
    throw new CarregarPreviewEstampaError("Preview não encontrado no Cloud.", {
      code: "HTTP_NOT_FOUND",
      status: 404,
      details,
    });
  }
  if (response.status === 403) {
    throw new CarregarPreviewEstampaError("Acesso negado ao preview da estampa.", {
      code: "HTTP_FORBIDDEN",
      status: 403,
      details,
    });
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new CarregarPreviewEstampaError("Cloud temporariamente indisponível.", {
      code: "HTTP_TEMPORARY_ERROR",
      status: response.status,
      retriable: true,
      details,
    });
  }
  throw new CarregarPreviewEstampaError(`Erro HTTP ${response.status} ao carregar o preview.`, {
    code: "HTTP_ERROR",
    status: response.status,
    details,
  });
}

function validarAssinaturaImagem(buffer: Buffer, mimeType: string, url: URL) {
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp = buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  const assinaturaValida =
    (mimeType === "image/png" && png) ||
    (mimeType === "image/jpeg" && jpeg) ||
    (mimeType === "image/webp" && webp);

  if (!assinaturaValida) {
    throw new CarregarPreviewEstampaError("O conteúdo não corresponde ao formato de imagem informado.", {
      code: "INVALID_IMAGE",
      details: { mimeType, url: url.toString() },
    });
  }
}

function tamanhoExcedido(maxBytes: number, sizeBytes: number, url: URL) {
  return new CarregarPreviewEstampaError("O preview excede o tamanho máximo permitido.", {
    code: "TOO_LARGE",
    details: { maxBytes, sizeBytes, url: url.toString() },
  });
}

function normalizarContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function obterNomeArquivo(url: URL) {
  const segmento = url.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(segmento).trim() || null;
  } catch {
    return segmento.trim() || null;
  }
}

function validarInteiroPositivo(value: number, campo: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${campo} deve ser um inteiro maior que zero.`);
  }
  return value;
}

function numeroEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}
