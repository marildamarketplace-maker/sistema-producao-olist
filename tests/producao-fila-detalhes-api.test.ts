import assert from "node:assert/strict";
import test from "node:test";

const app = "00000000-0000-0000-0000-000000000001";
const id = "00000000-0000-0000-0000-000000000002";

test("status e detalhes da fila da produção exigem sessão, permissão e isolamento por origem", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true;
  let existe = true;
  let consultas = 0;
  let status = "PENDENTE";
  let falhar = false;
  const fila = () => ({ id: "fila", solicitacaoProducaoId: id, status });
  Object.assign(globalThis, { prisma: {
    usuario: {
      findFirst: async () => ({ id: "usuario", aplicativoId: app }),
      findUnique: async () => ({ podeSolicitarProducao: false, podeVisualizarProducao: permitido }),
    },
    pedidoFornecedorSolicitacao: { findMany: async () => [] },
    pedidoFornecedorQueue: {
      findMany: async ({ where, select }: { where: unknown; select: unknown }) => {
        assert.deepEqual(where, { aplicativoSolicitanteId: app, solicitacaoProducao: { status: "em_producao" } });
        assert.deepEqual(select, { id: true, solicitacaoProducaoId: true, status: true });
        return [fila()];
      },
      findFirst: async ({ where, select }: { where: unknown; select: Record<string, unknown> }) => {
        consultas++;
        assert.deepEqual(where, { solicitacaoProducaoId: id, aplicativoSolicitanteId: app });
        assert.equal(select.direcionadoPor, undefined);
        if (falhar) throw new Error("segredo interno");
        if (!existe) return null;
        return { ...fila(), createdAt: new Date("2026-10-16T12:00:00Z"), direcionadoEm: null, dadosPedido: { legado: true }, fornecedor: { nome: "Fornecedor" }, aplicativoFilial: null };
      },
    },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  t.mock.method(console, "error", () => {});
  const { GET } = await import("../src/app/api/solicitacoes-producao/[id]/fila-fornecedor/route");
  const { GET: LISTA } = await import("../src/app/api/solicitacoes-producao/pedidos-fornecedor/route");
  const request = () => new Request("https://example.test", { headers: { Authorization: "Bearer teste" } });
  const contexto = () => ({ params: Promise.resolve({ id }) });
  for (status of ["PENDENTE", "PROCESSAR", "CONCLUIDO", "FALHADO", "CANCELADO"]) {
    const lista = await LISTA(request());
    assert.equal(lista.status, 200);
    assert.deepEqual((await lista.json()).filas, [fila()]);
    assert.match(lista.headers.get("Cache-Control")!, /no-store/);
    const response = await GET(request(), contexto());
    assert.equal(response.status, 200);
    const { pedido } = await response.json();
    assert.equal(pedido.status, status);
    assert.equal(pedido.fornecedor, "Fornecedor");
    assert.equal(pedido.filial, null);
    assert.equal(pedido.dadosPedido, null);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
  }
  const antes = consultas;
  permitido = false;
  assert.equal((await GET(request(), contexto())).status, 403);
  assert.equal((await LISTA(request())).status, 403);
  permitido = true;
  assert.equal((await GET(new Request("https://example.test"), contexto())).status, 401);
  assert.equal((await GET(request(), { params: Promise.resolve({ id: "invalido" }) })).status, 400);
  assert.equal(consultas, antes);
  existe = false;
  assert.equal((await GET(request(), contexto())).status, 404);
  falhar = true;
  const response = await GET(request(), contexto());
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /segredo/);
});
