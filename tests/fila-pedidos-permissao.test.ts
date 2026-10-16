import assert from "node:assert/strict";
import test from "node:test";
import { permissionKeys, permissionLabels } from "../src/lib/permissions";
import { paginasPermitidas } from "../src/lib/navigation";

test("fila de pedidos exige permissão própria sem conceder acesso administrativo geral", () => {
  const fila = "/fornecedor/fila-pedidos";
  assert.ok(permissionKeys.includes("podeGerenciarFilaPedidos"));
  assert.equal(permissionLabels.podeGerenciarFilaPedidos, "Gerenciar fila de pedidos");
  assert.ok(!paginasPermitidas({ podeEditarConfiguracao: true }).some((p) => p.href === fila));
  assert.ok(!paginasPermitidas({ podeGerenciarFilaPedidos: false }).some((p) => p.href === fila));
  const permitidas = paginasPermitidas({ podeGerenciarFilaPedidos: true });
  assert.ok(permitidas.some((p) => p.href === fila && p.grupo === "Pedidos"));
  assert.ok(!permitidas.some((p) => ["/usuarios", "/configuracoes", "/olist/pedidos/criar"].includes(p.href)));
});

test("administração de usuários permite conceder e revogar a permissão da fila", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  const app = "00000000-0000-0000-0000-000000000001";
  let ultima: Record<string, boolean> = {};
  Object.assign(globalThis, { prisma: { usuario: {
    findFirst: async () => ({ id: "usuario", aplicativoId: app }),
    findUnique: async () => ({ id: "admin", aplicativoId: app, podeEditarConfiguracao: true }),
    update: async ({ data, select }: { data: Record<string, boolean>; select: Record<string, boolean> }) => {
      assert.equal(select.podeGerenciarFilaPedidos, true); ultima = data; return data;
    },
  } } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "admin", email: "teste@example.test" } }, error: null }));
  const { PATCH } = await import("../src/app/api/usuarios/route");
  for (const value of [true, false]) {
    const response = await PATCH(new Request("https://example.test", { method: "PATCH", headers: { Authorization: "Bearer teste" }, body: JSON.stringify({ usuarioId: "usuario", permission: "podeGerenciarFilaPedidos", value }) }));
    assert.equal(response.status, 200); assert.deepEqual(ultima, { podeGerenciarFilaPedidos: value });
  }
  for (const all of [true, false]) {
    const response = await PATCH(new Request("https://example.test", { method: "PATCH", headers: { Authorization: "Bearer teste" }, body: JSON.stringify({ usuarioId: "usuario", all }) }));
    assert.equal(response.status, 200); assert.equal(ultima.podeGerenciarFilaPedidos, all);
  }
});
