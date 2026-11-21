import assert from "node:assert/strict";
import test from "node:test";
import { getMockupBlobStoreId } from "../src/services/mockupBlobStorageService";

test("mockups exige uma loja Vercel dedicada e válida", (t) => {
  const originais = {
    mockups: process.env.MOCKUPS_BLOB_STORE_ID,
    publica: process.env.BLOB_STORE_ID,
    evidencias: process.env.EVIDENCIAS_BLOB_STORE_ID,
  };
  t.after(() => {
    if (originais.mockups === undefined) delete process.env.MOCKUPS_BLOB_STORE_ID;
    else process.env.MOCKUPS_BLOB_STORE_ID = originais.mockups;
    if (originais.publica === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = originais.publica;
    if (originais.evidencias === undefined) delete process.env.EVIDENCIAS_BLOB_STORE_ID;
    else process.env.EVIDENCIAS_BLOB_STORE_ID = originais.evidencias;
  });

  process.env.BLOB_STORE_ID = "store_publica";
  process.env.EVIDENCIAS_BLOB_STORE_ID = "store_evidencias";
  process.env.MOCKUPS_BLOB_STORE_ID = "store_mockups";
  assert.equal(getMockupBlobStoreId(), "store_mockups");

  process.env.MOCKUPS_BLOB_STORE_ID = "store_publica";
  assert.equal(getMockupBlobStoreId(), undefined);
  process.env.MOCKUPS_BLOB_STORE_ID = "store_evidencias";
  assert.equal(getMockupBlobStoreId(), undefined);
  process.env.MOCKUPS_BLOB_STORE_ID = "id-invalido";
  assert.equal(getMockupBlobStoreId(), undefined);
});
