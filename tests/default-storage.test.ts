import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultStorage } from "../src/services/defaultStorageService";
import {
  deleteGoogleStorageObject,
  getGoogleStorageObjectInfo,
  uploadToGoogleStorage,
} from "../src/services/googleStorageService";

test("seleciona Google por padrão e rejeita provedores indisponíveis", (t) => {
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

  for (const value of ["vercel", "typo"]) {
    process.env.STORAGE_DEFAULT_PROVIDER = value;
    assert.throws(getDefaultStorage, /STORAGE_DEFAULT_PROVIDER/);
  }
});
