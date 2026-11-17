import assert from "node:assert/strict";
import test from "node:test";
import { permissionKeys } from "../src/lib/permissions";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

const pai = "00000000-0000-0000-0000-000000000002";
const filho = "00000000-0000-0000-0000-000000000004";
const permissoes = Object.fromEntries(permissionKeys.map((chave) => [chave, true]));
let aplicativoId = pai;
let configuracaoExiste = true;
let usuarioAtivo = true;
let chamadasGrupo = 0;
Object.assign(globalThis, { prisma: {
  usuario: {
    findFirst: async ({ where }: { where: { id?: string } }) => usuarioAtivo && where.id === "usuario" ? { id: "usuario", aplicativoId } : null,
    findMany: async () => [],
    findUnique: async ({ select }: { select: Record<string, unknown> }) => {
      assert.equal(select.senha, undefined); assert.equal(select.integracaoOlistTokens, undefined);
      return { id: "usuario", nome: "Usuário", email: "teste@example.test", aplicativoId, vendedorOlistId: null, aplicativo: { nome: "Empresa" }, ...permissoes };
    },
  },
  olistSyncConfiguracao: {
    findUnique: async ({ where, select }: { where: { aplicativoPaiId: string }; select: Record<string, unknown> }) => {
      chamadasGrupo += 1;
      assert.deepEqual(select, { id: true });
      return configuracaoExiste && where.aplicativoPaiId === pai ? { id: "grupo" } : null;
    },
  },
} });

test("sessão do módulo usa usuário autenticado e restringe flags ao aplicativo pai configurado", async (t) => {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test", email_confirmed_at: "2026-11-16" } }, error: null }));
  const { GET } = await import("../src/app/api/usuario/me/route");
  const request = () => new Request("https://example.test/api/usuario/me", { headers: { authorization: "Bearer fake" } });
  aplicativoId = pai;
  let response = await GET(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  let body = await response.json();
  assert.equal(body.aplicativoAdministraSincronizacaoOlist, true);
  assert.equal(body.podeResolverSincronizacaoOlist, true);
  assert.equal(body.aplicativo_id, pai);
  aplicativoId = filho;
  response = await GET(request()); body = await response.json();
  assert.equal(body.aplicativoAdministraSincronizacaoOlist, false);
  for (const chave of ["podeVisualizarSincronizacaoOlist", "podeExecutarSincronizacaoOlist", "podeResolverSincronizacaoOlist", "podeConfigurarSincronizacaoOlist"]) assert.equal(body[chave], false);
  assert.equal(body.podeVisualizarDashboard, true, "permissões já existentes permanecem independentes");
  aplicativoId = pai; configuracaoExiste = false;
  response = await GET(request()); body = await response.json();
  assert.equal(body.podeExecutarSincronizacaoOlist, false, "ausência da configuração não concede acesso");
  usuarioAtivo = false;
  const antes = chamadasGrupo;
  assert.equal((await GET(request())).status, 403);
  assert.equal(chamadasGrupo, antes);
  assert.equal((await GET(new Request("https://example.test"))).status, 401);
});
