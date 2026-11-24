import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

const app = "00000000-0000-0000-0000-000000000002";
const usuarioId = "00000000-0000-0000-0000-000000000010";

test("Olist: permissões no servidor, vendedor por empresa e autorização de consultas", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const flags = { podeVisualizarOlistPedidos: true, podeCriarOlistPedido: true, podeVisualizarOlistContatos: true, podeVisualizarOlistVendedores: true };
  let contaEsperada = app;
  let perfilVendedor = true;
  let semVinculoFilial = false;
  let vendedorDetalhe: unknown = { id: 201 };
  let chamadas = 0;
  const pesquisas: URL[] = [];
  let pesquisasVinculos = 0;
  Object.assign(globalThis, { prisma: {
    usuario: {
      findFirst: async () => ({ id: usuarioId, aplicativoId: app, ativo: true }),
      findUnique: async () => ({ id: usuarioId, aplicativoId: app, ativo: true, ...flags }),
    },
    usuarioVendedorOlist: {
      findFirst: async ({ where, select }: { where: { usuarioId: string; aplicativoId?: string; OR?: unknown }; select: unknown }) => {
        assert.equal(where.usuarioId, usuarioId);
        assert.deepEqual(select, { vendedorOlistId: true });
        if (!perfilVendedor) return null;
        if (!where.aplicativoId) {
          assert.deepEqual(where.OR, [{ aplicativoId: app }, { aplicativo: { aplicativoPaiId: app } }]);
          return { vendedorOlistId: 201 };
        }
        if (semVinculoFilial && where.aplicativoId !== app) return null;
        return { vendedorOlistId: where.aplicativoId === app ? 201 : 301 };
      },
      findMany: async ({ where, select, take }: { where: { aplicativoId: string; vendedorOlistId: { in: number[] }; usuario: unknown }; select: unknown; take: number }) => {
        pesquisasVinculos++;
        assert.equal(where.aplicativoId, contaEsperada); assert.deepEqual(where.vendedorOlistId.in, [200, 201]);
        assert.ok(where.usuario); assert.equal(take, 1001);
        assert.deepEqual(select, { vendedorOlistId: true, usuario: { select: { id: true, nome: true, ativo: true } } });
        return [
          { vendedorOlistId: 200, usuario: { id: "pai-a", nome: "Ana", ativo: true } },
          { vendedorOlistId: 200, usuario: { id: "pai-b", nome: "Bia", ativo: false } },
        ];
      },
    },
    aplicativo: { findFirst: async ({ where }: { where: { id: string; aplicativoPaiId: string } }) => {
      assert.equal(where.aplicativoPaiId, app);
      return where.id === "00000000-0000-0000-0000-000000000003" ? { id: where.id } : null;
    }, findUnique: async ({ where }: { where: { id: string } }) => {
      assert.equal(where.id, contaEsperada); return { id: contaEsperada, nome: "Conta", olistClientId: "fake", olistClientSecret: "fake" };
    } },
    integracaoOlistToken: { findUnique: async ({ where }: { where: { aplicativoId_provider: { aplicativoId: string } } }) => {
      assert.equal(where.aplicativoId_provider.aplicativoId, contaEsperada); return { accessToken: "fake", expiresAt: new Date(Date.now() + 3600000) };
    } },
    estampa: { findMany: async () => [] }, variante: { findMany: async () => [] },
    tipoProduto: { findMany: async () => [] }, tamanho: { findMany: async () => [] },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string) => {
    chamadas++; const u = new URL(url); pesquisas.push(u);
    if (u.pathname.endsWith("/pedidos/123")) return { status: 200, data: { id: 123, vendedor: vendedorDetalhe }, headers: {} };
    const itens = u.pathname.endsWith("/vendedores") ? [{ id: 200, situacao: "A" }, { id: 201, situacao: "A" }] : [{ id: 123 }];
    return { status: 200, data: { itens, paginacao: { total: 500, limit: Number(u.searchParams.get("limit")), offset: Number(u.searchParams.get("offset")) } }, headers: {} };
  });
  const pedidos = await import("../src/app/api/olist/pedidos/route");
  const detalhe = await import("../src/app/api/olist/pedidos/[id]/route");
  const criar = await import("../src/app/api/olist/pedidos/criar/route");
  const contatos = await import("../src/app/api/olist/contatos/route");
  const vendedores = await import("../src/app/api/olist/vendedores/route");
  const req = (query = "", body?: unknown) => new Request(`https://example.test/api?${query}`, {
    method: body ? "POST" : "GET", headers: { authorization: "Bearer fake" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const contexto = { params: Promise.resolve({ id: "123" }) };
  for (const [flag, executar] of [
    ["podeVisualizarOlistPedidos", () => pedidos.GET(req())],
    ["podeVisualizarOlistPedidos", () => detalhe.GET(req(), contexto)],
    ["podeCriarOlistPedido", () => criar.GET(req("recurso=vendedores"))],
    ["podeCriarOlistPedido", () => criar.POST(req("", {}))],
    ["podeVisualizarOlistContatos", () => contatos.GET(req())],
    ["podeVisualizarOlistVendedores", () => vendedores.GET(req())],
  ] as const) {
    flags[flag] = false;
    const antes = chamadas;
    assert.equal((await executar()).status, 403);
    assert.equal(chamadas, antes);
    flags[flag] = true;
  }
  assert.equal((await vendedores.GET(new Request("https://example.test"))).status, 401);
  for (const vendedorId of [[], [1], {}, Number.MAX_SAFE_INTEGER + 1, -1, "1e3"]) {
    assert.equal((await criar.POST(req("", { vendedorId, clienteId: 123 }))).status, 400);
  }

  assert.equal((await pedidos.GET(req("aplicativoId=outro&idVendedor=900"))).status, 403);
  assert.equal((await pedidos.GET(req("idVendedor=900"))).status, 200);
  assert.equal(pesquisas.at(-1)?.searchParams.get("idVendedor"), "201");
  assert.equal((await detalhe.GET(req(), contexto)).status, 200);
  const inicialChamadas = chamadas;
  const catalogo = await criar.GET(req());
  assert.equal(catalogo.status, 200);
  const dados = await catalogo.json();
  assert.equal(dados.vendedorOlistId, 201);
  assert.deepEqual(dados.vendedores.map((v: { id: number }) => v.id), [200, 201]);
  assert.equal(chamadas - inicialChamadas, 1, "catálogo inicial não percorre todos os vendedores");
  assert.equal((await criar.GET(req("recurso=vendedores&offset=100"))).status, 200);
  assert.equal(pesquisas.at(-1)?.searchParams.get("offset"), "100");
  assert.equal((await criar.GET(req("recurso=vendedores&offset=-1"))).status, 400);
  const respostaVendedores = await vendedores.GET(req());
  assert.equal(respostaVendedores.status, 200);
  const itens = (await respostaVendedores.json()).itens;
  assert.equal(pesquisasVinculos, 1);
  assert.equal(itens[0].usuariosVinculados.length, 2);
  assert.deepEqual(itens[1].usuariosVinculados, []);
  assert.equal(JSON.stringify(itens).includes("email"), false);
  contaEsperada = "00000000-0000-0000-0000-000000000003";
  vendedorDetalhe = { id: 301 };
  for (const executar of [() => pedidos.GET(req(`aplicativoId=${contaEsperada}`)), () => contatos.GET(req(`aplicativoId=${contaEsperada}`)), () => vendedores.GET(req(`aplicativoId=${contaEsperada}`)), () => detalhe.GET(req(`aplicativoId=${contaEsperada}`), contexto)]) {
    assert.equal((await executar()).status, 200, "consulta utiliza credenciais da filial autorizada");
  }
  for (const rota of [pedidos, contatos]) {
    assert.equal((await rota.GET(req(`aplicativoId=${contaEsperada}&idVendedor=999`))).status, 200);
    assert.equal(pesquisas.at(-1)?.searchParams.get("idVendedor"), "301", "ID enviado pelo cliente não substitui o vínculo");
  }
  for (const vendedor of [{ id: 201 }, null, {}, { id: true }]) {
    vendedorDetalhe = vendedor;
    const resposta = await detalhe.GET(req(`aplicativoId=${contaEsperada}`), contexto);
    assert.equal(resposta.status, 403);
    assert.equal(JSON.stringify(await resposta.json()).includes('"id":123'), false);
  }
  vendedorDetalhe = { id: "301" };
  assert.equal((await detalhe.GET(req(`aplicativoId=${contaEsperada}`), contexto)).status, 200);
  semVinculoFilial = true;
  const antesSemVinculo = chamadas;
  assert.equal((await pedidos.GET(req(`aplicativoId=${contaEsperada}`))).status, 403);
  assert.equal((await contatos.GET(req(`aplicativoId=${contaEsperada}`))).status, 403);
  assert.equal((await detalhe.GET(req(`aplicativoId=${contaEsperada}`), contexto)).status, 403);
  assert.equal(chamadas, antesSemVinculo, "sem vínculo não consulta a Olist");
  perfilVendedor = false;
  assert.equal((await pedidos.GET(req(`aplicativoId=${contaEsperada}`))).status, 200);
  assert.equal(pesquisas.at(-1)?.searchParams.has("idVendedor"), false);
  assert.equal((await contatos.GET(req(`aplicativoId=${contaEsperada}`))).status, 200);
  assert.equal(pesquisas.at(-1)?.searchParams.has("idVendedor"), false);
  assert.equal((await detalhe.GET(req(`aplicativoId=${contaEsperada}`), contexto)).status, 200);
  const antesExterna = chamadas;
  assert.equal((await pedidos.GET(req("aplicativoId=00000000-0000-0000-0000-000000000099"))).status, 403);
  assert.equal(chamadas, antesExterna, "empresa externa não aciona a integração");
});
