import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import axios, { type AxiosResponse } from "axios";
import { carregarEvidenciaWorker, motivoEvidenciaIndisponivel } from "@/lib/automatizacao/evidencia-worker";
import { imagemWhatsappSchema, prefixoImagemWhatsapp } from "@/lib/whatsapp-image";
import { enviarNotificationWhatsapp } from "@/services/notification/whatsappNotificationSender";

test("captura local vira JPEG transportável; rejeita fuga, symlink, arquivo antigo e formato falso", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "evidencia-test-"));
  try {
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    const arquivo = join(pasta, "print.png");
    await writeFile(arquivo, bytes);
    const evidencia = await carregarEvidenciaWorker(arquivo, pasta, Date.now() - 5000);
    assert.equal(evidencia.mimetype, "image/jpeg");
    const relativa = await carregarEvidenciaWorker("print.png", pasta, Date.now() - 5000);
    assert.deepEqual(relativa, evidencia);
    const relativaPonto = await carregarEvidenciaWorker("./print.png", pasta, Date.now() - 5000);
    assert.deepEqual(relativaPonto, evidencia);
    assert.equal((await sharp(Buffer.from(evidencia.media, "base64")).metadata()).width, 20);
    await assert.rejects(carregarEvidenciaWorker(arquivo, join(pasta, "outra"), 0));
    await symlink('/etc/passwd', join(pasta, 'escape.png'));
    await assert.rejects(carregarEvidenciaWorker(join(pasta, 'escape.png'), pasta, 0), /FORA_DA_PASTA/);
    await assert.rejects(carregarEvidenciaWorker('escape.png', pasta, 0), /FORA_DA_PASTA/);
    await utimes(arquivo, new Date(0), new Date(0));
    await assert.rejects(carregarEvidenciaWorker(arquivo, pasta, Date.now()), /ANTIGA/);
    assert.equal(imagemWhatsappSchema.safeParse({ media: bytes.toString("base64"), mimetype: "image/jpeg" }).success, false);
    assert.equal(imagemWhatsappSchema.safeParse({ media: "file:///etc/passwd", mimetype: "image/png" }).success, false);
    assert.equal(imagemWhatsappSchema.safeParse({ media: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"), mimetype: "image/png" }).success, false);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test("envelope envia imagem à Z-API; inválido não é enviado como texto nem exposto em erro", async (t) => {
  const oldApi = process.env.ZAPI_INSTANCE_API, oldToken = process.env.ZAPI_CLIENT_TOKEN;
  process.env.ZAPI_INSTANCE_API = 'https://api.test/instance/send-text';
  process.env.ZAPI_CLIENT_TOKEN = 'teste';
  t.after(() => {
    if (oldApi === undefined) delete process.env.ZAPI_INSTANCE_API; else process.env.ZAPI_INSTANCE_API = oldApi;
    if (oldToken === undefined) delete process.env.ZAPI_CLIENT_TOKEN; else process.env.ZAPI_CLIENT_TOKEN = oldToken;
  });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const calls: { url: string; data: unknown }[] = [];
  t.mock.method(axios, "post", async (url: string, data: unknown) => {
    calls.push({ url, data });
    return { status: 200, data: { messageId: "ok" } } as AxiosResponse;
  });
  const notification = { id: "teste", tipo: "WHATSAPP" as const, to: "120363412284116447-group", titulo: "Rotina", data: new Date(), tentativas: 0,
    mensagem: prefixoImagemWhatsapp + JSON.stringify({ media: bytes.toString("base64"), mimetype: "image/png", caption: "Resultado confirmado" }) };
  await enviarNotificationWhatsapp(notification);
  assert.deepEqual(calls, [{ url: "https://api.test/instance/send-image", data: { phone: notification.to, image: `data:image/png;base64,${bytes.toString("base64")}`, caption: "Resultado confirmado" } }]);
  await assert.rejects(enviarNotificationWhatsapp({ ...notification, mensagem: prefixoImagemWhatsapp + '{"media":"SEGREDO"}' }), /Imagem WhatsApp inválida/);
  assert.equal(calls.length, 1);
});

 test("motivos de indisponibilidade não expõem caminhos ou dados do erro", () => {
   assert.match(motivoEvidenciaIndisponivel(Object.assign(new Error("/privado/segredo"), { code: "ENOENT" })), /não encontrado/);
   assert.match(motivoEvidenciaIndisponivel(Object.assign(new Error("segredo"), { code: "EACCES" })), /permissão/);
   assert.match(motivoEvidenciaIndisponivel(new Error("EVIDENCIA_FORA_DA_PASTA")), /fora da pasta/);
   assert.doesNotMatch(motivoEvidenciaIndisponivel(new Error("segredo")), /segredo/);
 });
