import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticio";
let aplicativoId: string | null = "app";
let permitido = true;
let falhar = false;
let leituras = 0;
const movimentos = [
  { produtoId: "a", tipoMovimento: "entrada", quantidade: 10 },
  { produtoId: "a", tipoMovimento: "entrada", quantidade: 2 },
  { produtoId: "a", tipoMovimento: "saida", quantidade: 4 },
  { produtoId: "b", tipoMovimento: "saida", quantidade: 3 },
  { produtoId: "c", tipoMovimento: "entrada", quantidade: 8 },
];
const produtos = ["a", "b", "c", "d"].map(id => ({ id, sku: id.toUpperCase(), ativo: true, imagemUrl: null, temFoto: false, temVideo: true }));
const escopo = (where: { aplicativoId: string }) => { assert.equal(where.aplicativoId, "app"); leituras++; };
Object.assign(globalThis, { prisma: {
  usuario: { findFirst: async () => ({ id: "usuario", aplicativoId }), findUnique: async () => ({ podeVisualizarCategoriasMidia: permitido }) },
  produto: { findMany: async ({ where }: { where: { aplicativoId: string } }) => { escopo(where); return produtos; } },
  movimentacaoEstoque: {
    findMany: async () => { assert.fail("não deve carregar histórico individual"); },
    groupBy: async (args: unknown) => {
      assert.deepEqual(args, { by: ["produtoId", "tipoMovimento"], where: { aplicativoId: "app" }, _sum: { quantidade: true } });
      leituras++;
      if (falhar) throw new Error("credencial e SQL privados");
      const grupos = new Map<string, { produtoId: string; tipoMovimento: string; _sum: { quantidade: number | null } }>();
      for (const mov of movimentos) {
        const key = `${mov.produtoId}:${mov.tipoMovimento}`;
        const grupo = grupos.get(key) ?? { produtoId: mov.produtoId, tipoMovimento: mov.tipoMovimento, _sum: { quantidade: 0 } };
        grupo._sum.quantidade = (grupo._sum.quantidade ?? 0) + mov.quantidade;
        grupos.set(key, grupo);
      }
      return [...grupos.values(), { produtoId: "d", tipoMovimento: "entrada", _sum: { quantidade: null } }];
    },
  },
  solicitacaoProducao: { findMany: async ({ where }: { where: { aplicativoId: string; status: string } }) => { escopo(where); assert.equal(where.status, "em_producao"); return [{ id: "solicitacao" }]; } },
  itemSolicitacaoProducao: { groupBy: async ({ where }: { where: { aplicativoId: string; solicitacaoId: { in: string[] } } }) => {
    escopo(where); assert.deepEqual(where.solicitacaoId.in, ["solicitacao"]);
    return [{ produtoId: "c", _sum: { quantidadeSolicitada: 2 } }, { produtoId: "b", _sum: { quantidadeSolicitada: 1 } }];
  } },
} });
const request = (method = "GET") => new Request("https://example.test/api/controle-midia/produtos", {
  method, headers: { Authorization: "Bearer ficticio", "Content-Type": "application/json" },
  ...(method === "PATCH" ? { body: JSON.stringify({ id: "a", campo: "temFoto", valor: true }) } : {}),
});

test("agregação preserva saldos, prioridades, contrato e isolamento", async t => {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET, PATCH } = await import("../src/app/api/controle-midia/produtos/route");
  const res = await GET(request());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.produtos.map((p: { id: string }) => p.id), ["c", "a", "b", "d"]);
  for (const produto of json.produtos) {
    const saldoAnterior = movimentos.filter(m => m.produtoId === produto.id).reduce((saldo, m) => saldo + (m.tipoMovimento === "entrada" ? m.quantidade : -m.quantidade), 0);
    assert.equal(produto.estoqueAtual, saldoAnterior);
    assert.deepEqual(Object.keys(produto).sort(), ["id", "sku", "ativo", "fotoUrl", "temFoto", "temVideo", "estoqueAtual", "quantidadeSolicitada"].sort());
  }
  let antes = leituras;
  permitido = false;
  assert.equal((await GET(request())).status, 403);
  assert.equal(leituras, antes);
  permitido = true; aplicativoId = null;
  assert.equal((await GET(request())).status, 403);
  assert.equal((await PATCH(request("PATCH"))).status, 403);
  assert.equal(leituras, antes);
  aplicativoId = "app"; falhar = true;
  const erro = await GET(request());
  assert.equal(erro.status, 500);
  assert.deepEqual(await erro.json(), { error: "Erro ao consultar mídias dos produtos." });
});
