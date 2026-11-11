import assert from "node:assert/strict";
import test from "node:test";
import { gerarSimulacaoMetragemCsv } from "../src/lib/estoque-simulacao-metragem";
const linha = { sku: "SKU", qtd_movimentacoes: 2, total_entradas: 10, total_saidas: 12, saldo_atual: -2,
  produto_fornecido: { nome: "Tecido", metros_por_unidade: 1.25 } };
test("simula cada base, preservando saldo negativo e precisão do consumo", () => {
  for (const [base, total] of [["total_entradas", "12,5000"], ["total_saidas", "15,0000"], ["saldo_atual", "-2,5000"]] as const) {
    assert.ok(gerarSimulacaoMetragemCsv([linha], base).includes(`"${total}";"Calculado"`));
  }
});
test("sinaliza ausência e consumo inválido sem exportar metragem zero fictícia", () => {
  assert.ok(gerarSimulacaoMetragemCsv([{ ...linha, produto_fornecido: null }], "total_entradas").includes('"";"Sem produto fornecido"'));
  for (const consumo of [0, -1, NaN, Infinity]) {
    assert.ok(gerarSimulacaoMetragemCsv([{ ...linha, produto_fornecido: { nome: "Tecido", metros_por_unidade: consumo } }], "total_entradas").includes('"";"Consumo inválido"'));
  }
});
test("inclui saldo zero com movimentações, exclui produto sem movimentos e escapa texto e fórmulas", () => {
  const csv = gerarSimulacaoMetragemCsv([{ ...linha, sku: '=SUM(1;2)', saldo_atual: 0, produto_fornecido: { nome: 'Tecido "A"\nB', metros_por_unidade: 0.1234 } }, { ...linha, sku: "SEM", qtd_movimentacoes: 0 }], "saldo_atual");
  assert.ok(csv.includes('"\'=SUM(1;2)"'));
  assert.ok(csv.includes('Tecido ""A""\nB'));
  assert.ok(csv.includes('"0,0000";"Calculado"'));
  assert.ok(!csv.includes('"SEM"'));
});
