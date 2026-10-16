import assert from "node:assert/strict";
import test from "node:test";

test("cancelamento estorna o saldo líquido da produção após correções de itens", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-de-teste";
  let movimentos = [
    { produtoId: "produto", sku: "SKU", tipoMovimento: "entrada", quantidade: 50, origem: "PRODUCAO" },
    { produtoId: "produto", sku: "SKU", tipoMovimento: "saida", quantidade: 10, origem: "AJUSTE_PRODUCAO" },
  ];
  let estornos: typeof movimentos = [];
  let status = "concluida";
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: "app" }), findUnique: async () => ({ podeSolicitarProducao: true }) },
    $transaction: async (executar: (tx: unknown) => Promise<unknown>, opcoes: { isolationLevel: string }) => {
      assert.equal(opcoes.isolationLevel, "Serializable");
      return executar({
        solicitacaoProducao: { findFirst: async () => ({ id: "pedido", status }), updateMany: async () => { status = "cancelada"; return { count: 1 }; } },
        itemSolicitacaoProducao: { updateMany: async () => ({}) },
        movimentacaoEstoque: {
          findMany: async ({ where }: { where: { aplicativoId: string; referenciaId: string; origem: { in: string[] } } }) => {
            assert.equal(where.aplicativoId, "app"); assert.equal(where.referenciaId, "pedido");
            assert.ok(where.origem.in.includes("AJUSTE_PRODUCAO")); return movimentos;
          },
          createMany: async ({ data }: { data: typeof movimentos }) => { estornos = data; },
        },
      });
    },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { POST } = await import("../src/app/api/solicitacoes-producao/cancelar/route");
  const cancelar = () => POST(new Request("https://example.test", { method: "POST", headers: { Authorization: "Bearer ficticio", "Content-Type": "application/json" }, body: JSON.stringify({ solicitacaoId: "pedido" }) }));
  let response = await cancelar();
  assert.equal(response.status, 200); assert.equal((await response.json()).quantidadeEstornada, 40);
  assert.equal(estornos[0].quantidade, 40); assert.equal(estornos[0].tipoMovimento, "saida");
  assert.equal(estornos[0].origem, "CANCELAMENTO_PRODUCAO");
  status = "concluida";
  movimentos = [...movimentos, { produtoId: "produto", sku: "SKU", tipoMovimento: "entrada", quantidade: 5, origem: "AJUSTE_PRODUCAO" }];
  response = await cancelar();
  assert.equal((await response.json()).quantidadeEstornada, 45); assert.equal(estornos[0].quantidade, 45);
  status = "em_producao"; estornos = [];
  response = await cancelar(); assert.equal((await response.json()).quantidadeEstornada, 0); assert.equal(estornos.length, 0);
});
