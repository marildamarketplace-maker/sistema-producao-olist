import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("pedidos de fornecedor exigem relação ativa e vendedor confirmado em cada conta", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let ativo = true, vinculado = true, origem = id(1), permitido = true, vendedorDetalhe = 900;
  let chamadas = 0;
  const propria = { id: id(1), nome: "Cliente" }, filial = { id: id(3), nome: "Filial fornecedor", aplicativoPaiId: id(2) };
  const db = {
    usuario: { findFirst: async () => ({ id: id(10), aplicativoId: id(1), ativo: true }), findUnique: async () => ({ id: id(10), aplicativoId: id(1), ativo: true, podeVisualizarOlistPedidos: permitido }) },
    aplicativo: {
      findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? [propria] : [filial],
      findFirst: async () => null,
      findUnique: async ({ where }: { where: { id: string } }) => where.id === filial.id ? { ...filial, olistClientId: "fake", olistClientSecret: "fake" } : null,
    },
    fornecedor: { findMany: async () => ativo ? [{ id: id(4), aplicativoPai: { id: id(2), nome: "Fornecedor" } }] : [], findFirst: async () => ativo ? { id: id(4) } : null },
    usuarioVendedorOlist: {
      findMany: async () => vinculado ? [{ aplicativoId: filial.id, fornecedorMatrizId: id(2), aplicativo: { aplicativoPaiId: id(2) } }] : [],
      findFirst: async ({ where }: { where: { aplicativoId?: string } }) => vinculado && where.aplicativoId === filial.id ? { vendedorOlistId: 900, revisao: 1, origemAplicativoId: origem, fornecedorMatrizId: id(2) } : null,
    },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: "fake", expiresAt: new Date(Date.now() + 3600000) }) },
  };
  Object.assign(globalThis, { prisma: { ...db, $transaction: async (f: (tx: typeof db) => unknown) => f(db) } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: id(10), email: "teste@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string) => {
    chamadas++; const u = new URL(url);
    if (u.pathname.endsWith("/pedidos/123")) return { status: 200, data: { id: 123, vendedor: { id: vendedorDetalhe } }, headers: {} };
    assert.equal(u.searchParams.get("idVendedor"), "900", "Filtro do servidor prevalece sobre a entrada");
    assert.equal(u.searchParams.get("limit"), "50");
    return { status: 200, data: { itens: [{ id: 123 }], paginacao: { total: 1 } }, headers: {} };
  });
  const empresas = await import("../src/app/api/olist/empresas/route");
  const pedidos = await import("../src/app/api/olist/pedidos/route");
  const detalhe = await import("../src/app/api/olist/pedidos/[id]/route");
  const { resolverEmpresaOlist } = await import("../src/lib/olist-empresa");
  const req = (query: string) => new Request(`https://example.test/api?${query}`, { headers: { authorization: "Bearer fake" } });
  const externa = `aplicativoId=${filial.id}&idVendedor=999`;
  assert.deepEqual((await (await empresas.GET(req(""))).json()).empresas, [propria], "Outras telas não ganham acesso a fornecedor");
  assert.deepEqual((await (await empresas.GET(req("contexto=pedidos"))).json()).empresas, [propria, { id: filial.id, nome: filial.nome }]);
  assert.equal((await pedidos.GET(req(externa))).status, 200);
  assert.equal((await detalhe.GET(req(externa), { params: Promise.resolve({ id: "123" }) })).status, 200);
  vendedorDetalhe = 999;
  assert.equal((await detalhe.GET(req(externa), { params: Promise.resolve({ id: "123" }) })).status, 403, "Detalhe de outro vendedor é bloqueado");
  await assert.rejects(resolverEmpresaOlist(req(externa), propria.id), { status: 403 });
  for (const caso of ["sem-vinculo", "origem-divergente", "fornecedor-inativo"]) {
    vinculado = caso !== "sem-vinculo"; origem = caso === "origem-divergente" ? id(99) : id(1); ativo = caso !== "fornecedor-inativo";
    const antes = chamadas;
    assert.equal((await pedidos.GET(req(externa))).status, 403, caso);
    assert.equal(chamadas, antes, "Não consulta integração sem autorização");
  }
  ativo = true; vinculado = true; permitido = false;
  assert.equal((await empresas.GET(req("contexto=pedidos"))).status, 403);
  assert.equal((await pedidos.GET(req(externa))).status, 403);
});
