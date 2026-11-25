import assert from "node:assert/strict";
import test from "node:test";
import { itemPedidoManualSchema, montarDadosPedidoManual, pedidoManualSchema, type ItemPedidoManual } from "../src/lib/pedido-manual-contrato";
import { alterarPecas, metrosPedido, selecionarTamanho, trocarModalidade, resumirItensPedido } from "../src/lib/itens-pedido-producao";
import { dadosPedidoFilaSchema } from "../src/lib/fila-fornecedor-contrato";
import { montarPedidoFornecedor } from "../src/lib/pedido-fornecedor-montagem";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const produto = (): ItemPedidoManual => ({ id: id(1), tecidoNome: "Oxford", modalidade: "PRODUTO_SUBLIMADO", quantidade: 30, quantidadeTecido: 15,
  estampa: "6861", variante: "A", tamanho: "70", tamanhoId: id(8), tipoProduto: "Lenço", corteLaser: false, modoMetragem: "AUTOMATICA", consumoUnidade: 0.5 });
test("modalidades rejeitam combinações incompatíveis e preservam metros ao trocar", () => {
  const original = produto();
  const liso = { ...original, ...trocarModalidade(original, "TECIDO_LISO") };
  assert.equal(itemPedidoManualSchema.safeParse(liso).success, true);
  assert.equal(liso.quantidade, 0); assert.equal(liso.quantidadeTecido, 15);
  for (const patch of [{ quantidade: 1 }, { tamanho: "70" }, { corteLaser: true }, { estampa: "x" }, { variante: "A" }])
    assert.equal(itemPedidoManualSchema.safeParse({ ...liso, ...patch }).success, false);
  const corrido = { ...original, ...trocarModalidade(original, "TECIDO_SUBLIMADO") };
  assert.equal(itemPedidoManualSchema.safeParse(corrido).success, true);
  assert.equal(itemPedidoManualSchema.safeParse({ ...corrido, variante: null }).success, false);
  assert.equal(itemPedidoManualSchema.safeParse({ ...original, tipoProduto: "" }).success, false);
});
test("cálculo, ajuste e troca de tamanho conservam valores explícitos por item", () => {
  assert.equal(metrosPedido(3, 0.3333), 0.9999);
  const original = produto();
  assert.equal(alterarPecas(original, 40).quantidadeTecido, 20);
  const manual = { ...original, modoMetragem: "MANUAL" as const, quantidadeTecido: 16 };
  const alterado = { ...manual, ...alterarPecas(manual, 40) };
  assert.equal(alterado.quantidadeTecido, 16); assert.equal(alterado.revisarMetragem, true);
  assert.equal(itemPedidoManualSchema.safeParse(alterado).success, false);
  const mesmoTamanho = { id: original.tamanhoId!, sku: original.tamanho, titulo: "70 × 70", consumo: 0.5 };
  assert.equal(selecionarTamanho(manual, mesmoTamanho).quantidadeTecido, 15, "Selecionar novamente o tamanho restaura o cálculo automático");
  const tamanho = { id: id(9), sku: "90", titulo: "90 × 90", consumo: 0.8 };
  assert.equal(selecionarTamanho(manual, tamanho).quantidadeTecido, 24);
  assert.equal(({ ...manual, ...selecionarTamanho(manual, tamanho, true) }).quantidadeTecido, 16);
  assert.equal(selecionarTamanho(manual, { ...tamanho, consumo: null }).modoMetragem, "MANUAL");
});
test("snapshot misto e montagem Olist cobram metros e descrevem produtos em peças mesmo sem laser", () => {
  const p = produto(); const liso = { ...p, ...trocarModalidade(p, "TECIDO_LISO"), id: id(2), quantidadeTecido: 2.5 };
  const corrido = { ...p, ...trocarModalidade(p, "TECIDO_SUBLIMADO"), id: id(3), quantidadeTecido: 4 };
  const entrada = pedidoManualSchema.parse({ versao: 2, aplicativoId: id(4), chaveIdempotencia: id(5), observacao: null,
    origemManual: { aplicativoId: id(4), vendedor: { id: 20, nome: "Vendedor", cpfCnpj: null }, cliente: { id: 30, nome: "Cliente", cpfCnpj: null, uf: "MG" } },
    decisaoDirecionamento: { tipo: "CONTA_UNICA", regraId: null, regraNome: null, versao: 0, aplicativoId: id(4), motivo: "Conta única" },
    selecoes: { vendedorId: 20, clienteId: 30 }, itens: [liso, corrido, p] });
  const snapshot = dadosPedidoFilaSchema.parse(montarDadosPedidoManual(entrada));
  assert.deepEqual(snapshot.itens.map(i => [i.quantidade, i.unidade]), [[2.5, "MT"], [4, "MT"], [30, "UN"]]);
  assert.deepEqual(resumirItensPedido([liso, corrido, { ...p, corteLaser: true }]), { pecas: 30, metros: 21.5, laser: 15 });
  const payload = montarPedidoFornecedor(snapshot.itens.map(i => ({ referencia: "123", nome: "Oxford", preco: 10,
    quantidade: i.quantidadeTecido, quantidadeSolicitada: i.quantidade, unidadeSolicitada: i.unidade,
    sku: i.sku, estampa: i.estampa, variante: i.variante ?? "", laser: i.corteLaser, tamanho: i.tamanho, tipo: i.tipoProduto })),
    { clienteId: 30, vendedorId: 20, formaId: 1, plano: "a vista" });
  assert.equal(payload.itens[0].quantidade, 21.5);
  assert.match(payload.observacoesInternas, /30/);
});

test("produto sublimado inicia com laser e preserva desmarcação explícita", () => {
  const original = produto();
  const novo = { ...original, modalidade: undefined };
  assert.equal(trocarModalidade(novo, "PRODUTO_SUBLIMADO").corteLaser, true);
  assert.equal(trocarModalidade({ ...original, modalidade: "TECIDO_SUBLIMADO" }, "PRODUTO_SUBLIMADO").corteLaser, true);
  assert.equal(trocarModalidade(original, "PRODUTO_SUBLIMADO").corteLaser, false);
  assert.equal(trocarModalidade({ ...original, corteLaser: true }, "TECIDO_SUBLIMADO").corteLaser, false);
});
