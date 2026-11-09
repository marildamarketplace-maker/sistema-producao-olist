import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { GeradorMockupCodex } from "../src/services/gerarMockupCodexService";
import { erroCodexCli } from "../src/services/image-analysis/executarCodexCli";
import type { ReservaMockup } from "../src/repositories/fila-mockups-worker-repository";

const threadId = "616c11cf-8bf3-4897-9f37-6597eef2ef83";
const mockupId = `layout-${"a".repeat(64)}-Vml0cmluZQ`;

async function criarPng(cor: string, size = 2) {
  return sharp({ create: { width: size, height: size, channels: 3, background: cor } }).png().toBuffer();
}

test("invoca ImageGen em ordem, exige artefato único do thread e valida o WebP", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "teste-codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pasta = join(home, "generated_images", threadId);
  await mkdir(pasta, { recursive: true });
  const base = await criarPng("white");
  const a = await criarPng("red");
  const b = await criarPng("blue");
  const final = await criarPng("pink", 1024);
  let cwd = "";
  let artefato: Buffer | null = final;
  const gerador = new GeradorMockupCodex({
    codexHome: home,
    executar: async (opcoes) => {
      cwd = opcoes.cwd;
      const imagens = opcoes.args.flatMap((item, i) => item === "--image" ? [opcoes.args[i + 1]] : []);
      assert.deepEqual(await Promise.all(imagens.map((path) => readFile(path))), [base, b, a]);
      assert.ok(opcoes.args.includes("read-only"));
      assert.ok(opcoes.args.includes("image_generation"));
      assert.match(opcoes.stdin ?? "", /ordem de leitura/);
      assert.match(opcoes.stdin ?? "", /quadrada \(1:1\)/);
      if (artefato) await writeFile(join(pasta, "resultado.png"), artefato);
      return {
        stdout: [ { type: "thread.started", thread_id: threadId }, { type: "turn.completed" } ].map((evento) => JSON.stringify(evento)).join("\n"),
        stderr: "",
      };
    },
  });
  const saida = await gerador.gerar(base, [b, a], true);
  const meta = await sharp(saida.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.equal(saida.threadId, threadId);
  assert.ok(saida.buffer.length < 2_000_000);
  await assert.rejects(readFile(join(cwd, "modelo.png")), { code: "ENOENT" });
  artefato = await sharp({
    create: { width: 1024, height: 1200, channels: 3, background: "white" },
  }).png().toBuffer();
  await assert.rejects(gerador.gerar(base, [b, a], true), /quadrado/);
  await writeFile(join(pasta, "extra.png"), final);
  artefato = null;
  await assert.rejects(gerador.gerar(base, [b, a], true), /exatamente uma imagem/);
  await assert.rejects(gerador.gerar(base, [a, a, a, a, a], true), /Quantidade de estampas/);
});

