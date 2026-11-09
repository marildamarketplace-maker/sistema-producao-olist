import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { pedidoFilaMockups } from "../src/lib/fila-mockups";

const individual = `${"a".repeat(64)}-SW5kaXZpZHVhbA`;
const outroIndividual = `${"b".repeat(64)}-SW5kaXZpZHVhbA`;
const layout = `layout-${"c".repeat(64)}-TGF5b3V0`;
const loteId = "616c11cf-8bf3-4897-9f37-6597eef2ef83";
const trabalhos = [
  { mockupId: individual, estampaIds: ["1"] },
  { mockupId: outroIndividual, estampaIds: ["1"] },
  { mockupId: individual, estampaIds: ["2"] },
  { mockupId: layout, estampaIds: ["2", "1"] },
];
const lote = { loteId, estampas: ["1", "2"], trabalhos };

test("aceita relações N para N e preserva a ordem das estampas de um layout", () => {
  assert.deepEqual(pedidoFilaMockups.parse(lote), lote);
});

test("rejeita combinações inválidas, estampas extras e layouts duplicados", () => {
  for (const alterado of [
    { ...lote, trabalhos: [{ mockupId: individual, estampaIds: ["1", "2"] }] },
    { ...lote, trabalhos: [trabalhos[0], trabalhos[0], trabalhos[3]] },
    { ...lote, trabalhos: [trabalhos[3], { mockupId: layout, estampaIds: ["1"] }] },
    { ...lote, trabalhos: [{ mockupId: layout, estampaIds: ["1", "1"] }] },
    { ...lote, trabalhos: [{ mockupId: layout, estampaIds: ["1", "3"] }] },
    { ...lote, trabalhos: [trabalhos[0]] },
    { ...lote, estampas: ["1", "9223372036854775808"] },
    { ...lote, trabalhos: [{ mockupId: `../${layout}`, estampaIds: ["1", "2"] }] },
  ]) {
    assert.equal(pedidoFilaMockups.safeParse(alterado).success, false);
  }
});

test("API verifica autorização e existência antes de salvar e torna a repetição idempotente", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  process.env.GOOGLE_CLOUD_MOCKUPS_BUCKET = "mockups-teste";
  process.env.GOOGLE_CLOUD_CLIENT_EMAIL = "gcs@example.test";
  process.env.GOOGLE_CLOUD_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  let permitido = false;
  let totalAtivas = 2;
  let objetoAusente = false;
  let falharGravacao = false;
  let consultasGoogle = 0;
  let escritas = 0;
  let salvo: { trabalhos: typeof trabalhos } | null = null;
  const chave = { aplicativoId: "tenant-correto", solicitadoPor: "usuario", id: loteId };

  Object.assign(globalThis, { prisma: {
    usuario: {
      findFirst: async () => ({ id: "usuario", aplicativoId: "tenant-antigo" }),
      findUnique: async () => ({ ativo: true, aplicativoId: "tenant-correto", podeEditarEstampas: permitido }),
    },
    estampaCatalogoIa: {
      count: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { id: { in: [BigInt(1), BigInt(2)] }, isActive: true });
        return totalAtivas;
      },
    },
    filaMockup: {
      findUnique: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { aplicativoId_solicitadoPor_id: chave });
        return salvo;
      },
      create: async ({ data }: { data: typeof chave & { trabalhos: typeof trabalhos } }) => {
        if (falharGravacao) throw new Error("detalhes-internos-do-banco");
        assert.deepEqual(data, { ...chave, trabalhos });
        if (salvo) throw new Prisma.PrismaClientKnownRequestError("lote duplicado", { code: "P2002", clientVersion: "teste" });
        escritas++;
        salvo = data;
      },
    },
  } });
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "token-gcs" });
    consultasGoogle++;
    const caminho = decodeURIComponent(url.pathname.split("/o/")[1] ?? "");
    assert.ok([individual, outroIndividual, layout].some((id) => caminho === `mockups/tenant-correto/${id}.webp`));
    return new Response(null, { status: objetoAusente ? 404 : 200 });
  });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({
    data: { user: { id: "usuario", email: "teste@example.test" } }, error: null,
  }));
  const { POST } = await import("../src/app/api/controle-midia/mockups/fila/route");
  const enviar = (dados: unknown = lote, token = true) => POST(new Request("https://example.test", {
    method: "POST",
    headers: token ? { Authorization: "Bearer teste" } : {},
    body: JSON.stringify(dados),
  }));
  assert.equal((await enviar(lote, false)).status, 401);
  assert.equal((await enviar()).status, 403);
  permitido = true;
  assert.equal((await enviar({})).status, 400);
  assert.equal(consultasGoogle, 0);

  totalAtivas = 1;
  assert.equal((await enviar()).status, 422);
  totalAtivas = 2;
  objetoAusente = true;
  assert.equal((await enviar()).status, 422);
  objetoAusente = false;
  falharGravacao = true;
  const falha = await enviar();
  assert.equal(falha.status, 503);
  assert.doesNotMatch(await falha.text(), /detalhes-internos/);
  assert.equal(escritas, 0);

  falharGravacao = false;
  const response = await enviar({ ...lote, aplicativoId: "tenant-forjado" });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { loteId, quantidade: 4 });
  const consultasAntesDoReenvio = consultasGoogle;
  assert.equal((await enviar()).status, 200);
  assert.equal((await enviar({ ...lote, trabalhos: [trabalhos[3]] })).status, 409);
  assert.equal(consultasGoogle, consultasAntesDoReenvio);
  assert.equal(escritas, 1);

  salvo = null;
  const concorrentes = await Promise.all([enviar(), enviar()]);
  assert.deepEqual(concorrentes.map(({ status }) => status).sort(), [200, 201]);
  assert.equal(escritas, 2);
});
