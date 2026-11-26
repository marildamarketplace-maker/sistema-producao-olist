import assert from "node:assert/strict";
import test from "node:test";

test("API de cadastro autoriza antes de ler upload, limita corpo e valida campos", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "teste";
  let permitido = false;
  let recentes = 0;
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", ativo: true }), findUnique: async () => ({ podeEditarEstampas: permitido }) },
    estampaJob: { count: async () => recentes },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { POST } = await import("../src/app/api/estampas/cadastro-manual/route");
  const request = (form = new FormData()) => new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer teste" }, body: form });
  assert.equal((await POST(new Request("http://localhost", { method: "POST" }))).status, 401);
  assert.equal((await POST(request())).status, 403);
  permitido = true; recentes = 10; assert.equal((await POST(request())).status, 429);
  recentes = 0; assert.equal((await POST(request())).status, 400);
  const form = new FormData(); form.set("codigo", "123"); form.set("variante", "A");
  assert.equal((await POST(request(form))).status, 400);
  form.set("imagem", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "foto.png", { type: "image/png" }));
  assert.equal((await POST(request(form))).status, 413);
});
