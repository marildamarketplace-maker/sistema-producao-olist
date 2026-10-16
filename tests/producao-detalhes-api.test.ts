import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const app = "00000000-0000-0000-0000-000000000001";
const id = "00000000-0000-0000-0000-000000000002";

test("detalhes e foto da produção validam permissão, aplicativo e não expõem o storage", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-de-teste";
  process.env.GOOGLE_CLOUD_CLIENT_EMAIL = "teste@example.test";
  process.env.GOOGLE_CLOUD_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let permitido = true;
  let somenteLeitura = false;
  let existe = true;
  let temEvidencia = true;
  let caminho = `producao-evidencias/${app}/${id}/foto.jpg`;
  let falharBanco = false;
  let consultas = 0;
  let observacaoAtual: string | null = "Pedido especial";
  let escritas = 0;
  let downloads = 0;
  let tipoImagem = "image/jpeg";
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: app }), findUnique: async () => ({ podeSolicitarProducao: permitido, podeVisualizarProducao: somenteLeitura }) },
    solicitacaoProducao: { updateMany: async ({ where, data }: { where: { id: string; aplicativoId: string; observacaoGeral: string | null }; data: { observacaoGeral: string | null } }) => {
      assert.equal(where.id, id); assert.equal(where.aplicativoId, app);
      assert.deepEqual(Object.keys(data), ["observacaoGeral"]);
      if (!existe || where.observacaoGeral !== observacaoAtual) return { count: 0 };
      observacaoAtual = data.observacaoGeral; escritas++; return { count: 1 };
    }, findFirst: async ({ where }: { where: { id: string; aplicativoId: string } }) => {
      consultas++;
      assert.deepEqual(where, { id, aplicativoId: app });
      if (falharBanco) throw new Error("Mensagem privada do banco");
      if (!existe) return null;
      return {
        id, dataEntrega: new Date("2026-10-16T00:00:00Z"), createdAt: new Date("2026-10-15T23:00:00Z"),
        status: "concluida", observacaoGeral: "Pedido especial", prioridadeProducao: true,
        periodoInicio: null, periodoFim: null,
        evidenciaBucket: temEvidencia ? "bucket-privado" : null, evidenciaStoragePath: temEvidencia ? caminho : null,
        pedidosFornecedor: [{ pedidoOlistId: "12345", fornecedor: { nome: "Fornecedor de teste" } }],
      };
    } },
    itemSolicitacaoProducao: { findMany: async ({ where }: { where: { solicitacaoId: string; aplicativoId: string } }) => {
      assert.deepEqual(where, { solicitacaoId: id, aplicativoId: app });
      return [{ id: "item", produtoId: "00000000-0000-0000-0000-000000000003", sku: "SKU-TESTE", imagemUrl: null, quantidadeSolicitada: 5, quantidadeProduzida: 4, tipoCorte: "LASER", observacao: "Item de teste" }];
    } },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "token-ficticio" });
    assert.ok(url.startsWith("https://storage.googleapis.com/storage/v1/b/bucket-privado/o/"));
    assert.ok(url.endsWith("?alt=media"));
    downloads++;
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": tipoImagem } });
  });
  const { GET, PATCH } = await import("../src/app/api/solicitacoes-producao/[id]/route");
  const { GET: FOTO } = await import("../src/app/api/solicitacoes-producao/[id]/evidencia/route");
  const request = () => new Request("https://example.test", { headers: { Authorization: "Bearer token-ficticio" } });
  const contexto = () => ({ params: Promise.resolve({ id }) });

  await t.test("retorna dados, itens e pedidos sem URLs privadas nem caminhos internos", async () => {
    const response = await GET(request(), contexto());
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
    const { producao } = await response.json();
    assert.equal(producao.dataEntrega, "2026-10-16");
    assert.equal(producao.itens[0].quantidadeProduzida, 4);
    assert.equal(producao.evidenciaDisponivel, true);
    assert.deepEqual(producao.pedidosOlist, [{ id: "12345", fornecedor: "Fornecedor de teste" }]);
    assert.equal(producao.evidenciaBucket, undefined);
    assert.equal(producao.evidenciaStoragePath, undefined);
  });
  await t.test("rejeita ID inválido e sessão ausente antes de consultar produção", async () => {
    const antes = consultas;
    assert.equal((await GET(request(), { params: Promise.resolve({ id: "invalido" }) })).status, 400);
    assert.equal((await GET(new Request("https://example.test"), contexto())).status, 401);
    assert.equal(consultas, antes);
  });
  await t.test("nega dados e foto para usuário sem permissão", async () => {
    permitido = false;
    const antes = consultas;
    assert.equal((await GET(request(), contexto())).status, 403);
    assert.equal((await FOTO(request(), contexto())).status, 403);
    assert.equal(consultas, antes);
    permitido = true;
  });
  await t.test("permissão de leitura não autoriza alterar itens", async () => {
    permitido = false; somenteLeitura = true;
    assert.equal((await GET(request(), contexto())).status, 200);
    const antes = consultas;
    assert.equal((await PATCH(request(), contexto())).status, 403);
    assert.equal(consultas, antes);
    permitido = true; somenteLeitura = false;
  });
  await t.test("edita somente a observação, remove texto vazio e rejeita conflitos e entradas inválidas", async () => {
    const editar = (body: unknown) => PATCH(new Request("https://example.test", { method: "PATCH", headers: { Authorization: "Bearer token-ficticio", "Content-Type": "application/json" }, body: JSON.stringify(body) }), contexto());
    assert.equal((await editar({ observacaoGeral: "  Novo texto\nsegunda linha  ", observacaoAnterior: "Pedido especial" })).status, 200);
    assert.equal(observacaoAtual, "Novo texto\nsegunda linha");
    assert.equal((await editar({ observacaoGeral: "Sobrescrever", observacaoAnterior: "Pedido especial" })).status, 409);
    assert.equal((await editar({ observacaoGeral: "   ", observacaoAnterior: observacaoAtual })).status, 200);
    assert.equal(observacaoAtual, null);
    const antes = escritas;
    for (const body of [{ observacaoGeral: 1, observacaoAnterior: null }, { observacaoGeral: "x" }, { observacaoGeral: "x".repeat(5001), observacaoAnterior: null }, { observacaoGeral: "x", observacaoAnterior: null, itens: [] }]) {
      assert.equal((await editar(body)).status, 400);
    }
    permitido = false; somenteLeitura = true;
    assert.equal((await editar({ observacaoGeral: "x", observacaoAnterior: null })).status, 403);
    permitido = true; somenteLeitura = false;
    existe = false;
    assert.equal((await editar({ observacaoGeral: "x", observacaoAnterior: null })).status, 404);
    existe = true;
    assert.equal(escritas, antes);
  });
  await t.test("pedido de outro aplicativo ou inexistente retorna 404", async () => {
    existe = false;
    assert.equal((await GET(request(), contexto())).status, 404);
    assert.equal((await FOTO(request(), contexto())).status, 404);
    assert.equal(downloads, 0);
    existe = true;
  });
  await t.test("ausência histórica de evidência e caminho de outro pedido não fazem download", async () => {
    temEvidencia = false;
    const { producao } = await (await GET(request(), contexto())).json();
    assert.equal(producao.evidenciaDisponivel, false);
    assert.equal((await FOTO(request(), contexto())).status, 404);
    temEvidencia = true;
    const original = caminho; caminho = `producao-evidencias/outro-aplicativo/${id}/foto.jpg`;
    assert.equal((await FOTO(request(), contexto())).status, 404);
    assert.equal(downloads, 0);
    caminho = original;
  });
  await t.test("entrega JPEG privado com proteção contra cache e content sniffing", async () => {
    const foto = await FOTO(request(), contexto());
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get("Content-Type"), "image/jpeg");
    assert.equal(foto.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(foto.headers.get("Cache-Control")!, /no-store/);
    assert.equal((await foto.arrayBuffer()).byteLength, 4);
    tipoImagem = "text/html";
    assert.equal((await FOTO(request(), contexto())).status, 500);
    tipoImagem = "image/jpeg";
  });
  await t.test("falhas não revelam mensagens privadas do banco", async () => {
    falharBanco = true;
    const response = await GET(request(), contexto());
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /Mensagem privada/);
  });
});
