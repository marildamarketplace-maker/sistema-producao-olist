import assert from "node:assert/strict";
import test from "node:test";
import { pesquisarTecidoOlist } from "../src/lib/pesquisar-tecido-olist";

test("confirma nome exato desconsiderando caixa e espaços", async () => {
  assert.deepEqual(await pesquisarTecidoOlist(" Oxford  Premium ", async () => ({ itens: [{ id: 123, nome: "OXFORD premium", preco: 12.5 }], mais: false })), { id: 123, nome: "OXFORD premium", preco: 12.5 });
});

test("resultado semelhante não confirma sucesso", async () => {
  assert.equal(await pesquisarTecidoOlist("Oxford", async () => ({ itens: [{ nome: "Oxford Premium" }], mais: false })), null);
});

test("procura nas próximas páginas e para ao encontrar", async () => {
  const paginas: number[] = [];
  assert.deepEqual(await pesquisarTecidoOlist("Oxford", async (pagina) => {
    paginas.push(pagina);
    return { itens: [{ nome: pagina === 2 ? "Oxford" : "Outro" }], mais: true };
  }), { nome: "Oxford" });
  assert.deepEqual(paginas, [1, 2]);
});

test("falha na consulta não vira ausência nem sucesso", async () => {
  await assert.rejects(pesquisarTecidoOlist("Oxford", async () => { throw new Error("Falha Olist"); }), /Falha Olist/);
});

test("nome vazio ou longo não dispara consulta", async () => {
  for (const nome of ["  ", "a".repeat(121)]) {
    await assert.rejects(pesquisarTecidoOlist(nome, async () => { assert.fail("Consulta indevida"); }), /120 caracteres/);
  }
});

test("preço editado do tecido encontrado é preservado no envio", async () => {
  const { criarRascunhoFilaOlist, serializarRascunhoFilaOlist } = await import("../src/lib/fila-olist-contrato");
  const tecidoId = "00000000-0000-4000-8000-000000000001";
  const produto = await pesquisarTecidoOlist("Oxford", async () => ({ itens: [{ nome: "Oxford", id: 123, preco: 10 }], mais: false }));
  assert.ok(produto);
  const rascunho = criarRascunhoFilaOlist([tecidoId]);
  rascunho.tecidos[0] = { tecidoId, id: produto.id, preco: 12.5 };
  assert.deepEqual(serializarRascunhoFilaOlist(rascunho).tecidos, [{ tecidoId, id: 123, preco: 12.5 }]);
  rascunho.tecidos[0].preco = 0;
  assert.equal(serializarRascunhoFilaOlist(rascunho).tecidos?.[0].preco, 0);
  rascunho.tecidos[0].preco = -1;
  assert.throws(() => serializarRascunhoFilaOlist(rascunho), /preços/);
});
