import assert from "node:assert/strict";
import { test } from "node:test";

test("Automatização aceita cadastro legado único com e-mail confirmado e mantém isolamento", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  const cadastro = { ativo: true, podeVisualizarAutomatizacao: true, aplicativoId: "app-legado" };
  let porId: typeof cadastro | null = null;
  let porEmail = [cadastro];
  let confirmado = true;
  let consultasEmail = 0;
  Object.assign(globalThis, { prisma: {
    usuario: {
      findUnique: async () => porId,
      findMany: async (consulta: unknown) => {
        consultasEmail++;
        assert.deepEqual((consulta as { where: unknown }).where, { email: { equals: "legado@example.test", mode: "insensitive" } });
        return porEmail;
      },
    },
    habilidadeAutomatizacao: {
      findMany: async (consulta: { where: { aplicativoId: string } }) => [consulta.where.aplicativoId],
    },
  } });
  t.after(() => { Reflect.deleteProperty(globalThis, "prisma"); });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({
    error: null, data: { user: {
      id: "auth-id", email: "legado@example.test",
      email_confirmed_at: confirmado ? "2026-11-10T00:00:00Z" : undefined,
    } },
  }));
  const { GET } = await import("../src/app/api/automatizacao/[recurso]/route");
  const listar = () => GET(new Request("https://erp.test/api/automatizacao/habilidades", {
    headers: { Authorization: "Bearer token-ficticio" },
  }), { params: Promise.resolve({ recurso: "habilidades" }) });

  assert.deepEqual(await (await listar()).json(), ["app-legado"]);
  porEmail = [cadastro, { ...cadastro, aplicativoId: "outro-app" }];
  assert.equal((await listar()).status, 403);
  confirmado = false;
  porEmail = [cadastro];
  assert.equal((await listar()).status, 403);
  porId = { ...cadastro, ativo: false };
  confirmado = true;
  assert.equal((await listar()).status, 403);
  porId = { ...cadastro, aplicativoId: "app-do-id" };
  assert.deepEqual(await (await listar()).json(), ["app-do-id"]);
  assert.equal(consultasEmail, 2);
});
