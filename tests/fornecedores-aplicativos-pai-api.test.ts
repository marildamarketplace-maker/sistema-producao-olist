import assert from "node:assert/strict";
import test from "node:test";

test("opções de fornecedores incluem somente matrizes e somente ID/nome, com permissão", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true;
  let consultas = 0;
  const matriz = { id: "00000000-0000-0000-0000-000000000002", nome: "MV Tecidos" };
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: "origem" }), findUnique: async () => ({ podeVisualizarFornecedores: permitido }), findMany: async () => [] },
    formaPagamentoOlistPlano: { findMany: async () => [] },
    aplicativo: { findMany: async ({ where, select }: { where: unknown; select: unknown }) => {
      consultas++;
      assert.deepEqual(where, { aplicativoPaiId: null });
      assert.deepEqual(select, { id: true, nome: true });
      return [matriz];
    } },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET } = await import("../src/app/api/fornecedores/vendedores/route");
  const request = () => new Request("https://example.test", { headers: { Authorization: "Bearer teste" } });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).aplicativosPai, [matriz]);
  permitido = false;
  assert.equal((await GET(request())).status, 403);
  assert.equal(consultas, 1);
});
