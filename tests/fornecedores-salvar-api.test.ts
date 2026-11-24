import assert from "node:assert/strict";
import test from "node:test";

const origem = "00000000-0000-0000-0000-000000000001";
const pai = "00000000-0000-0000-0000-000000000002";
const id = "00000000-0000-0000-0000-000000000003";
const body = { id: null as string | null, aplicativo_pai_id: pai, nome: "MV Tecidos", endereco: null };

test("salvar fornecedor exige matriz e isola escrita por aplicativo autenticado", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true;
  let matrizValida = true;
  let pertence = true;
  let grava = 0;
  const comerciais = { meuClienteOlistId: 123, meuFormaPagamentoOlistId: 456, meuPlanoPagamentoId: id, meuTipoVenda: "VENDA_G" };
  let fornecedorPersistido = { ...comerciais, nome: "Nome anterior" };
  const conferirCampos = (data: Record<string, unknown>) => {
    for (const campo of ["vendedorOlistId", ...Object.keys(comerciais)]) assert.equal(Object.hasOwn(data, campo), false);
  };
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: origem }), findUnique: async () => ({ aplicativoId: origem, podeVisualizarFornecedores: permitido }) },
    aplicativo: { findFirst: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { id: pai, aplicativoPaiId: null }); return matrizValida ? { id: pai } : null; } },
    fornecedor: {
      create: async ({ data }: { data: Record<string, unknown> }) => { assert.equal(data.aplicativoId, origem); assert.equal(data.aplicativoPaiId, pai); conferirCampos(data); grava++; return { id }; },
      updateMany: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        assert.deepEqual(where, { id, aplicativoId: origem }); assert.equal(data.aplicativoPaiId, pai);
        assert.equal(data.aplicativoId, undefined); conferirCampos(data);
        if (pertence) { grava++; fornecedorPersistido = { ...fornecedorPersistido, ...data }; }
        return { count: pertence ? 1 : 0 };
      },
    },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { POST } = await import("../src/app/api/fornecedores/salvar/route");
  const request = (payload: unknown = body) => new Request("https://example.test", { method: "POST", headers: { Authorization: "Bearer teste" }, body: JSON.stringify(payload) });
  assert.equal((await POST(new Request("https://example.test", { method: "POST" }))).status, 401);
  permitido = false; assert.equal((await POST(request())).status, 403); permitido = true;
  for (const payload of [{ ...body, aplicativo_pai_id: null }, { ...body, aplicativo_id: pai }, { ...body, nome: "" }, { ...body, meu_cliente_olist_id: -1 }]) {
    assert.equal((await POST(request(payload))).status, 400);
  }
  matrizValida = false; assert.equal((await POST(request())).status, 400); matrizValida = true;
  assert.equal(grava, 0);
  assert.equal((await POST(request())).status, 201);
  assert.equal((await POST(request({ ...body, id }))).status, 200);
  for (const [campo, valor] of Object.entries(comerciais)) assert.equal(fornecedorPersistido[campo as keyof typeof fornecedorPersistido], valor);
  pertence = false;
  assert.equal((await POST(request({ ...body, id }))).status, 404);
  assert.equal(grava, 2);
  for (const campo of ["vendedor_olist_id", "meu_cliente_olist_id", "meu_forma_pagamento_olist_id", "meu_plano_pagamento_id", "meu_tipo_venda_enum"]) {
    assert.equal((await POST(request({ ...body, [campo]: null }))).status, 400);
  }
  assert.equal(grava, 2);
});
