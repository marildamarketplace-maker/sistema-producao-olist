import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { pedidoProducaoSchema, origemPedidoProducaoSchema } from "../src/lib/pedido-producao-contrato";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = { id: id(1), tecidoNome: "Oxford", quantidade: 2, quantidadeTecido: 3.5, estampa: "6861", variante: "A", tamanho: "30x30", tipoProduto: "LENCO", corteLaser: true };
const entrada = { versao: 2, chaveIdempotencia: id(2), aplicativoId: id(3), revisaoProducao: "a".repeat(64), observacao: "Compra",
  origemManual: { aplicativoId: id(3), vendedor: { id: 1, nome: "Vendedor", cpfCnpj: null }, cliente: { id: 2, nome: "Cliente", cpfCnpj: "04252011000110", uf: null } },
  decisaoDirecionamento: { tipo: "CONTA_UNICA", regraId: null, regraNome: null, versao: 0, aplicativoId: id(3), motivo: "Conta" },
  selecoes: { clienteId: 2, vendedorId: 1 }, itens: [item] };

test("produção permite até 1.000 linhas e rejeita vazias, duplicadas e valores inválidos", () => {
  assert.equal(pedidoProducaoSchema.safeParse(entrada).success, true);
  assert.equal(pedidoProducaoSchema.safeParse({ ...entrada, itens: Array.from({ length: 1000 }, (_, i) => ({ ...item, id: id(i + 10) })) }).success, true);
  for (const itens of [[], [item, item], Array.from({ length: 1001 }, (_, i) => ({ ...item, id: id(i + 10) })), [{ ...item, quantidade: 1.5 }], [{ ...item, quantidadeTecido: 0 }]]) {
    assert.equal(pedidoProducaoSchema.safeParse({ ...entrada, itens }).success, false);
  }
  assert.equal(pedidoProducaoSchema.safeParse({ ...entrada, selecoes: { ...entrada.selecoes, tecidos: [{ tecidoId: id(99), id: 20, preco: 1 }] } }).success, false);
});
test("origem pode conter tecido/consumo pendentes, mas envio exige completar dados", () => {
  const itens = [{ ...item, tecidoNome: "", quantidadeTecido: 0 }];
  assert.equal(origemPedidoProducaoSchema.safeParse({ itens, observacao: null, revisao: "a".repeat(64), revisaoFonte: "b".repeat(64) }).success, true);
  assert.equal(pedidoProducaoSchema.safeParse({ ...entrada, itens }).success, false);
});
test("snapshot final preserva linhas originais por identidade, permite remoção/reordenação e não inventa SKU novo", async () => {
  process.env.POSTGRES_PRISMA_URL = "postgresql://fake:fake@localhost:5432/fake";
  const { montarSnapshotPedidoProducao } = await import("../src/lib/pedido-producao-origem");
  const originais = [{ id: id(1), produtoId: id(30), sku: "EST/6861-A/" }, { id: id(7), produtoId: id(31), sku: "REMOVIDO" }];
  const parsed = pedidoProducaoSchema.parse({ ...entrada, itens: [{ ...item, id: id(8), tecidoNome: "Novo", corteLaser: false }, { ...item, quantidade: 9 }] });
  const antes = structuredClone(originais);
  const snapshot = montarSnapshotPedidoProducao(parsed, originais);
  assert.deepEqual(snapshot.itens.map(i => i.sku), ["", "EST/6861-A/"]);
  assert.deepEqual(snapshot.itens.map(i => i.produtoId), [id(8), id(1)]);
  assert.equal(snapshot.itens[1].quantidade, 9);
  assert.equal(snapshot.itens[1].quantidadeTecido, 3.5);
  assert.equal(snapshot.itens[1].unidade, "UN"); assert.equal(snapshot.itens[1].unidadeTecido, "MT");
  assert.deepEqual(originais, antes);
});

test("origem é limitada, projetada e revisão independe de campos extras do fornecedor", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  let quantidade = 2;
  const itens = [{ id: id(1), produtoId: id(30), sku: "EST/6861-A/", quantidadeSolicitada: quantidade, tipoCorte: "LASER" }];
  const db = {
    solicitacaoProducao: { findFirst: async () => ({ observacaoGeral: "Origem" }) },
    itemSolicitacaoProducao: { findMany: async ({ select, take }: { select: Record<string, boolean>; take: number }) => {
      assert.equal(take, 1001); assert.equal(select.sku, true); assert.equal(select.imagemUrl, undefined); return itens.map(i => ({ ...i, quantidadeSolicitada: quantidade }));
    } },
    produtoOlistProdutoFornecedor: { findMany: async ({ select, take }: { select: Record<string, unknown>; take: number }) => {
      assert.equal(take, 1001); assert.ok(select.produtoFornecedor); return [];
    } },
  };
  const cliente = db as unknown as Prisma.TransactionClient;
  const { carregarOrigemPedidoProducao } = await import("../src/lib/pedido-producao-origem");
  const fornecedor = { fornecedorId: id(4), matrizId: id(5) };
  const a = await carregarOrigemPedidoProducao(id(2), id(6), fornecedor, id(3), cliente);
  const b = await carregarOrigemPedidoProducao(id(2), id(6), { ...fornecedor, autorId: "extra" } as typeof fornecedor, id(3), cliente);
  assert.equal(a.revisao, b.revisao); assert.equal(a.itens[0].id, id(1)); assert.equal(a.itens[0].tecidoNome, "");
  quantidade = 3;
  assert.notEqual((await carregarOrigemPedidoProducao(id(2), id(6), fornecedor, id(3), cliente)).revisao, a.revisao);
});
