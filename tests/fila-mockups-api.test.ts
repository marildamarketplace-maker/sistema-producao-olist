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
const observacao = "Oxford 100% poliéster, fosco.\nCaimento estruturado.";
const lote = { loteId, estampas: ["1", "2"], trabalhos, observacao };

test("aceita relações N para N e preserva a ordem das estampas de um layout", () => {
  assert.deepEqual(pedidoFilaMockups.parse(lote), lote);
  assert.equal(pedidoFilaMockups.parse({ ...lote, observacao: `  ${observacao}  ` }).observacao, observacao);
  assert.equal(pedidoFilaMockups.parse({ ...lote, observacao: undefined }).observacao, undefined);
});

test("rejeita combinações inválidas, estampas extras e layouts duplicados", () => {
  for (const alterado of [
    { ...lote, trabalhos: [{ mockupId: individual, estampaIds: ["1", "2"] }] },
    { ...lote, trabalhos: [trabalhos[0], trabalhos[0], trabalhos[3]] },
    { ...lote, trabalhos: [trabalhos[3], { mockupId: layout, estampaIds: ["1"] }] },
    { ...lote, trabalhos: [{ mockupId: layout, estampaIds: ["1", "1"] }] },
    { ...lote, trabalhos: [{ mockupId: layout, estampaIds: ["1", "3"] }] },
    { ...lote, trabalhos: [trabalhos[0]] },
    { ...lote, observacao: "a".repeat(1501) },
    { ...lote, observacao: "Oxford\u0000fosco" },
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
  let usuarioId = "usuario";
  const caminhoGerado = `mockups-gerados/tenant-correto/usuario/${loteId}/1.webp`;
  let caminhoSalvo = caminhoGerado;
  let totalAtivas = 2;
  let objetoAusente = false;
  let falharGravacao = false;
  let consultasGoogle = 0;
  let escritas = 0;
  let salvo: { trabalhos: typeof trabalhos; observacao: string } | null = null;
  let statusOriginal = "PROCESSING";
  const recriados = new Map<string, { trabalhos: typeof trabalhos; observacao: string }>();
  const chave = { aplicativoId: "tenant-correto", solicitadoPor: "usuario", id: loteId };

  Object.assign(globalThis, { prisma: {
    usuario: {
      findFirst: async () => ({ id: usuarioId, aplicativoId: "tenant-antigo" }),
      findUnique: async () => ({ ativo: true, aplicativoId: "tenant-correto", podeEditarEstampas: true, podeCriarMockups: permitido }),
    },
    estampaCatalogoIa: {
      findMany: async () => [
        { id: BigInt(1), codigo: "MV1", variante: "A" },
        { id: BigInt(2), codigo: "MV2", variante: null },
      ],
      count: async ({ where }: { where: { id: { in: bigint[] }; isActive: boolean } }) => {
        assert.equal(where.isActive, true);
        assert.ok(where.id.in.every((id) => [BigInt(1), BigInt(2)].includes(id)));
        return Math.min(totalAtivas, where.id.in.length);
      },
    },
    filaMockup: {
      findUnique: async ({ where, select }: {
        where: { aplicativoId_solicitadoPor_id: typeof chave }; select: { resultados?: boolean };
      }) => {
        if (where.aplicativoId_solicitadoPor_id.solicitadoPor !== chave.solicitadoPor) return null;
        if (where.aplicativoId_solicitadoPor_id.id !== chave.id) return recriados.get(where.aplicativoId_solicitadoPor_id.id) ?? null;
        assert.deepEqual(where, { aplicativoId_solicitadoPor_id: chave });
        if (select.resultados && salvo) return {
          ...salvo, status: statusOriginal,
          resultados: [{ status: "COMPLETED", path: caminhoSalvo, bucket: "mockups-teste" }],
        };
        return salvo;
      },
      create: async ({ data }: { data: typeof chave & { trabalhos: typeof trabalhos; observacao: string } }) => {
        if (falharGravacao) throw new Error("detalhes-internos-do-banco");
        if (data.id !== chave.id) {
          assert.equal(data.aplicativoId, chave.aplicativoId);
          assert.equal(data.solicitadoPor, chave.solicitadoPor);
          recriados.set(data.id, data);
          return;
        }
        assert.deepEqual(data, { ...chave, trabalhos, observacao });
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
    if (url.searchParams.get("alt") === "media") {
      assert.equal(caminho, caminhoGerado);
      return new Response("webp", { headers: { "Content-Type": "image/webp" } });
    }
    assert.ok([individual, outroIndividual, layout].some((id) => caminho === `mockups/tenant-correto/${id}.webp`));
    return new Response(null, { status: objetoAusente ? 404 : 200 });
  });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({
    data: { user: { id: "usuario", email: "teste@example.test" } }, error: null,
  }));
  const { GET, POST } = await import("../src/app/api/controle-midia/mockups/fila/route");
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
  assert.equal((await enviar({ ...lote, observacao: "Cetim acetinado" })).status, 409);
  assert.equal(consultasGoogle, consultasAntesDoReenvio);
  assert.equal(escritas, 1);

  salvo = null;
  const concorrentes = await Promise.all([enviar(), enviar()]);
  assert.deepEqual(concorrentes.map(({ status }) => status).sort(), [200, 201]);
  assert.equal(escritas, 2);
  const consultar = (query = "", token = true) => GET(new Request(
    `https://example.test/api/controle-midia/mockups/fila?loteId=${loteId}${query}`,
    { headers: token ? { Authorization: "Bearer teste" } : {} },
  ));
  assert.equal((await consultar("", false)).status, 401);
  permitido = false;
  assert.equal((await consultar()).status, 403);
  permitido = true;
  const progresso = await consultar();
  assert.equal(progresso.headers.get("cache-control"), "private, no-store");
  const dados = await progresso.json();
  assert.equal(dados.status, "PROCESSING");
  assert.deepEqual(dados.saidas[0], { numero: 1, nome: "Individual", estampas: ["MV1-A"], status: "COMPLETED" });
  assert.deepEqual(dados.saidas[3].estampas, ["MV2", "MV1-A"]);
  assert.doesNotMatch(JSON.stringify(dados), /mockups-gerados|mockups-teste/);
  assert.equal((await consultar("&saida=2")).status, 404);
  assert.equal((await consultar("&saida=../1")).status, 400);
  usuarioId = "outro-usuario";
  assert.equal((await consultar("&saida=1")).status, 404);
  usuarioId = "usuario";
  caminhoSalvo = caminhoGerado.replace("tenant-correto", "outro-tenant");
  assert.equal((await consultar("&saida=1")).status, 404);
  caminhoSalvo = caminhoGerado;
  const imagem = await consultar("&saida=1");
  assert.equal(imagem.headers.get("content-type"), "image/webp");
  assert.equal(await imagem.text(), "webp");

  const idIndividual = "616c11cf-8bf3-4897-9f37-6597eef2ef84";
  const idCompleto = "616c11cf-8bf3-4897-9f37-6597eef2ef85";
  const recriar = { loteId: idIndividual, origemLoteId: loteId };
  assert.equal((await enviar({ ...recriar, loteId })).status, 400);
  assert.equal((await enviar({ ...recriar, saida: 99 })).status, 404);
  assert.equal((await enviar({ ...recriar, saida: 2 })).status, 409);
  assert.equal((await enviar(recriar)).status, 409);
  usuarioId = "outro-usuario";
  assert.equal((await enviar({ ...recriar, saida: 1 })).status, 404);
  usuarioId = "usuario";
  const individualRecriado = await enviar({ ...recriar, saida: 1 });
  assert.equal(individualRecriado.status, 201);
  assert.deepEqual(await individualRecriado.json(), { loteId: idIndividual, quantidade: 1 });
  assert.deepEqual(recriados.get(idIndividual)?.trabalhos, [trabalhos[0]]);
  assert.equal(recriados.get(idIndividual)?.observacao, observacao);
  assert.equal((await enviar({ ...recriar, saida: 1 })).status, 200);
  statusOriginal = "FAILED";
  const loteRecriado = await enviar({ ...recriar, loteId: idCompleto });
  assert.equal(loteRecriado.status, 201);
  assert.deepEqual(await loteRecriado.json(), { loteId: idCompleto, quantidade: 4 });
  assert.deepEqual(recriados.get(idCompleto)?.trabalhos, trabalhos);
  assert.equal(escritas, 2);

});
