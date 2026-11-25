import assert from "node:assert/strict";
import test from "node:test";
async function carregar() {
  process.env.POSTGRES_PRISMA_URL = "postgresql://teste:teste@localhost:5432/nao_utilizado";
  return import("../src/lib/tamanhos-pedido");
}
import type { ItemPedidoManual } from "../src/lib/pedido-manual-contrato";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("tamanhos: paginação, projeção e validação de entrada limitam tráfego", async () => {
  const { consultarTamanhosPedido } = await carregar();
  const chamadas: unknown[] = [];
  const db = { tamanho: { findMany: async (args: unknown) => {
    chamadas.push(args);
    return Array.from({ length: 51 }, (_, n) => ({ id: id(n), titulo: "70 × 70", sku: "70", quantidadeProdutoFornecedor: "0.5" }));
  } } };
  const pagina = await consultarTamanhosPedido(new URLSearchParams({ busca: " 70 ", pagina: "2" }), db);
  assert.equal(pagina.itens.length, 50); assert.equal(pagina.mais, true); assert.equal(pagina.itens[0].consumo, 0.5);
  assert.deepEqual(chamadas[0], { where: { OR: [{ titulo: { contains: "70", mode: "insensitive" } }, { sku: { contains: "70", mode: "insensitive" } }] },
    select: { id: true, titulo: true, sku: true, quantidadeProdutoFornecedor: true }, orderBy: [{ titulo: "asc" }, { id: "asc" }], take: 51, skip: 50 });
  const invalidos: Record<string, string>[] = [{ pagina: "0" }, { pagina: "1.5" }, { pagina: "10001" }, { busca: "x".repeat(101) }];
  for (const params of invalidos)
    await assert.rejects(consultarTamanhosPedido(new URLSearchParams(params), db));
  assert.equal(chamadas.length, 1);
});
test("servidor revalida consumo e total em uma consulta; ajuste manual não consulta catálogo", async () => {
  const { validarMetragensPedido, ErroMetragemPedido } = await carregar();
  let consultas = 0;
  const db = { tamanho: { findMany: async () => { consultas++; return [{ id: id(8), sku: "70", quantidadeProdutoFornecedor: "0.5" }]; } } };
  const item: ItemPedidoManual = { id: id(1), tecidoNome: "Oxford", modalidade: "PRODUTO_SUBLIMADO", quantidade: 30, quantidadeTecido: 15,
    estampa: "6861", variante: "A", tamanho: "70", tamanhoId: id(8), tipoProduto: "Lenço", corteLaser: false, modoMetragem: "AUTOMATICA", consumoUnidade: 0.5 };
  await validarMetragensPedido([item, { ...item, id: id(2) }], db); assert.equal(consultas, 1);
  for (const patch of [{ quantidadeTecido: 16 }, { consumoUnidade: 0.8 }, { tamanhoId: id(9) }, { tamanho: "90" }])
    await assert.rejects(validarMetragensPedido([{ ...item, ...patch }], db), (erro: unknown) => {
      assert.ok(erro instanceof ErroMetragemPedido);
      assert.equal(erro.status, 409); assert.equal(erro.codigo, "ITENS_METRAGEM_DESATUALIZADA");
      return true;
    });
  const antes = consultas;
  await validarMetragensPedido([{ ...item, modoMetragem: "MANUAL", quantidadeTecido: 16 }], db);
  assert.equal(consultas, antes);
});
