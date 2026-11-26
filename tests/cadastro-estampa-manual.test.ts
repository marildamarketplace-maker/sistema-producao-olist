import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

test("cadastro manual valida campos, otimiza, cria catálogo/job e protege duplicidade e falhas", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "teste";
  let existente = false, falha = false, uploads = 0, deletes = 0, jobs = 0;
  const registro = { id: BigInt(123), codigo: "123", variante: "A", previewUrl: "https://storage.googleapis.com/test/image.jpg" };
  let bytesSalvos: Buffer = Buffer.alloc(0);
  const tx = {
    $queryRaw: async () => [],
    estampaCatalogoIa: {
      findFirst: async () => existente ? registro : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        assert.equal(data.processingStatus, "PENDING"); assert.ok(data.contentHash);
        assert.equal(data.codigo, "123");
        if (falha) throw new Error("falha simulada");
        return { id: BigInt(123) };
      },
    },
    estampaJob: { create: async ({ data }: { data: Record<string, unknown> }) => { jobs++; assert.equal(data.manualRequested, true); assert.equal(data.estampaId, BigInt(123)); return { id: "job" }; } },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx) } });
  const deps = {
    db: ({ ...tx, $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof import("../src/lib/prisma").prisma),
    storage: { upload: async ({ buffer }: { buffer: Buffer }) => { uploads++; bytesSalvos = buffer; return { path: "estampas/manual/id.jpg", publicUrl: registro.previewUrl, bucket: "test" }; }, getObjectInfo: async () => ({ exists: true, path: "", publicUrl: "", bucket: "" }), deleteObject: async () => {} },
    remover: async () => { deletes++; },
  };
  const { cadastrarEstampaManual, cadastroEstampaSchema, EstampaDuplicadaError } = await import("../src/services/cadastrarEstampaManualService");
  for (const campos of [{ codigo: "", variante: "A" }, { codigo: "1", variante: " " }, { codigo: "../x", variante: "A" }]) assert.equal(cadastroEstampaSchema.safeParse(campos).success, false);
  const bytes = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "red" } }).png().toBuffer();
  const entrada = { codigo: " 123 ", variante: " A ", bytes, usuarioId: "usuario" };
  assert.deepEqual(await cadastrarEstampaManual(entrada, deps), { estampaId: "123", jobId: "job" });
  const meta = await sharp(bytesSalvos).metadata(); assert.equal(meta.width, 1024); assert.equal(meta.height, 512); assert.equal(meta.format, "jpeg");
  const buscar = tx.estampaCatalogoIa.findFirst;
  let consultas = 0;
  tx.estampaCatalogoIa.findFirst = async () => (++consultas === 2 ? registro : null);
  await assert.rejects(cadastrarEstampaManual(entrada, deps), EstampaDuplicadaError);
  assert.equal(jobs, 1); assert.equal(deletes, 1);
  tx.estampaCatalogoIa.findFirst = buscar;
  existente = true;
  await assert.rejects(cadastrarEstampaManual(entrada, deps), EstampaDuplicadaError); assert.equal(uploads, 2); assert.equal(jobs, 1);
  existente = false; falha = true;
  await assert.rejects(cadastrarEstampaManual(entrada, deps), /falha simulada/); assert.equal(deletes, 2);
  await assert.rejects(cadastrarEstampaManual({ ...entrada, bytes: Buffer.from("invalid") }, deps), /Formato inválido/); assert.equal(uploads, 3);
});
