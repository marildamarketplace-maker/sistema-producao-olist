import assert from "node:assert/strict";
import test from "node:test";
import { pesquisarPaginaTecidosOlist } from "../src/lib/pesquisar-tecido-olist";

const fourway = { id: 5168, nome: "FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168 1J3B4C6D2B", referencia: "5168", preco: 18.99 };
const baseitwill = { id: 6887, nome: "BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887", referencia: "6887", preco: 15.99 };

test("busca parcial FOURWAY retorna opções completas sem escolher a primeira", async () => {
  const resultado = await pesquisarPaginaTecidosOlist("FOURWAY", 1, async () => ({ itens: [baseitwill, fourway], mais: false }));
  assert.deepEqual(resultado.itens, [baseitwill, fourway]);
  assert.equal(resultado.exato, null);
});

test("único nome exato em pesquisa completa desconsidera caixa e espaços", async () => {
  const produto = { id: 123, nome: "OXFORD premium", preco: 12.5 };
  const resultado = await pesquisarPaginaTecidosOlist(" Oxford  Premium ", 1, async () => ({ itens: [produto], mais: false }));
  assert.deepEqual(resultado.exato, produto);
});

test("nome apenas semelhante ou ambiguidades exigem escolha explícita", async () => {
  for (const resposta of [
    { itens: [fourway], mais: false },
    { itens: [{ id: 1, nome: "FOURWAY" }, fourway], mais: false },
    { itens: [{ id: 1, nome: "FOURWAY" }], mais: true },
  ]) assert.equal((await pesquisarPaginaTecidosOlist("FOURWAY", 1, async () => resposta)).exato, null);
});

test("cada página faz uma única chamada e página seguinte não autoassocia nome exato", async () => {
  const chamadas: number[] = [];
  const carregar = async (pagina: number) => {
    chamadas.push(pagina);
    return { itens: pagina === 1 ? [fourway] : [{ id: 2, nome: "FOURWAY" }], pagina, mais: pagina === 1 };
  };
  assert.equal((await pesquisarPaginaTecidosOlist("FOURWAY", 1, carregar)).mais, true);
  assert.deepEqual(chamadas, [1], "Não antecipa a próxima página");
  assert.equal((await pesquisarPaginaTecidosOlist("FOURWAY", 2, carregar)).exato, null);
  assert.deepEqual(chamadas, [1, 2]);
});

test("página sem elegíveis preserva mais resultados do servidor", async () => {
  const resultado = await pesquisarPaginaTecidosOlist("FOURWAY", 1, async () => ({ itens: [], mais: true }));
  assert.deepEqual(resultado, { itens: [], pagina: 1, mais: true, exato: null });
});

test("contrato inválido da Olist não vira resultado selecionável", async () => {
  for (const resposta of [
    null, {}, { itens: [], mais: "false" }, { itens: [{ nome: "FOURWAY" }], mais: false },
    { itens: [{ id: 0, nome: "FOURWAY" }], mais: false },
    { itens: [{ id: 1, nome: "", preco: -1 }], mais: false },
    { itens: [{ id: 1, nome: "FOURWAY", preco: "18.99" }], mais: false },
    { itens: [fourway], mais: false, pagina: 2 },
    { itens: Array.from({ length: 51 }, () => fourway), mais: false },
  ]) await assert.rejects(pesquisarPaginaTecidosOlist("FOURWAY", 1, async () => resposta), /pesquisa inválida/);
});

test("falha na consulta não vira ausência nem sucesso", async () => {
  await assert.rejects(pesquisarPaginaTecidosOlist("FOURWAY", 1, async () => { throw new Error("Falha Olist"); }), /Falha Olist/);
});

test("nome ou página inválidos não disparam consulta", async () => {
  for (const nome of ["  ", "a".repeat(121)]) {
    await assert.rejects(pesquisarPaginaTecidosOlist(nome, 1, async () => { assert.fail("Consulta indevida"); }), /120 caracteres/);
  }
  for (const pagina of [0, 1.5, 1001, NaN]) {
    await assert.rejects(pesquisarPaginaTecidosOlist("FOURWAY", pagina, async () => { assert.fail("Consulta indevida"); }), /Página/);
  }
});

test("preço do produto escolhido e edição posterior são preservados no envio", async () => {
  const { criarRascunhoFilaOlist, serializarRascunhoFilaOlist } = await import("../src/lib/fila-olist-contrato");
  const tecidoId = "00000000-0000-4000-8000-000000000001";
  const resultado = await pesquisarPaginaTecidosOlist("FOURWAY", 1, async () => ({ itens: [baseitwill, fourway], mais: false }));
  const produto = resultado.itens.find(item => item.id === 5168);
  assert.ok(produto);
  const rascunho = criarRascunhoFilaOlist([tecidoId]);
  rascunho.tecidos[0] = { tecidoId, id: produto.id, preco: produto.preco ?? null };
  assert.deepEqual(serializarRascunhoFilaOlist(rascunho).tecidos, [{ tecidoId, id: 5168, preco: 18.99 }]);
  rascunho.tecidos[0].preco = 12.5;
  assert.equal(serializarRascunhoFilaOlist(rascunho).tecidos?.[0].preco, 12.5);
  rascunho.tecidos[0].preco = 0;
  assert.equal(serializarRascunhoFilaOlist(rascunho).tecidos?.[0].preco, 0);
  rascunho.tecidos[0].preco = -1;
  assert.throws(() => serializarRascunhoFilaOlist(rascunho), /preços/);
});
