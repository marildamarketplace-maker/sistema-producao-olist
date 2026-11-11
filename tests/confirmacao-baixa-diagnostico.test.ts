import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticarErroBaixaEstoqueOlist } from "../src/lib/diagnostico-baixa-estoque-olist";

test("confirmação identifica operação e preserva erro original sem efetuar baixa", async () => {
  let erroConsulta: Error | null = null;
  const erroLock = new Error("falha privada no lock");
  let transacoes = 0;
  let escritas = 0;
  const db = {
    componenteKitEstoque: { findMany: async () => {
      if (erroConsulta) throw erroConsulta;
      return [];
    } },
    produto: {
      findMany: async () => [{ id: "produto", sku: "A" }, { id: "kit", sku: "KIT-PRIVADO" }],
      createMany: async () => { escritas++; },
    },
    itemBaixaEstoqueOlist: { findMany: async () => [] },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transacoes++;
      return callback({ $queryRaw: async () => { throw erroLock; } });
    },
  };
  Object.assign(globalThis, { prisma: db });
  const { confirmarBaixaEstoqueOlist } = await import("../src/lib/olist");
  const input = (sku: string) => ({ aplicativoId: "app", origem: "automatica" as const,
    itens: [{ sku, quantidade: 1, pedidoOlistId: "pedido", itemOlistId: "item" }],
  });
  erroConsulta = new Error("falha privada na consulta");
  await assert.rejects(confirmarBaixaEstoqueOlist(input("A")), (erro) => {
    assert.equal(erro, erroConsulta);
    assert.equal(diagnosticarErroBaixaEstoqueOlist(erro).operacao, "consultar_composicoes");
    return true;
  });
  erroConsulta = null;
  await assert.rejects(confirmarBaixaEstoqueOlist(input("KIT-PRIVADO")), (erro) => {
    assert.equal(erro, erroLock);
    assert.equal(diagnosticarErroBaixaEstoqueOlist(erro).operacao, "obter_lock");
    return true;
  });
  assert.equal(transacoes, 1);
  await assert.rejects(confirmarBaixaEstoqueOlist(input("A")), (erro) => {
    assert.equal(erro, erroLock);
    assert.equal(diagnosticarErroBaixaEstoqueOlist(erro).operacao, "obter_lock");
    return true;
  });
  assert.equal(transacoes, 2);
  assert.equal(escritas, 0);
});
