import assert from "node:assert/strict";
import test from "node:test";

const aplicativoId = "00000000-0000-0000-0000-000000000001";
const id = "00000000-0000-0000-0000-000000000002";

test("link público exige sessão, permissão, empresa e solicitação pendente", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
  let permitido = true;
  let existe = true;
  let habilitado = true;
  let falhar = false;
  let consultas = 0;
  Object.assign(globalThis, { prisma: {
    usuario: {
      findFirst: async () => ({ id: "usuario", aplicativoId }),
      findUnique: async () => ({ podeConfirmarProducao: permitido }),
    },
    solicitacaoProducao: { findFirst: async ({ where }: { where: unknown }) => {
      consultas++;
      assert.deepEqual(where, { id, aplicativoId, status: "em_producao" });
      if (falhar) throw new Error("segredo interno");
      return existe ? { id } : null;
    } },
    aplicativo: { findUnique: async () => ({ jobs: habilitado ? "CONFIRMACAO_ENTREGA_PRODUCAO" : "" }) },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { POST } = await import("../src/app/api/solicitacoes-producao/[id]/link-confirmacao/route");
  const { validarTokenPublicoConfirmacaoProducao } = await import("../src/lib/confirmacao-entrega-producao-publica");
  const enviar = (identificador = id, autenticado = true) => POST(new Request("https://example.test/api/link", {
    method: "POST", headers: autenticado ? { Authorization: "Bearer teste" } : {},
  }), { params: Promise.resolve({ id: identificador }) });
  assert.equal((await enviar("invalido")).status, 400);
  assert.equal((await enviar(id, false)).status, 401);
  assert.equal(consultas, 0);
  permitido = false;
  assert.equal((await enviar()).status, 403);
  assert.equal(consultas, 0);
  permitido = true; existe = false;
  assert.equal((await enviar()).status, 404);
  existe = true; habilitado = false;
  assert.equal((await enviar()).status, 403);
  habilitado = true;
  const response = await enviar();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const payload = validarTokenPublicoConfirmacaoProducao((await response.json()).token);
  assert.equal(payload.aplicativoId, aplicativoId);
  assert.equal(payload.solicitacaoId, id);
  falhar = true;
  const erro = await enviar();
  assert.equal(erro.status, 500);
  assert.doesNotMatch(await erro.text(), /segredo interno/);
});
