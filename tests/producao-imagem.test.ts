import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

const app = "00000000-0000-0000-0000-000000000001";
const sol = "00000000-0000-0000-0000-000000000002";
const itemId = "00000000-0000-0000-0000-000000000003";

test("carregamento de imagem respeita empresa, solicitação, token e cache", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = "segredo-ficticio-com-mais-de-32-caracteres";
  let itemExiste = true;
  let solicitacaoExiste = true;
  let habilitado = true;
  let permitido = true;
  let imagem: string | null = null;
  let idOlist: string | null = "123";
  let chamadas = 0;
  let novaImagem = false;
  let escritas = 0;
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: app }), findUnique: async () => ({ podeVisualizarProducao: permitido }) },
    aplicativo: { findUnique: async () => ({ jobs: habilitado ? "CONFIRMACAO_ENTREGA_PRODUCAO" : "", nome: "Teste" }) },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: "token-olist-ficticio", expiresAt: new Date(Date.now() + 3600000) }) },
    solicitacaoProducao: { findFirst: async ({ where }: { where: { id: string; aplicativoId: string } }) => {
      assert.equal(where.id, sol); assert.equal(where.aplicativoId, app);
      return solicitacaoExiste ? { id: sol } : null;
    } },
    itemSolicitacaoProducao: {
      findFirst: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { id: itemId, solicitacaoId: sol, aplicativoId: app });
        return itemExiste ? { id: itemId, produtoId: "produto", sku: "SKU/TESTE", imagemUrl: imagem } : null;
      },
      updateMany: async ({ where, data }: { where: unknown; data: { imagemUrl: string } }) => {
        assert.deepEqual(where, { id: itemId, solicitacaoId: sol, aplicativoId: app, imagemUrl: novaImagem ? "https://example.test/produto.jpg" : null });
        escritas++; imagem = data.imagemUrl; return { count: 1 };
      },
    },
    produto: { findFirst: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { id: "produto", aplicativoId: app, sku: "SKU/TESTE" });
      return { idCadastroOlist: idOlist };
    } },
  } });
  t.mock.method(axios, "get", async (url: string, config: { headers: { Authorization: string } }) => {
    chamadas++;
    assert.equal(config.headers.Authorization, "Bearer token-olist-ficticio");
    assert.equal(url, "https://api.tiny.com.br/public-api/v3/produtos/123/anexos");
    return { status: 200, headers: { "content-type": "application/json" }, data: [{ url: "https://example.test/manual.pdf" }, { url: "https://example.test/produto.jpg" }, ...(novaImagem ? [{ url: "https://example.test/nova.jpg" }] : [])] };
  });
  const { carregarImagemItemProducao, urlImagemProduto } = await import("../src/lib/producao-imagem");
  assert.equal(urlImagemProduto("javascript:alert(1)"), null);
  assert.equal(urlImagemProduto("https://usuario:senha@example.test/a.jpg"), null);
  assert.equal(urlImagemProduto("https://example.test/a.pdf"), null);
  solicitacaoExiste = false;
  await assert.rejects(carregarImagemItemProducao(app, sol, itemId), /Produção não encontrada/);
  solicitacaoExiste = true; itemExiste = false;
  await assert.rejects(carregarImagemItemProducao(app, sol, itemId), /Item não encontrado/);
  assert.equal(chamadas, 0);
  itemExiste = true;
  const respostas = await Promise.all([carregarImagemItemProducao(app, sol, itemId), carregarImagemItemProducao(app, sol, itemId)]);
  assert.deepEqual(respostas, ["https://example.test/produto.jpg", "https://example.test/produto.jpg"]);
  assert.equal(chamadas, 1); assert.equal(escritas, 1);
  await carregarImagemItemProducao(app, sol, itemId);
  assert.equal(chamadas, 1);
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const interno = await import("../src/app/api/solicitacoes-producao/[id]/itens/[itemId]/imagem/route");
  const req = (token?: string) => new Request("https://example.test/imagem", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const contexto = { params: Promise.resolve({ id: sol, itemId }) };
  assert.equal((await interno.POST(req(), contexto)).status, 401);
  permitido = false;
  assert.equal((await interno.POST(req("sessao"), contexto)).status, 403);
  permitido = true;
  assert.equal((await interno.POST(req("sessao"), contexto)).status, 200);
  const publico = await import("../src/app/api/public/confirmacao-entrega-producao/itens/[itemId]/imagem/route");
  const { criarTokenPublicoConfirmacaoProducao } = await import("../src/lib/confirmacao-entrega-producao-publica");
  const token = criarTokenPublicoConfirmacaoProducao({ aplicativoId: app, solicitacaoId: sol });
  const ctx = { params: Promise.resolve({ itemId }) };
  assert.equal((await publico.POST(req(), ctx)).status, 401);
  assert.equal((await publico.POST(req(token + "x"), ctx)).status, 401);
  habilitado = false;
  assert.equal((await publico.POST(req(token), ctx)).status, 401);
  habilitado = true; solicitacaoExiste = false;
  assert.equal((await publico.POST(req(token), ctx)).status, 404);
  solicitacaoExiste = true; itemExiste = false;
  assert.equal((await publico.POST(req(token), ctx)).status, 404);
  itemExiste = true;
  const response = await publico.POST(req(token), ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { imagemUrl: "https://example.test/produto.jpg" });
  assert.equal(chamadas, 1);
  novaImagem = true;
  assert.equal(await carregarImagemItemProducao(app, sol, itemId, "https://example.test/produto.jpg"), "https://example.test/nova.jpg");
  assert.equal(chamadas, 2);
  const invalida = new Request("https://example.test/imagem", { method: "POST", headers: { Authorization: "Bearer sessao", "Content-Type": "application/json" }, body: JSON.stringify({ imagemInvalida: "javascript:alert(1)" }) });
  assert.equal((await interno.POST(invalida, contexto)).status, 400);
});
