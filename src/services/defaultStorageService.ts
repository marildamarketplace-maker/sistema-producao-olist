import {
  deleteGoogleStorageObject,
  getGoogleStorageObjectInfo,
  uploadToGoogleStorage,
} from "./googleStorageService";

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

  throw new Error("Provedor de armazenamento público não suportado em STORAGE_DEFAULT_PROVIDER.");
}
