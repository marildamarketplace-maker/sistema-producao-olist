import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticio";
const app = "00000000-0000-4000-8000-000000000001";
const produtoId = "00000000-0000-4000-8000-000000000002";
let permitido = true;
let existe = true;
let total = 101;
let historicos = 0;
let referencias = 0;
const db = {
  usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: app }), findUnique: async () => ({ podeVisualizarEstoque: permitido }) },
  produto: {
    findMany: async () => [{ id: produtoId, sku: "SKU", metaEstoque: 5, produtoFornecedorOlist: null }],
    findFirst: async ({ where }: { where: { aplicativoId: string } }) => { assert.equal(where.aplicativoId, app); return existe ? { id: produtoId } : null; },
  },
  movimentacaoEstoque: {
    groupBy: async ({ where }: { where: { aplicativoId: string } }) => {
      assert.equal(where.aplicativoId, app);
      return [{ produtoId, tipoMovimento: "entrada", _sum: { quantidade: 10 }, _count: { _all: 2 } },
        { produtoId, tipoMovimento: "saida", _sum: { quantidade: 14 }, _count: { _all: 3 } }];
    },
    count: async () => total,
    findMany: async ({ where, orderBy, skip, take }: { where: { aplicativoId: string; produtoId: string }; orderBy: unknown; skip: number; take: number }) => {
      historicos++;
      assert.deepEqual(where, { aplicativoId: app, produtoId });
      assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
      assert.equal(take, 50);
      return Array.from({ length: Math.max(0, Math.min(take, total - skip)) }, (_, i) => ({
        id: String(skip + i), produtoId, sku: "SKU", tipoMovimento: "entrada", quantidade: 1,
        origem: "manual", observacao: null, referenciaId: null, createdAt: new Date(0),
      }));
    },
  },
  configuracaoSistema: { findFirst: async () => ({ valor: 7 }) },
  solicitacaoProducao: { findMany: async () => { referencias++; return []; } },
};
Object.assign(globalThis, { prisma: { ...db, $transaction: async (fn: (tx: typeof db) => unknown, opts: unknown) => {
  assert.deepEqual(opts, { isolationLevel: "RepeatableRead" }); return fn(db);
} } });
const request = (query: string, token = true) => new Request(`https://example.test/api/estoque/movimentacoes?${query}`, {
  headers: token ? { Authorization: "Bearer ficticio" } : {},
});

test("resumo agrega entradas e saídas sem carregar histórico ou observações", async t => {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET } = await import("../src/app/api/estoque/dados/route");
  const res = await GET(request("modo=resumo"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.resumo, [{ produto_id: produtoId, entradas: 10, saidas: 14, movimentacoes: 5 }]);
  assert.equal(json.metaGeral, 7);
  assert.equal("movimentacoes" in json, false);
  assert.equal(historicos, 0); assert.equal(referencias, 0);
});

test("histórico pagina com snapshot, ordenação estável e isolamento", async t => {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET } = await import("../src/app/api/estoque/movimentacoes/route");
  for (const [pagina, quantidade] of [[1, 50], [2, 50], [3, 1], [4, 0]]) {
    const res = await GET(request(`produtoId=${produtoId}&pagina=${pagina}`));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.itens.length, quantidade); assert.equal(json.pagina, pagina);
    assert.equal(json.total, 101); assert.equal(json.totalPaginas, 3);
    if (quantidade) assert.equal(json.itens[0].id, String((pagina - 1) * 50));
  }
  total = 0;
  const vazio = await (await GET(request(`produtoId=${produtoId}`))).json();
  assert.deepEqual(vazio, { itens: [], pagina: 1, total: 0, totalPaginas: 1 });
  for (const pagina of ["0", "-1", "1.5", "Infinity", "1000001", ""]) {
    assert.equal((await GET(request(`produtoId=${produtoId}&pagina=${pagina}`))).status, 400);
  }
  assert.equal((await GET(request("produtoId=invalid"))).status, 400);
  existe = false;
  assert.equal((await GET(request(`produtoId=${produtoId}`))).status, 404);
  permitido = false;
  assert.equal((await GET(request(`produtoId=${produtoId}`))).status, 403);
  assert.equal((await GET(request(`produtoId=${produtoId}`, false))).status, 401);
});
