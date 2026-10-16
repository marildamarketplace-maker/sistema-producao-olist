import assert from "node:assert/strict";
import test from "node:test";

const app = "00000000-0000-0000-0000-000000000001";
const destino = "00000000-0000-0000-0000-000000000002";
const solicitacaoId = "00000000-0000-0000-0000-000000000003";
const fornecedorId = "00000000-0000-0000-0000-000000000004";

test("API da fila autoriza, isola aplicativos e registra snapshot sem chamar Olist", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true;
  let existe = true;
  let fornecedorValido = true;
  let associado = true;
  let erroBanco = "";
  let gravacoes = 0;
  let consultas = 0;
  const tx = {
    $queryRaw: async () => [],
    solicitacaoProducao: { findFirst: async ({ where }: { where: unknown }) => {
      consultas++;
      assert.deepEqual(where, { id: solicitacaoId, aplicativoId: app, status: "em_producao" });
      return existe ? { observacaoGeral: "Observação" } : null;
    } },
    fornecedor: {
      findMany: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { aplicativoId: app, vendedor: { ativo: true } });
        return [{ id: fornecedorId, nome: "Fornecedor" }];
      },
      findFirst: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { id: fornecedorId, aplicativoId: app });
        return fornecedorValido ? { vendedor: { ativo: true, aplicativoId: destino } } : null;
      },
    },
    itemSolicitacaoProducao: { findMany: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { solicitacaoId, aplicativoId: app });
      return [{ produtoId: "produto", sku: "EST/6861-A/", quantidadeSolicitada: 2, tipoCorte: "LASER" }];
    } },
    produtoOlistProdutoFornecedor: { findMany: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { produtoId: { in: ["produto"] }, produtoFornecedor: { fornecedorId, aplicativoId: app } });
      return associado ? [{ produtoId: "produto", quantidadeUsada: 1.5, produtoFornecedor: { id: "tecido", nome: "Oxford", referencia: null } }] : [];
    } },
    pedidoFornecedorQueue: { create: async ({ data }: { data: Record<string, unknown> }) => {
      if (erroBanco) throw { code: erroBanco, message: "segredo do banco" };
      gravacoes++;
      assert.equal(data.aplicativoSolicitanteId, app);
      assert.equal(data.aplicativoFornecedorId, destino);
      assert.equal(data.fornecedorId, fornecedorId);
      assert.equal(data.solicitacaoProducaoId, solicitacaoId);
      const dados = data.dadosPedido as { itens: Array<{ quantidadeTecido: number; corteLaser: boolean }>; observacao: string };
      assert.equal(dados.itens[0].quantidadeTecido, 3);
      assert.equal(dados.itens[0].corteLaser, true);
      assert.equal(dados.observacao, "Observação");
      return { id: "fila" };
    } },
  };
  Object.assign(globalThis, { prisma: { ...tx,
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: app }), findUnique: async () => ({ podeSolicitarProducao: permitido, aplicativoId: app }) },
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET, POST } = await import("../src/app/api/fornecedores/fila/route");
  const request = (body: unknown = { fornecedorId, solicitacaoId, aplicativoFornecedorId: app, dadosPedido: {} }) => new Request("https://example.test", { method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify(body) });
  await t.test("lista apenas fornecedores do aplicativo", async () => {
    const response = await GET(request()); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).fornecedores, [{ id: fornecedorId, nome: "Fornecedor" }]);
  });
  await t.test("ignora dados e aplicativo de destino enviados pelo cliente", async () => {
    assert.equal((await POST(request())).status, 201); assert.equal(gravacoes, 1);
  });
  await t.test("nega sessão ausente, falta de permissão e IDs inválidos antes de consultar produção", async () => {
    const antes = consultas;
    assert.equal((await POST(new Request("https://example.test", { method: "POST" }))).status, 401);
    permitido = false; assert.equal((await POST(request())).status, 403); permitido = true;
    assert.equal((await POST(request({ fornecedorId: "inválido", solicitacaoId }))).status, 400);
    assert.equal(consultas, antes);
  });
  await t.test("nega outra produção, fornecedor inválido e tecido sem vínculo", async () => {
    existe = false; assert.equal((await POST(request())).status, 404); existe = true;
    fornecedorValido = false; assert.equal((await POST(request())).status, 400); fornecedorValido = true;
    associado = false; assert.equal((await POST(request())).status, 400); associado = true;
    assert.equal(gravacoes, 1);
  });
  await t.test("duplicação retorna conflito e falhas internas não expõem detalhes", async () => {
    erroBanco = "P2002"; assert.equal((await POST(request())).status, 409);
    erroBanco = "P1001"; const response = await POST(request()); assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /segredo/);
  });
});
