import assert from "node:assert/strict";
import test from "node:test";

test("estoque vincula somente movimentações de produção existentes no mesmo aplicativo", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-de-teste";
  const data = new Date("2026-10-07T19:18:47Z");
  const base = { produtoId: "produto", sku: "SKU", quantidade: 50, createdAt: data, observacao: "Confirmação" };
  const movimentos = [
    { ...base, id: "confirmacao", origem: "PRODUCAO", tipoMovimento: "entrada", referenciaId: "pedido-app" },
    { ...base, id: "ajuste", origem: "AJUSTE_PRODUCAO", tipoMovimento: "saida", referenciaId: "pedido-app" },
    { ...base, id: "cancelamento", origem: "CANCELAMENTO_PRODUCAO", tipoMovimento: "saida", referenciaId: "pedido-app" },
    { ...base, id: "sem-referencia", origem: "PRODUCAO", tipoMovimento: "entrada", referenciaId: null },
    { ...base, id: "outro-app", origem: "PRODUCAO", tipoMovimento: "entrada", referenciaId: "pedido-outro-app" },
    { ...base, id: "olist", origem: "BAIXA_OLIST", tipoMovimento: "saida", referenciaId: "pedido-app" },
  ];
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: "app" }), findUnique: async () => ({ podeVisualizarEstoque: true }) },
    produto: { findMany: async () => [] },
    movimentacaoEstoque: { findMany: async ({ where }: { where: { aplicativoId: string } }) => { assert.equal(where.aplicativoId, "app"); return movimentos; } },
    configuracaoSistema: { findFirst: async () => null },
    solicitacaoProducao: { findMany: async ({ where }: { where: { aplicativoId: string; id: { in: string[] } } }) => {
      assert.equal(where.aplicativoId, "app"); assert.deepEqual(where.id.in, ["pedido-app", "pedido-outro-app"]);
      return [{ id: "pedido-app", observacaoGeral: "Pedido especial" }];
    } },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET } = await import("../src/app/api/estoque/dados/route");
  const response = await GET(new Request("https://example.test", { headers: { Authorization: "Bearer ficticio" } }));
  assert.equal(response.status, 200);
  const dados = await response.json();
  assert.deepEqual(dados.movimentacoes.map((mov: { id: string; producao_id: string | null }) => [mov.id, mov.producao_id]), [
    ["confirmacao", "pedido-app"], ["ajuste", "pedido-app"], ["cancelamento", "pedido-app"], ["sem-referencia", null], ["outro-app", null], ["olist", null],
  ]);
  assert.equal(dados.movimentacoes[0].observacao, "Confirmação - Pedido especial");
  assert.equal(dados.movimentacoes[1].observacao, "Confirmação");
});
