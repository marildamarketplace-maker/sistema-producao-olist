import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

test("consulta de notas usa filtros oficiais, todas as páginas e falha se a resposta estiver incompleta", async (t) => {
  const app = "aplicativo-teste";
  Object.assign(globalThis, { prisma: {
    aplicativo: { findUnique: async () => ({ id: app, nome: "Teste" }) },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: "fake", expiresAt: new Date(Date.now() + 3600000) }) },
  } });
  let modo = "paginado";
  const offsets: string[] = [];
  t.mock.method(axios, "get", async (endereco: string) => {
    const url = new URL(endereco);
    if (url.pathname.endsWith("/notas/321")) return { status: 200, headers: {}, data: { id: 321, finalidade: 4 } };
    assert.equal(url.searchParams.get("tipo"), "E");
    assert.equal(url.searchParams.get("idVenda"), "123");
    assert.equal(url.searchParams.get("limit"), "100");
    const offset = url.searchParams.get("offset")!; offsets.push(offset);
    if (modo === "erro") return { status: 503, headers: {}, data: {} };
    if (modo === "malformado") return { status: 200, headers: {}, data: { itens: null } };
    if (modo === "incompleto") return { status: 200, headers: {}, data: { itens: [], paginacao: { total: 101 } } };
    return { status: 200, headers: {}, data: {
      itens: Array.from({ length: offset === "0" ? 100 : 1 }, (_, i) => ({ id: Number(offset) + i + 1 })), paginacao: { total: 101 },
    } };
  });
  const { listarNotasEntradaRetornoOlist, obterNotaRetornoOlist } = await import("../src/lib/olist");
  assert.equal((await listarNotasEntradaRetornoOlist(app, { idVenda: "123" })).length, 101);
  assert.deepEqual(offsets, ["0", "100"]);
  for (const caso of ["erro", "malformado", "incompleto"]) {
    modo = caso; await assert.rejects(listarNotasEntradaRetornoOlist(app, { idVenda: "123" }));
  }
  assert.equal((await obterNotaRetornoOlist(app, "321")).finalidade, 4);
});
