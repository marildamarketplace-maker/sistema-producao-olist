import {
  deleteGoogleStorageObject,
  getGoogleStorageObjectInfo,
  uploadToGoogleStorage,
} from "./googleStorageService";

import { getVercelBlobPublicHost, vercelBlobStorage } from "./vercelBlobStorageService";

const providers = {
  google: {
    upload: uploadToGoogleStorage,
    getObjectInfo: getGoogleStorageObjectInfo,
    deleteObject: deleteGoogleStorageObject,
  },
};

export function getDefaultStorage() {
  const provider = process.env.STORAGE_DEFAULT_PROVIDER?.trim() || "google";

  if (provider === "google") return providers.google;
  if (provider === "vercel") return {
    ...vercelBlobStorage,
    async getObjectInfo(path: string) {
      const blob = await vercelBlobStorage.getObjectInfo(path);
      return blob.exists ? blob : providers.google.getObjectInfo(path);
    },
  };

  throw new Error("Provedor de armazenamento público não suportado em STORAGE_DEFAULT_PROVIDER.");
}

export function deleteStoredMedia(path: string, publicUrl: string) {
  const url = new URL(publicUrl);
  if (url.origin === "https://storage.googleapis.com") {
    const [, bucket] = url.pathname.split("/");
    if (bucket) return providers.google.deleteObject(path, decodeURIComponent(bucket));
  }
  const blobHost = getVercelBlobPublicHost();
  if (blobHost && url.origin === `https://${blobHost}`) {
    return vercelBlobStorage.deleteObject(path);
  }
  throw new Error("Origem da mídia não reconhecida pelo armazenamento.");
}
