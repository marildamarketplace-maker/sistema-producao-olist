import assert from "node:assert/strict";
import test from "node:test";

const propria = "00000000-0000-0000-0000-000000000001";
const filial = "00000000-0000-0000-0000-000000000002";
const outra = "00000000-0000-0000-0000-000000000003";

test("empresa Olist: permite própria e filial direta, rejeita contas externas e entrada inválida", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let consultas = 0;
  Object.assign(globalThis, { prisma: { aplicativo: { findFirst: async ({ where, select }: { where: { id: string; aplicativoPaiId: string }; select: unknown }) => {
    consultas++;
    assert.equal(where.aplicativoPaiId, propria);
    assert.deepEqual(select, { id: true });
    return where.id === filial ? { id: filial } : null;
  } } } });
  const { resolverEmpresaOlist } = await import("../src/lib/olist-empresa");
  const req = (id?: string) => new Request(`https://example.test/api${id === undefined ? "" : `?aplicativoId=${id}`}`);
  assert.equal(await resolverEmpresaOlist(req(), propria), propria);
  assert.equal(await resolverEmpresaOlist(req(propria), propria), propria);
  assert.equal(consultas, 0);
  assert.equal(await resolverEmpresaOlist(req(filial), propria), filial);
  for (const id of [outra, "", "invalido"]) {
    await assert.rejects(resolverEmpresaOlist(req(id), propria), { status: 403 });
  }
  assert.equal(consultas, 2);
});
