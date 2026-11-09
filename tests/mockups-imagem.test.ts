import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MOCKUP_MAX_BYTES } from "../src/lib/mockups";
import { MockupInvalido, mockupPorId, prepararImagemMockup } from "../src/lib/mockups-imagem";

function upload(body: Uint8Array<ArrayBuffer> | string, nome = "  Café / Coleção  ", tipo?: string) {
  return new Request("http://localhost/api/controle-midia/mockups", {
    method: "POST",
    headers: { "x-mockup-nome": encodeURIComponent(nome), "Content-Type": "image/png", ...(tipo ? { "x-mockup-tipo": tipo } : {}) },
    body,
  });
}

test("normaliza imagem com transparência e mantém o identificador em reenvios", async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
  }).png().toBuffer();
  const bytes = new Uint8Array(png);
  const mockup = await prepararImagemMockup(upload(bytes));
  const reenvio = await prepararImagemMockup(upload(bytes, "Café / Coleção"));

  assert.equal(mockup.id, reenvio.id);
  assert.deepEqual(mockupPorId(mockup.id), { id: mockup.id, nome: "Café / Coleção", tipo: "INDIVIDUAL" });
  assert.equal(mockupPorId(`../${mockup.id}`), null);
  const metadata = await sharp(mockup.imagem).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.width, 2);
});

test("rejeita conteúdo incompatível mesmo com MIME de imagem", async () => {
  for (const body of ["<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>", "PNG inválido"]) {
    await assert.rejects(prepararImagemMockup(upload(body)), { status: 415 });
  }
});

test("rejeita upload acima do limite mesmo sem Content-Length", async () => {
  await assert.rejects(prepararImagemMockup(upload(new Uint8Array(MOCKUP_MAX_BYTES + 1))), { status: 413 });
});

test("rejeita nome vazio ou com caracteres de controle", async () => {
  for (const nome of ["  ", "Mockup\nInverno"]) {
    await assert.rejects(prepararImagemMockup(upload("", nome)), MockupInvalido);
  }
});

test("classifica layouts sem alterar os identificadores dos mockups individuais existentes", async () => {
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  }).png().toBuffer();
  const bytes = new Uint8Array(png);
  const individual = await prepararImagemMockup(upload(bytes, "Vitrine"));
  const layout = await prepararImagemMockup(upload(bytes, "Vitrine", "LAYOUT"));

  assert.equal(layout.id, `layout-${individual.id}`);
  assert.deepEqual(mockupPorId(layout.id), { id: layout.id, nome: "Vitrine", tipo: "LAYOUT" });
  await assert.rejects(prepararImagemMockup(upload(bytes, "Vitrine", "OUTRO")), { status: 400 });
});

test("rejeita imagens retangulares no cadastro de individuais e layouts", async () => {
  for (const [width, height] of [[10, 20], [20, 10]]) {
    const png = await sharp({
      create: { width, height, channels: 3, background: "white" },
    }).png().toBuffer();
    for (const tipo of ["INDIVIDUAL", "LAYOUT"]) {
      await assert.rejects(prepararImagemMockup(upload(new Uint8Array(png), "Vitrine", tipo)), {
        status: 422,
        message: /quadrada/,
      });
    }
  }
});
