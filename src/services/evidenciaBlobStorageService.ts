import { del, get, put } from "@vercel/blob";
import { headers } from "next/headers";
import { EvidenciaProducaoError } from "../lib/producao-evidencia-contrato";

const BUCKET_GOOGLE_MIGRADO = "sistema-producao-olist-evidencias";

export function getEvidenciasBlobStoreId() {
  const storeId = process.env.EVIDENCIAS_BLOB_STORE_ID?.trim();
  if (!storeId) return undefined;
  const normalizar = (value: string | undefined) => value?.replace(/^store_/, "").toLowerCase();
  if (!/^store_[a-z0-9]+$/i.test(storeId) || normalizar(storeId) === normalizar(process.env.BLOB_STORE_ID?.trim())) {
    throw new EvidenciaProducaoError("Loja privada de evidências inválida.", 503);
  }
  return storeId;
}

export function resolverLojaEvidenciaBlob(bucket: string) {
  const storeId = getEvidenciasBlobStoreId();
  return bucket === storeId || bucket === BUCKET_GOOGLE_MIGRADO ? storeId : undefined;
}

async function credenciais(storeId: string) {
  if (storeId !== getEvidenciasBlobStoreId()) {
    throw new EvidenciaProducaoError("Loja privada de evidências não configurada.", 503);
  }
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim() || (await headers()).get("x-vercel-oidc-token")?.trim();
  if (!oidcToken) throw new EvidenciaProducaoError("Autenticação do armazenamento de evidências indisponível.", 503);
  return { storeId, oidcToken };
}

export const evidenciaBlobStorage = {
  async enviar(input: { bucket: string; path: string; buffer: Buffer; contentType: string }) {
    const blob = await put(input.path, input.buffer, {
      ...await credenciais(input.bucket),
      access: "private",
      contentType: input.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return { bucket: input.bucket, path: blob.pathname, publicUrl: blob.url };
  },

  async remover(path: string, bucket: string) {
    await del(path, await credenciais(bucket));
  },
};

export async function lerEvidenciaBlob(storeId: string, path: string) {
  const blob = await get(path, { ...await credenciais(storeId), access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200) return null;
  if (blob.blob.contentType !== "image/jpeg") {
    await blob.stream.cancel();
    throw new Error("Formato de evidência inválido.");
  }
  return blob.stream;
}
