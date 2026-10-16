import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import sharp from "sharp";
import { limparTentativasSenha } from "../src/lib/confirmacao-producao-tentativas";

test("API interna exige permissão e as mesmas senhas do link público antes de movimentar estoque", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-para-teste-local";
  process.env.GOOGLE_CLOUD_STORAGE_EVIDENCIAS_BUCKET = "evidencias-teste";
  process.env.GOOGLE_CLOUD_CLIENT_EMAIL = "teste@example.test";
  process.env.GOOGLE_CLOUD_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let uploads = 0;
  let privado = true;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "token-ficticio" });
    if (url.includes("?fields=iamConfiguration")) return Response.json({ iamConfiguration: { publicAccessPrevention: privado ? "enforced" : "inherited" } });
    if (url.includes("uploadType=media")) { uploads++; return Response.json({}); }
    throw new Error("Acesso externo inesperado no teste");
  });
  const imagem = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).jpeg().toBuffer();
  let permitido = true;
  let entradas = 0;
  Object.assign(globalThis, { prisma: {
    solicitacaoProducao: { findFirst: async () => ({ id: "solicitacao-teste" }) },
    usuario: {
      findFirst: async () => ({ id: "usuario-teste", aplicativoId: "app-teste" }),
      findUnique: async () => ({ podeConfirmarProducao: permitido }),
    },
    $transaction: async (executar: (tx: unknown) => Promise<void>) => executar({
      solicitacaoProducao: {
        findFirst: async () => ({ id: "solicitacao-teste" }),
        update: async ({ data }: { data: { evidenciaUrl: string; evidenciaBucket: string; evidenciaStoragePath: string } }) => {
          assert.match(data.evidenciaUrl, /^https:\/\/storage.googleapis.com\/evidencias-teste\/producao-evidencias\//);
          assert.equal(data.evidenciaBucket, "evidencias-teste");
          assert.ok(data.evidenciaStoragePath.endsWith(".jpg"));
        },
      },
      itemSolicitacaoProducao: {
        findMany: async () => [{ id: "item-teste", produtoId: "produto-teste", sku: "SKU" }],
        update: async () => ({}),
      },
      produto: { findMany: async () => [{ id: "produto-teste" }] },
      movimentacaoEstoque: { createMany: async () => { entradas++; } },
    }),
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario-teste", email: "teste@example.test" } }, error: null }));
  const { POST } = await import("../src/app/api/solicitacoes-producao/confirmar/route");
  const chamar = (senha?: string, foto = true) => {
    const form = new FormData();
    if (senha) form.set("senha", senha);
    form.set("solicitacaoId", "solicitacao-teste");
    form.set("itens", JSON.stringify([{ id: "item-teste", quantidadeProduzida: 5 }]));
    if (foto) form.set("foto", new File([new Uint8Array(imagem)], "foto.jpg", { type: "image/jpeg" }));
    return POST(new Request("https://example.test/api/solicitacoes-producao/confirmar", {
      method: "POST", headers: { Authorization: "Bearer token-ficticio" }, body: form,
    }));
  };
  const chave = "interno:app-teste:usuario-teste";
  limparTentativasSenha(chave);
  try {
    permitido = false;
    assert.equal((await chamar("marilda")).status, 403);
    permitido = true;
    assert.equal((await chamar("marilda", false)).status, 400);
    assert.equal((await chamar()).status, 401);
    assert.equal((await chamar("invalida")).status, 401);
    assert.equal(entradas, 0);
    assert.equal(uploads, 0);
    privado = false;
    assert.equal((await chamar("marilda")).status, 400);
    assert.equal(uploads, 0);
    privado = true;
    for (const senha of ["marilda", "marcotulio"]) {
      assert.equal((await chamar(senha)).status, 200);
    }
    assert.equal(entradas, 2);
    assert.equal(uploads, 2);
    for (let i = 0; i < 5; i++) assert.equal((await chamar("invalida")).status, 401);
    assert.equal((await chamar("marilda")).status, 429);
    assert.equal(entradas, 2);
    assert.equal(uploads, 2);
  } finally {
    limparTentativasSenha(chave);
  }
});
