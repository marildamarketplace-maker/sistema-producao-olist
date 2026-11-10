import assert from "node:assert/strict";
import test from "node:test";
import { deleteStoredMedia, getDefaultStorage } from "../src/services/defaultStorageService";
import {
  deleteGoogleStorageObject,
  getGoogleStorageObjectInfo,
  uploadToGoogleStorage,
} from "../src/services/googleStorageService";

import { vercelBlobStorage } from "../src/services/vercelBlobStorageService";

test("seleciona Google por padrão ou Vercel explicitamente", (t) => {
  const original = process.env.STORAGE_DEFAULT_PROVIDER;
  t.after(() => {
    if (original === undefined) delete process.env.STORAGE_DEFAULT_PROVIDER;
    else process.env.STORAGE_DEFAULT_PROVIDER = original;
  });

  delete process.env.STORAGE_DEFAULT_PROVIDER;
  const storage = getDefaultStorage();
  assert.equal(storage.upload, uploadToGoogleStorage);
  assert.equal(storage.getObjectInfo, getGoogleStorageObjectInfo);
  assert.equal(storage.deleteObject, deleteGoogleStorageObject);

  for (const value of ["", " google "]) {
    process.env.STORAGE_DEFAULT_PROVIDER = value;
    assert.equal(getDefaultStorage(), storage);
  }

  process.env.STORAGE_DEFAULT_PROVIDER = "vercel";
  assert.equal(getDefaultStorage().upload, vercelBlobStorage.upload);
  process.env.STORAGE_DEFAULT_PROVIDER = "typo";
  assert.throws(getDefaultStorage, /STORAGE_DEFAULT_PROVIDER/);
});

test("rejeita exclusão de mídia com origem desconhecida", () => {
  assert.throws(() => deleteStoredMedia("image.png", "https://example.com/image.png"), /Origem/);
});
