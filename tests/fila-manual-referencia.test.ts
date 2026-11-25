import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import type { ReferenciaPedidoManual } from "../src/lib/pedido-manual-referencia";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("snapshot manual preserva origem, decisão inicial e alterações sem exigir campos nos legados", async () => {
  const { dadosPedidoFilaSchema } = await import("../src/lib/fila-fornecedor-contrato");
  const legado = { versao: 1, itens: [{ produtoId: id(1), sku: "SKU", tecido: { id: id(1), nome: "Oxford", referencia: null },
    quantidade: 1, unidade: "UN", quantidadeTecido: 2, unidadeTecido: "MT", estampa: "A", variante: null,
    corteLaser: false, tamanho: "30x30", tipoProduto: "Lenço" }] };
  assert.deepEqual(dadosPedidoFilaSchema.parse(legado), legado);
  const origemManual = { aplicativoId: id(2), vendedor: { id: 20, nome: "Vendedor", cpfCnpj: "98765432100" },
    cliente: { id: 30, nome: "Cliente", cpfCnpj: "12345678909", uf: "MG" } };
  const direcionamentoManual = { inicial: { tipo: "REGRA", regraId: id(8), regraNome: "Dentro de MG", versao: 3,
    aplicativoId: id(3), motivo: "UF principal MG" },
    alteracoes: [{ usuarioId: id(5), em: "2026-11-25T12:00:00.000Z", anteriorId: id(3), aplicativoId: id(4) }] };
  const novo = { ...legado, origemManual, direcionamentoManual };
  assert.deepEqual(dadosPedidoFilaSchema.parse(novo), novo);
  assert.equal(dadosPedidoFilaSchema.safeParse({ ...novo, direcionamentoManual: { ...direcionamentoManual,
    alteracoes: [{ ...direcionamentoManual.alteracoes[0], aplicativoId: "outra-conta" }] } }).success, false);
});

test("referência da fila mantém o autor e protege alterações concorrentes antes da gravação", async t => {
  const matriz = id(2), autorId = id(1), origemId = id(3);
  const referencia: ReferenciaPedidoManual = { aplicativoId: origemId, vendedor: { id: 20, nome: "Vendedor", cpfCnpj: null },
    cliente: { id: 30, nome: "Cliente", cpfCnpj: null, uf: "MG" } };
  let atual = { ativo: true, aplicativoId: matriz, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: 7 };
  const ordem: string[] = [];
  const tx = {
    usuario: {
      findFirst: async ({ where, select }: { where: { id: string; aplicativoId: string; ativo: boolean }; select: Record<string, boolean> }) => {
        assert.deepEqual(where, { id: autorId, aplicativoId: matriz, ativo: true });
        assert.deepEqual(Object.keys(select).sort(), ["aplicativoId", "id", "podeSelecionarFilialFornecedor", "vinculosOlistVersao"]);
        return { id: autorId, ...atual };
      },
      findUnique: async ({ where }: { where: { id: string } }) => { assert.equal(where.id, autorId); ordem.push("autor"); return atual; },
    },
    $queryRaw: async (sql: TemplateStringsArray, ...valores: unknown[]) => {
      assert.match(sql.join("?"), /FROM usuario[\s\S]*FOR SHARE/);
      assert.deepEqual(valores, [autorId]); ordem.push("lock"); return [{ id: autorId }];
    },
  };
  Object.assign(globalThis, { prisma: tx });
  const { obterAutorReferenciaFilaManual, guardaReferenciaFilaManual, validarGuardaReferenciaFilaManual } = await import("../src/lib/fila-manual-referencia");
  const autor = await obterAutorReferenciaFilaManual(autorId, matriz);
  const guarda = guardaReferenciaFilaManual(autor, referencia);
  await validarGuardaReferenciaFilaManual(tx as unknown as Prisma.TransactionClient, guarda);
  assert.deepEqual(ordem, ["lock", "autor"]);
  await t.test("vínculo, permissão, inativação ou troca de empresa invalidam a confirmação", async () => {
    for (const patch of [{ vinculosOlistVersao: 8 }, { podeSelecionarFilialFornecedor: false }, { ativo: false }, { aplicativoId: id(9) }]) {
      atual = { ...atual, ...patch };
      await assert.rejects(validarGuardaReferenciaFilaManual(tx as unknown as Prisma.TransactionClient, guarda), /Permissões ou vínculos do autor alterados/);
      atual = { ativo: true, aplicativoId: matriz, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: 7 };
    }
  });
  await assert.rejects(obterAutorReferenciaFilaManual(null, matriz), /autor do pedido não está disponível/);
  await t.test("autor e operador usam locks em ordem estável e sem duplicação", async () => {
    const { validarAtoresFilaManual } = await import("../src/lib/fila-manual-referencia");
    const operadorId = id(9), bloqueados: string[] = [];
    const comOperador = {
      usuario: { findUnique: async ({ where }: { where: { id: string } }) => where.id === operadorId
        ? { ativo: true, aplicativoId: matriz, podeGerenciarFilaPedidos: true } : atual },
      $queryRaw: async (_sql: TemplateStringsArray, valor: unknown) => { bloqueados.push(String(valor)); return [{ id: valor }]; },
    };
    await validarAtoresFilaManual(comOperador as unknown as Prisma.TransactionClient, operadorId, matriz, guarda);
    assert.deepEqual(bloqueados, [autorId, operadorId]);
  });
});
