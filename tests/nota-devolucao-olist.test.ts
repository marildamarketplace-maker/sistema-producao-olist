import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { criarValidadorNotaDevolucao } from "../src/lib/nota-devolucao-olist";

type Registro = Record<string, unknown>;
function ambiente() {
  let existe = true;
  let pedido: Registro = { id: 123, idNotaFiscal: 900, cliente: { cpfCnpj: "000.000.000-00" } };
  let diretas: Registro[] = [], cliente: Registro[] = [];
  const detalhes = new Map<string, Registro>();
  const chamadas: string[] = [];
  let falha = false;
  const db = { retornoEstoqueOlist: { findFirst: async ({ where }: { where: { id: string; aplicativoId: string } }) => {
    assert.equal(where.aplicativoId, "app"); assert.equal(where.id, "retorno");
    return existe ? { itens: [ { itemBaixa: { pedidoOlistId: "123" } }, { itemBaixa: { pedidoOlistId: "123" } } ] } : null;
  } } } as unknown as Pick<PrismaClient, "retornoEstoqueOlist">;
  const validar = criarValidadorNotaDevolucao(db, {
    obterPedido: async (app, id) => { assert.equal(app, "app"); chamadas.push(`pedido:${id}`); return pedido; },
    listarNotas: async (app, filtros) => { assert.equal(app, "app"); if (falha) throw new Error("429 TOKEN-SECRETO");
      chamadas.push(filtros.idVenda ? `venda:${filtros.idVenda}` : "documento"); return filtros.idVenda ? diretas : cliente; },
    obterNota: async (app, id) => { assert.equal(app, "app"); chamadas.push(`nota:${id}`); if (!detalhes.has(id)) throw new Error("Detalhe indisponível"); return detalhes.get(id)!; },
  });
  return { validar: () => validar("app", "retorno"), chamadas, detalhes,
    inexistente: () => { existe = false; }, pedido: (p: Registro) => { pedido = p; }, falhar: () => { falha = true; },
    diretas: (notas: Registro[]) => { diretas = notas; }, cliente: (notas: Registro[]) => { cliente = notas; },
  };
}
const devolucao = { id: 100, numero: "1234", serie: "1", tipo: "E", finalidade: 4, situacao: 6, origem: { tipo: "venda", id: "123" } };

test("valida nota de devolução vinculada e preserva a situação fiscal", async () => {
  const a = ambiente(); a.diretas([devolucao]); a.detalhes.set("100", devolucao);
  const r = await a.validar();
  assert.equal(r.pedidos.length, 1); // Dois SKUs do mesmo pedido exigem só uma consulta.
  assert.equal(r.pedidos[0].estado, "encontrada");
  assert.deepEqual(r.pedidos[0].notas[0], { id: "100", numero: "1234", serie: "1", situacao: "Autorizada", autorizada: true });
  assert.equal(a.chamadas.filter((c) => c === "pedido:123").length, 1);
});

test("nota clonada da NF original é encontrada pelo documento e referência exata", async () => {
  const a = ambiente(); const nota = { ...devolucao, origem: { tipo: "notafiscal", id: "900" } };
  a.cliente([nota]); a.detalhes.set("100", nota);
  assert.equal((await a.validar()).pedidos[0].estado, "encontrada");
});

test("nota de outro pedido do mesmo cliente não é aceita nem detalhada", async () => {
  const a = ambiente(); a.cliente([{ ...devolucao, origem: { tipo: "venda", id: "999" } }]);
  assert.equal((await a.validar()).pedidos[0].estado, "nao_encontrada");
  assert.ok(!a.chamadas.includes("nota:100"));
});

test("pendente, cancelada e rejeitada não são apresentadas como autorizadas", async () => {
  for (const [situacao, texto] of [[1, "Pendente"], [3, "Cancelada"], [5, "Rejeitada"]] as const) {
    const a = ambiente(); a.diretas([devolucao]); a.detalhes.set("100", { ...devolucao, situacao });
    const resultado = (await a.validar()).pedidos[0];
    assert.equal(resultado.notas[0].situacao, texto);
    assert.equal(resultado.notas[0].autorizada, false);
    assert.match(resultado.mensagem, /autorização não foi confirmada/);
  }
});

test("exige entrada e finalidade de devolução, incluindo finalidade 8", async () => {
  for (const alteracao of [{ tipo: "S" }, { finalidade: 1 }]) {
    const a = ambiente(); a.diretas([devolucao]); a.detalhes.set("100", { ...devolucao, ...alteracao });
    assert.equal((await a.validar()).pedidos[0].estado, "nao_encontrada");
  }
  const a = ambiente(); a.diretas([devolucao]); a.detalhes.set("100", { ...devolucao, finalidade: 8 });
  assert.equal((await a.validar()).pedidos[0].estado, "encontrada");
});

test("nota de devolução sem vínculo comprovado é inconclusiva", async () => {
  const a = ambiente(); const nota = { ...devolucao, origem: { tipo: "devolucao", id: "555" } };
  a.cliente([nota]); a.detalhes.set("100", nota);
  assert.equal((await a.validar()).pedidos[0].estado, "inconclusiva");
});

test("falhas ou detalhes incompletos nunca confirmam ausência e não expõem o erro original", async () => {
  const a = ambiente(); a.falhar();
  const resposta = await a.validar();
  assert.equal(resposta.pedidos[0].estado, "erro"); assert.ok(!JSON.stringify(resposta).includes("TOKEN-SECRETO"));
  const b = ambiente(); b.diretas([devolucao]);
  assert.equal((await b.validar()).pedidos[0].estado, "erro");
  b.detalhes.set("100", { ...devolucao, finalidade: null });
  assert.equal((await b.validar()).pedidos[0].estado, "erro");
  b.detalhes.set("100", { ...devolucao, tipo: undefined });
  assert.equal((await b.validar()).pedidos[0].estado, "erro");
  b.detalhes.set("100", { ...devolucao, id: 999 });
  assert.equal((await b.validar()).pedidos[0].estado, "erro");
});

test("retorno de outro aplicativo ou inexistente é rejeitado antes da consulta Olist", async () => {
  const a = ambiente(); a.inexistente(); await assert.rejects(a.validar(), /não encontrado/); assert.equal(a.chamadas.length, 0);
});

test("ausência de NF original/documento não provoca busca ampla por notas de clientes", async () => {
  const a = ambiente(); a.pedido({ id: 123 });
  assert.equal((await a.validar()).pedidos[0].estado, "nao_encontrada");
  assert.deepEqual(a.chamadas, ["pedido:123", "venda:123"]);
});

test("somente situação 6 confirma autorização; situação ausente ou intermediária não comprova autorização", async () => {
  for (const situacao of [undefined, null, 1, 2, 3, 4, 5, 7, 8, 9, 10, "desconhecida", 6, "6"]) {
    const a = ambiente(); a.diretas([devolucao]); a.detalhes.set("100", { ...devolucao, situacao });
    const pedido = (await a.validar()).pedidos[0];
    assert.equal(pedido.estado, "encontrada");
    assert.equal(pedido.notas[0].autorizada, String(situacao) === "6");
    if (String(situacao) === "6") assert.match(pedido.mensagem, /com autorização confirmada/);
  }
});