test("worker preserva ordem, registra somente a reserva vigente e reutiliza upload após interrupção", async (t) => {
  process.env.GOOGLE_CLOUD_CLIENT_EMAIL = "gcs@example.test";
  process.env.GOOGLE_CLOUD_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.ESTAMPA_PREVIEW_ALLOWED_HOSTS = "storage.googleapis.com";
  const a = await criarPng("red");
  const b = await criarPng("blue");
  const modelo = await sharp(a).webp().toBuffer();

  const reserva: ReservaMockup = {
    id: "lote", aplicativoId: "aplicativo", solicitadoPor: "usuario", reservaId: "reserva",
    proximaSaida: 0, tentativas: 1, resultados: [],
    trabalhos: [{ mockupId, estampaIds: ["2", "1"] }],
  };
  const path = "mockups-gerados/aplicativo/usuario/lote/1.webp";
  let existe = false;
  let perdeuReserva = false;
  let semTrabalho = false;
  let uploads = 0;
  let chamadasGerador = 0;
  let falha: Error | null = null;
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  Object.assign(globalThis, { prisma: {
    $queryRaw: async (sql: TemplateStringsArray, aplicativo: string) => {
      assert.equal(aplicativo, "aplicativo");
      assert.match(sql.join(""), /FOR UPDATE SKIP LOCKED/);
      return semTrabalho ? [] : [reserva];
    },
    estampaCatalogoIa: { findMany: async () => [
      { id: BigInt(1), previewUrl: "https://storage.googleapis.com/teste/1.png" },
      { id: BigInt(2), previewUrl: "https://storage.googleapis.com/teste/2.png" },
    ] },
    filaMockup: { updateMany: async (args: typeof updates[number]) => {
      updates.push(args);
      assert.equal(args.where.reservaId, "reserva");
      assert.equal(args.where.proximaSaida, 0);
      assert.equal(args.where.aplicativoId, "aplicativo");
      return { count: perdeuReserva ? 0 : 1 };
    } },
  } });
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "token" });
    if (url.pathname.startsWith("/teste/")) {
      return new Response(new Uint8Array(url.pathname.endsWith("/1.png") ? a : b), { headers: { "Content-Type": "image/png" } });
    }
    if (url.searchParams.get("fields") === "iamConfiguration") {
      return Response.json({ iamConfiguration: { publicAccessPrevention: "enforced" } });
    }
    if (url.searchParams.get("alt") === "media") {
      assert.equal(decodeURIComponent(url.pathname.split("/o/")[1]), `mockups/aplicativo/${mockupId}.webp`);
      return new Response(new Uint8Array(modelo), { headers: { "Content-Type": "image/webp" } });
    }
    if (init?.method === "POST") {
      uploads++;
      assert.equal(url.searchParams.get("ifGenerationMatch"), "0");
      assert.equal(url.searchParams.get("name"), path);
      return Response.json({});
    }
    assert.equal(decodeURIComponent(url.pathname.split("/o/")[1]), path);
    return new Response(null, { status: existe ? 200 : 404 });
  });

  const { processarProximaSaidaMockup } = await import("../src/services/processarFilaMockupsService");
  const processar = () => processarProximaSaidaMockup({
    aplicativoId: "aplicativo", bucket: "privado", gerador: {
      gerar: async (base, estampas, layout) => {
        chamadasGerador++;
        assert.deepEqual([base, estampas, layout], [modelo, [b, a], true]);
        if (falha) throw falha;
        return { buffer: modelo, width: 1024, height: 1024, threadId };
      },
    },
  });

  assert.equal((await processar())?.status, "COMPLETED");
  assert.equal(updates.at(-1)?.data.status, "COMPLETED");
  assert.deepEqual(updates.at(-1)?.data.resultados, [{
    status: "COMPLETED", bucket: "privado", path, width: 1024, height: 1024, bytes: modelo.length, threadId,
  }]);

  existe = true;
  perdeuReserva = true;
  assert.equal((await processar())?.status, "RESERVA_EXPIRADA");
  assert.equal(uploads, 1);
  assert.equal(chamadasGerador, 1);

  existe = false;
  perdeuReserva = false;
  falha = erroCodexCli("RATE_LIMIT", "segredo omitido", true);
  assert.equal((await processar())?.status, "RETRY");
  assert.equal(updates.at(-1)?.data.status, "PENDING");
  assert.equal(updates.at(-1)?.data.proximaSaida, undefined);
  reserva.tentativas = 3;
  assert.equal((await processar())?.status, "FAILED");
  assert.deepEqual(updates.at(-1)?.data.resultados, [{ status: "FAILED", erro: "RATE_LIMIT" }]);

  falha = erroCodexCli("AUTHENTICATION_ERROR", "login expirado");
  await assert.rejects(processar(), /login expirado/);
  assert.deepEqual(updates.at(-1)?.data.tentativas, { decrement: 1 });
  semTrabalho = true;
  assert.equal(await processar(), null);
});
