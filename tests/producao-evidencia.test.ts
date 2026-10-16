import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { normalizarFotoEvidencia, confirmarProducaoComEvidencia } from "../src/lib/producao-evidencia";
import { MAX_FOTO_EVIDENCIA_BYTES } from "../src/lib/producao-evidencia-contrato";

async function fotoValida() {
  const buffer = await sharp({ create: { width: 50, height: 30, channels: 3, background: "white" } }).png().withMetadata().toBuffer();
  return new File([new Uint8Array(buffer)], "foto.png", { type: "image/png" });
}

test("decodifica a imagem real e produz JPEG sem EXIF", async () => {
  const normalizada = await normalizarFotoEvidencia(await fotoValida());
  const metadata = await sharp(normalizada).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 50);
});

test("reduz resolução e tamanho de pedidos em retrato e paisagem", async (t) => {
  for (const [width, height] of [[2100, 3000], [3000, 2100]]) {
    const linhas = Array.from({ length: 55 }, (_, i) =>
      `<text x="80" y="${100 + i * 35}" font-size="24">Pedido de teste - Item ${i + 1} - Quantidade: 50 - Entrega: 16/10/2026</text>`,
    ).join("");
    const original = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${linhas}</svg>`)).png().toBuffer();
    const anterior = await sharp(original).resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const otimizada = await normalizarFotoEvidencia(new File([new Uint8Array(original)], "pedido.png", { type: "image/png" }));
    const metadata = await sharp(otimizada).metadata();
    assert.equal(Math.max(metadata.width!, metadata.height!), 1600);
    assert.ok(Math.abs(metadata.width! / metadata.height! - width / height) < 0.002);
    assert.ok(otimizada.length < anterior.length);
    t.diagnostic(`${width}x${height}: ${anterior.length} → ${otimizada.length} bytes (${Math.round(100 * (1 - otimizada.length / anterior.length))}% menor; amostra sintética).`);
  }
});

test("rejeita MIME falsificado, SVG, foto vazia e arquivo acima do limite", async () => {
  for (const foto of [
    new File(["texto disfarçado"], "foto.jpg", { type: "image/jpeg" }),
    new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'], "foto.jpg", { type: "image/jpeg" }),
    new File([], "foto.jpg"),
    new File([new Uint8Array(MAX_FOTO_EVIDENCIA_BYTES + 1)], "foto.jpg"),
  ]) await assert.rejects(normalizarFotoEvidencia(foto));
});

test("upload e confirmação preservam vínculo, isolamento e limpeza em caso de erro", async (t) => {
  process.env.GOOGLE_CLOUD_STORAGE_EVIDENCIAS_BUCKET = "bucket-privado-teste";
  let pendente = true;
  let persistida = false;
  let falharTransacao = false;
  let uploads = 0;
  let removidos = 0;
  let confirmarChamadas = 0;
  const storage = {
    verificarPrivacidade: async (bucket: string) => { assert.equal(bucket, "bucket-privado-teste"); },
    enviar: async (input: { bucket?: string; path: string; buffer: Buffer; contentType: string }) => {
      uploads++;
      assert.match(input.path, /^producao-evidencias\/app\/pedido\/[\w-]+\.jpg$/);
      assert.equal(input.contentType, "image/jpeg");
      return { bucket: input.bucket!, path: input.path, publicUrl: `https://storage.googleapis.com/${input.bucket}/${input.path}` };
    },
    remover: async () => { removidos++; },
  };
  Object.assign(globalThis, { prisma: {
    solicitacaoProducao: { findFirst: async ({ where }: { where: { aplicativoId: string; status?: string } }) => {
      assert.equal(where.aplicativoId, "app");
      return (where.status ? pendente : persistida) ? { id: "pedido" } : null;
    } },
    $transaction: async (executar: (tx: unknown) => Promise<void>) => {
      confirmarChamadas++;
      if (falharTransacao) throw new Error("conflito de transação");
      return executar({
        solicitacaoProducao: { findFirst: async () => ({ id: "pedido" }), update: async ({ data }: { data: { evidenciaBucket: string; evidenciaUrl: string; status: string } }) => {
          assert.equal(data.status, "concluida");
          assert.equal(data.evidenciaBucket, "bucket-privado-teste");
          assert.match(data.evidenciaUrl, /producao-evidencias/);
        } },
        itemSolicitacaoProducao: { findMany: async () => [{ id: "item", produtoId: "produto", sku: "SKU" }], update: async () => ({}) },
        produto: { findMany: async () => [{ id: "produto" }] },
        movimentacaoEstoque: { createMany: async () => ({}) },
      });
    },
  } });
  const input = { aplicativoId: "app", solicitacaoId: "pedido", foto: await fotoValida(), itens: [{ id: "item", quantidadeProduzida: 5 }] };
  await t.test("pedido pendente salva link com a confirmação", async () => {
    await confirmarProducaoComEvidencia(input, storage);
    assert.equal(uploads, 1); assert.equal(removidos, 0);
  });
  await t.test("pedido inexistente/concluído não faz upload", async () => {
    pendente = false;
    await assert.rejects(confirmarProducaoComEvidencia(input, storage), /não encontrada/);
    assert.equal(uploads, 1);
    pendente = true;
  });
  await t.test("falha de upload não inicia a confirmação", async () => {
    const antes = confirmarChamadas;
    await assert.rejects(confirmarProducaoComEvidencia(input, { ...storage, enviar: async () => { throw new Error("upload falhou"); } }), /upload falhou/);
    assert.equal(confirmarChamadas, antes);
  });
  await t.test("erro de transação limpa apenas arquivo sem vínculo", async () => {
    falharTransacao = true;
    await assert.rejects(confirmarProducaoComEvidencia(input, storage), /conflito/);
    assert.equal(removidos, 1);
    persistida = true;
    await assert.rejects(confirmarProducaoComEvidencia(input, storage), /conflito/);
    assert.equal(removidos, 1);
  });
  await t.test("bucket sem privacidade não recebe imagem", async () => {
    const antes = uploads;
    await assert.rejects(confirmarProducaoComEvidencia(input, { ...storage, verificarPrivacidade: async () => { throw new Error("bucket público"); } }), /público/);
    assert.equal(uploads, antes);
  });
});
