import assert from "node:assert/strict";
import test from "node:test";

test("envio direto retorna 410 sem autenticar, consultar banco ou chamar a Olist", async (t) => {
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Endpoint desativado não pode fazer chamadas externas."); });
  const { POST } = await import("../src/app/api/fornecedores/enviar/route");
  const response = await POST();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, "ENVIO_DIRETO_DESATIVADO");
  assert.match(body.error, /Enviar para fila do Fornecedor/);
});
