import assert from "node:assert/strict";
import test from "node:test";

test("empresas Olist: oculta pai com filiais e seleciona a primeira filial; preserva empresa única", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const pai = { id: "pai", nome: "Matriz" };
  const filial = { id: "filial", nome: "Filial A" };
  let empresas = [pai, filial, { id: "filial-b", nome: "Filial B" }];
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: pai.id, ativo: true }) },
    aplicativo: { findMany: async ({ where, select }: { where: unknown; select: unknown }) => {
      assert.deepEqual(where, { OR: [{ id: pai.id }, { aplicativoPaiId: pai.id }] });
      assert.deepEqual(select, { id: true, nome: true });
      return empresas;
    } },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET } = await import("../src/app/api/olist/empresas/route");
  const request = () => new Request("https://example.test/api/olist/empresas", { headers: { authorization: "Bearer fake" } });
  assert.deepEqual(await (await GET(request())).json(), { empresas: [filial, empresas[2]], aplicativoId: filial.id });
  empresas = [pai, filial];
  assert.deepEqual(await (await GET(request())).json(), { empresas: [filial], aplicativoId: filial.id });
  empresas = [pai];
  assert.deepEqual(await (await GET(request())).json(), { empresas: [pai], aplicativoId: pai.id });
  assert.equal((await GET(new Request("https://example.test/api"))).status, 401);
});
