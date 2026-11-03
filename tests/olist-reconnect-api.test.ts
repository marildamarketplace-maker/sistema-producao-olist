import test from "node:test";
import assert from "node:assert/strict";

test("reconnect valida autenticação e permissão antes de alterar tokens da conta", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let permitido = false;
  let tokenValido = true;
  let consultas = 0;
  let escritas = 0;
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: "conta-autenticada", podeEditarConfiguracao: permitido }) },
    integracaoOlistToken: {
      findFirst: async ({ where }: { where: { aplicativoId: string } }) => {
        consultas++;
        assert.equal(where.aplicativoId, "conta-autenticada");
        return { id: "integracao" };
      },
      update: async ({ data }: { data: { aplicativoId: string } }) => {
        escritas++;
        assert.equal(data.aplicativoId, "conta-autenticada");
      },
    },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({
    data: { user: tokenValido ? { id: "usuario", email: "teste@example.test" } : null },
    error: tokenValido ? null : new Error("invalid jwt"),
  }));
  const { POST } = await import("../src/app/api/olist/reconnect/route");
  const request = () => new Request("https://example.test/api/olist/reconnect", {
    method: "POST", headers: { Authorization: "Bearer fake" },
  });
  assert.equal((await POST(new Request("https://example.test", { method: "POST" }))).status, 401);
  tokenValido = false;
  assert.equal((await POST(request())).status, 401);
  tokenValido = true;
  assert.equal((await POST(request())).status, 403);
  assert.equal(consultas, 0);
  assert.equal(escritas, 0);
  permitido = true;
  const resposta = await POST(request());
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { login_url: "/api/olist/login" });
  assert.match(resposta.headers.get("set-cookie") ?? "", /olist_aplicativo_id=conta-autenticada;.*Path=\/api\/olist;.*HttpOnly;.*SameSite=lax/i);
  assert.equal(escritas, 1);
});
