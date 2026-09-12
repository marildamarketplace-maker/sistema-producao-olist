import assert from "node:assert/strict";
import test from "node:test";
import { carregarTodasPaginas } from "../src/lib/paginacao";

test("carrega todas as páginas quando o total ultrapassa o limite da API", async () => {
  const origem = Array.from({ length: 1161 }, (_, indice) => indice + 1);
  const intervalos: Array<[number, number]> = [];

  const resultado = await carregarTodasPaginas<number, Error>(async (inicio, fim) => {
    intervalos.push([inicio, fim]);
    return { data: origem.slice(inicio, fim + 1), error: null };
  });

  assert.deepEqual(resultado.data, origem);
  assert.equal(resultado.error, null);
  assert.deepEqual(intervalos, [[0, 999], [1000, 1999]]);
});

test("interrompe a paginação e devolve o erro recebido", async () => {
  const erro = new Error("Falha na segunda página");
  let chamadas = 0;

  const resultado = await carregarTodasPaginas<number, Error>(async () => {
    chamadas += 1;
    return chamadas === 1
      ? { data: Array.from({ length: 2 }, (_, indice) => indice), error: null }
      : { data: null, error: erro };
  }, 2);

  assert.deepEqual(resultado.data, [0, 1]);
  assert.equal(resultado.error, erro);
  assert.equal(chamadas, 2);
});
