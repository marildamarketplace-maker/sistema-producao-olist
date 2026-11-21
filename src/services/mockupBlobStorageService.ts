import {
  BlobAccessError, BlobNotFoundError, BlobPreconditionFailedError, BlobServiceNotAvailable,
  BlobServiceRateLimited, BlobStoreNotFoundError, del, get, head, list, put,
} from "@vercel/blob";
import { headers } from "next/headers";

const LIMITE_LISTAGEM = 24;

export class MockupBlobStorageError extends Error {
  constructor(message: string, readonly status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MockupBlobStorageError";
  }
}

export function getMockupBlobStoreId() {
  const storeId = process.env.MOCKUPS_BLOB_STORE_ID?.trim();
  if (!storeId || !/^store_[a-z0-9]+$/i.test(storeId)) return undefined;
  const normalizar = (value: string | undefined) => value?.replace(/^store_/, "").toLowerCase();
  if (normalizar(storeId) === normalizar(process.env.BLOB_STORE_ID)
    || normalizar(storeId) === normalizar(process.env.EVIDENCIAS_BLOB_STORE_ID)) return undefined;
  return storeId;
}

async function credenciais() {
  const storeId = getMockupBlobStoreId();
  if (!storeId) throw new MockupBlobStorageError("A loja privada de mockups não está configurada.", 503);

  let oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!oidcToken) {
    try {
      oidcToken = (await headers()).get("x-vercel-oidc-token")?.trim();
    } catch {
      // O worker local não tem contexto de requisição e usa um token da loja.
    }
  }
  if (oidcToken) return { storeId, oidcToken };

  const token = process.env.MOCKUPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const storeNoToken = token.split("_")[3]?.toLowerCase();
    const storeNoConfig = storeId.replace(/^store_/i, "").toLowerCase();
    if (!storeNoToken || storeNoToken !== storeNoConfig) {
      throw new MockupBlobStorageError("O token configurado não pertence à loja de mockups.", 503);
    }
    return { storeId, token };
  }
  throw new MockupBlobStorageError("A autenticação da loja de mockups não está configurada.", 503);
}

function normalizarErro(error: unknown): unknown {
  if (error instanceof BlobAccessError) return new MockupBlobStorageError("Acesso à loja de mockups negado.", 403, { cause: error });
  if (error instanceof BlobStoreNotFoundError) return new MockupBlobStorageError("Loja de mockups não encontrada.", 503, { cause: error });
  if (error instanceof BlobServiceRateLimited) return new MockupBlobStorageError("Limite de requisições da loja de mockups atingido.", 429, { cause: error });
  if (error instanceof BlobServiceNotAvailable) return new MockupBlobStorageError("Loja de mockups temporariamente indisponível.", 503, { cause: error });
  return error;
}

function caminhoValido(path: string) {
  const normalizado = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizado || normalizado.includes("..") || /^\w+:/.test(normalizado)) {
    throw new MockupBlobStorageError("Caminho de mockup inválido.", 400);
  }
  return normalizado;
}

export const mockupBlobStorage = {
  async listar(prefix: string, cursor?: string) {
    try {
      const resultado = await list({
        ...(await credenciais()),
        prefix: caminhoValido(prefix),
        cursor,
        limit: LIMITE_LISTAGEM,
      });
      return { blobs: resultado.blobs, cursor: resultado.hasMore ? resultado.cursor ?? null : null };
    } catch (error) {
      throw normalizarErro(error);
    }
  },

  async ler(path: string, contentType: string, signal?: AbortSignal) {
    try {
      const blob = await get(caminhoValido(path), {
        ...(await credenciais()), access: "private", useCache: false, abortSignal: signal,
      });
      if (!blob || blob.statusCode !== 200) throw new MockupBlobStorageError("Imagem de mockup não encontrada.", 404);
      if (blob.blob.contentType !== contentType) {
        await blob.stream.cancel();
        throw new MockupBlobStorageError("Formato de imagem de mockup inválido.", 415);
      }
      return blob.stream;
    } catch (error) {
      if (error instanceof MockupBlobStorageError) throw error;
      if (error instanceof BlobNotFoundError) throw new MockupBlobStorageError("Imagem de mockup não encontrada.", 404, { cause: error });
      throw normalizarErro(error);
    }
  },

  async enviar(input: { path: string; buffer: Buffer; contentType: string; somenteNovo?: boolean; signal?: AbortSignal }) {
    const auth = await credenciais();
    try {
      const blob = await put(caminhoValido(input.path), input.buffer, {
        ...auth,
        access: "private",
        contentType: input.contentType,
        addRandomSuffix: false,
        allowOverwrite: !input.somenteNovo,
        abortSignal: input.signal,
      });
      return { bucket: auth.storeId, path: blob.pathname };
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        throw new MockupBlobStorageError("Imagem já existente.", 412, { cause: error });
      }
      throw normalizarErro(error);
    }
  },

  async remover(path: string) {
    try {
      await del(caminhoValido(path), await credenciais());
    } catch (error) {
      if (error instanceof BlobNotFoundError) return;
      throw normalizarErro(error);
    }
  },

  async existe(path: string) {
    try {
      await head(caminhoValido(path), await credenciais());
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw normalizarErro(error);
    }
  },

  async existem(paths: string[]) {
    for (let inicio = 0; inicio < paths.length; inicio += 6) {
      const encontrados = await Promise.all(paths.slice(inicio, inicio + 6).map((path) => this.existe(path)));
      if (encontrados.some((existe) => !existe)) return false;
    }
    return true;
  },
};
