import test from "node:test";
import assert from "node:assert/strict";
const app = "00000000-0000-0000-0000-000000000001";
const plano = "00000000-0000-0000-0000-000000000002";
test("associação de recebimento valida recurso, permissão e tenant e substitui sob lock", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let permitido = true, ativo = true, consultas = 0;
  const eventos: string[] = [];
  const usuario = () => ({ id: app, aplicativoId: app, ativo: true, podeVisualizarOlistFormasRecebimento: permitido });
  const banco = {
    usuario: { findFirst: async () => usuario() },
    aplicativo: { findFirst: async () => null },
    planoPagamento: {
      findMany: async () => { consultas++; return [{ id: plano, nome: "30/60" }]; },
      count: async () => ativo ? 1 : 0,
    },
    formaRecebimentoOlistPlano: {
      findMany: async ({ where, select }: { where: { aplicativoId: string; formaOlistId: string }; select: unknown }) => {
        assert.deepEqual(where, { aplicativoId: app, formaOlistId: "123" }); assert.deepEqual(select, { planoPagamentoId: true });
        return [{ planoPagamentoId: plano }];
      },
      deleteMany: async ({ where }: { where: { aplicativoId: string } }) => { assert.equal(where.aplicativoId, app); eventos.push("remover"); },
      createMany: async ({ data }: { data: Array<{ aplicativoId: string; planoPagamentoId: string }> }) => { assert.equal(data.length, 1); assert.equal(data[0].aplicativoId, app); assert.equal(data[0].planoPagamentoId, plano); eventos.push("criar"); },
    },
    $queryRaw: async () => { eventos.push("lock"); return [{ id: app }]; },
  };
  const tx = { ...banco, $transaction: async <T>(fn: (tx: typeof banco) => Promise<T>): Promise<T> => fn(banco) };
  Object.assign(globalThis, { prisma: tx });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: app, email: "teste@example.test" } }, error: null }));
  const { GET, PUT } = await import("../src/app/api/olist/planos-pagamento/route");
  const req = (tipo: string, body?: unknown, empresa?: string) => new Request(`https://example.test/api?tipo=${tipo}&formaOlistId=123${empresa ? `&aplicativoId=${empresa}` : ""}`, {
    method: body ? "PUT" : "GET", headers: { Authorization: "Bearer fake", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await GET(req("pagamento"))).status, 400); assert.equal(consultas, 0);
  permitido = false; assert.equal((await GET(req("recebimento"))).status, 403); permitido = true;
  assert.equal((await GET(req("recebimento", undefined, plano))).status, 403);
  const resposta = await GET(req("recebimento")); assert.equal(resposta.status, 200);
  assert.deepEqual((await resposta.json()).planoIdsAssociados, [plano]);
  const body = { tipo: "recebimento", formaOlistId: "123", planoIds: [plano, plano] };
  assert.equal((await PUT(req("recebimento", body))).status, 200);
  assert.deepEqual(eventos, ["lock", "remover", "criar"]);
  eventos.length = 0; ativo = false;
  assert.equal((await PUT(req("recebimento", body))).status, 400); assert.deepEqual(eventos, ["lock"]);
  assert.equal((await PUT(req("pagamento", { ...body, tipo: "pagamento" }))).status, 400);
});
