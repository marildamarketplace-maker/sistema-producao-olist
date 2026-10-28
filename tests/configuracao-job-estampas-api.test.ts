import assert from "node:assert/strict";
import test from "node:test";

test("configuração dos jobs: autenticação, permissão, validação e persistência", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true;
  let falha = false;
  let escritas = 0;
  let salvo: { pausado: boolean; variantesPermitidas: string[]; termosIgnoradosNomeArquivo: string[] } | null = null;
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario" }), findUnique: async () => ({ podeEditarEstampas: permitido }) },
    configuracaoJob: {
      findUnique: async () => salvo,
      upsert: async ({ where, create, update }: { where: unknown; create: unknown; update: NonNullable<typeof salvo> }) => {
        if (falha) throw new Error("credencial-privada");
        assert.deepEqual(where, { chave: "processar-estampas" });
        assert.deepEqual(create, { chave: "processar-estampas", ...update });
        escritas++; salvo = update; return salvo;
      },
    },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { GET, PUT } = await import("../src/app/api/estampas/jobs/configuracao/route");
  const request = (body?: unknown) => new Request("https://example.test", {
    method: body === undefined ? "GET" : "PUT", headers: { Authorization: "Bearer teste", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await GET(new Request("https://example.test"))).status, 401);
  permitido = false;
  assert.equal((await GET(request())).status, 403);
  assert.equal((await PUT(request({ pausado: false, variantesPermitidas: [], termosIgnoradosNomeArquivo: [] }))).status, 403);
  assert.equal(escritas, 0);
  permitido = true;
  assert.deepEqual(await (await GET(request())).json(), { pausado: true, variantesPermitidas: [], termosIgnoradosNomeArquivo: [] });
  for (const body of [null, {}, { pausado: "false", variantesPermitidas: [], termosIgnoradosNomeArquivo: [] },
    { pausado: false, variantesPermitidas: [], termosIgnoradosNomeArquivo: [""] },
    { pausado: false, variantesPermitidas: [], termosIgnoradosNomeArquivo: ["a".repeat(101)] },
    { pausado: false, variantesPermitidas: [], termosIgnoradosNomeArquivo: Array(101).fill("a") },
    { pausado: false, variantesPermitidas: [], termosIgnoradosNomeArquivo: [], chave: "outro-job" }]) {
    assert.equal((await PUT(request(body))).status, 400);
  }
  assert.equal(escritas, 0);
  for (const [pausado, variantesPermitidas] of [[false, ["A"]], [false, ["B"]], [true, []]] as const) {
    const dados = { pausado, variantesPermitidas, termosIgnoradosNomeArquivo: ["MOCKUP", "-", ".", "a,b"] };
    assert.deepEqual(await (await PUT(request(dados))).json(), dados);
    assert.deepEqual(await (await GET(request())).json(), dados);
  }
  assert.equal((await PUT(request({ pausado: true, variantesPermitidas: [], termosIgnoradosNomeArquivo: [] }))).status, 200);
  falha = true;
  const response = await PUT(request({ pausado: false, variantesPermitidas: [], termosIgnoradosNomeArquivo: [] }));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /credencial-privada/);
});
