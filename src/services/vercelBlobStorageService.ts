import { BlobNotFoundError, del, head, put } from "@vercel/blob";

export function getVercelBlobPublicHost() {
  const storeId = process.env.BLOB_STORE_ID?.trim().replace(/^store_/, "");
  if (!storeId || !/^[a-z0-9]+$/i.test(storeId)) return undefined;
  return `${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

function getStoreId() {
  const storeId = process.env.BLOB_STORE_ID?.trim();
  if (!getVercelBlobPublicHost() || !storeId) throw new Error("BLOB_STORE_ID inválido ou não configurado.");
  return storeId;
}

function objectPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || /^\w+:/.test(normalized)) {
    throw new Error("Caminho de armazenamento inválido.");
  }
  return normalized;
}

export const vercelBlobStorage = {
  async upload(input: { path: string; buffer: Buffer; contentType: string; somenteNovo?: boolean; signal?: AbortSignal }) {
    const bucket = getStoreId();
    const blob = await put(objectPath(input.path), input.buffer, {
      access: "public",
      storeId: bucket,
      contentType: input.contentType,
      allowOverwrite: !input.somenteNovo,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      abortSignal: input.signal,
    });
    return { bucket, path: blob.pathname, publicUrl: blob.url };
  },

  async getObjectInfo(path: string) {
    const bucket = getStoreId();
    const pathname = objectPath(path);
    try {
      const blob = await head(pathname, { storeId: bucket });
      return { bucket, path: blob.pathname, publicUrl: blob.url, exists: true };
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
      return { bucket, path: pathname, publicUrl: "", exists: false };
    }
  },

  async deleteObject(path: string) {
    await del(objectPath(path), { storeId: getStoreId() });
  },
};
