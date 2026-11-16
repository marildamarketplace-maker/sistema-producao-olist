import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { normalizarImagemVisual, MAX_IMAGEM_BYTES } from "../src/lib/estampas-visuais/imagem";
import { criarConsultaFoto, lerConsultaFoto, limitarConsultaFoto } from "../src/lib/estampas-visuais/consulta-foto";
import { lerUploadVisual } from "../src/lib/estampas-visuais/upload";

const foto = () => sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } }).png().toBuffer();

test("normaliza PNG/JPEG/WebP sem cortar, remove EXIF e produz hash estável", async () => {
  const input = await foto();
  const a = await normalizarImagemVisual(input);
  const b = await normalizarImagemVisual(input);
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.bytes, b.bytes);
  const meta = await sharp(a.bytes).metadata();
  assert.equal(meta.format, "jpeg"); assert.equal(meta.width, 120); assert.equal(meta.height, 80); assert.equal(meta.exif, undefined);
  await normalizarImagemVisual(await sharp(input).webp().toBuffer());
  await normalizarImagemVisual(await sharp(input).jpeg().toBuffer());
  const grande = await sharp({ create: { width: 2048, height: 512, channels: 3, background: "blue" } }).png().toBuffer();
  const reduzida = await sharp((await normalizarImagemVisual(grande)).bytes).metadata();
  assert.equal(reduzida.width, 1024); assert.equal(reduzida.height, 256);
});

test("rejeita arquivo disfarçado, truncado, vazio, pequeno e acima do limite", async () => {
  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(0), Buffer.from([255,216,255]), Buffer.alloc(MAX_IMAGEM_BYTES + 1),
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer()]) {
    await assert.rejects(normalizarImagemVisual(bytes));
  }
});

test("consulta temporária é cifrada, vinculada ao usuário, autenticada e expira", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "segredo-ficticio";
  const referencia = { motivos: ["flores"], cores: ["azul"], tema: "floral", estilo: "", distribuicao: "", linguagemVisual: "" };
  const token = criarConsultaFoto("usuario", referencia, 0);
  assert.deepEqual(lerConsultaFoto(token, "usuario", 1), referencia);
  assert.throws(() => lerConsultaFoto(token, "outro", 1));
  assert.throws(() => lerConsultaFoto(token, "usuario", 30 * 60_000));
  assert.throws(() => lerConsultaFoto(token.slice(0, -5) + "XXXXX", "usuario", 1));
  assert.doesNotMatch(token, /flores|usuario/);
});

test("limita análises por usuário e permite nova janela", () => {
  for (let i = 0; i < 6; i++) limitarConsultaFoto("limite", 0);
  assert.throws(() => limitarConsultaFoto("limite", 1));
  limitarConsultaFoto("outro", 1);
  limitarConsultaFoto("limite", 60_000);
});

test("upload multipart tem limite mesmo sem content-length", async () => {
  const body = new FormData(); body.set("foto", new Blob([new Uint8Array(await foto())]), "foto.png");
  const form = await lerUploadVisual(new Request("http://localhost", { method: "POST", body }));
  assert.equal((form.get("foto") as File).name, "foto.png");
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGEM_BYTES + 65 * 1024)); controller.close(); } });
  const request = new Request("http://localhost", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=test" }, duplex: "half" } as RequestInit);
  await assert.rejects(lerUploadVisual(request), (e: unknown) => e instanceof Error && "status" in e && e.status === 413);
});
