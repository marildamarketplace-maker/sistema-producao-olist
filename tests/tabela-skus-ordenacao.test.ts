import assert from "node:assert/strict";
import test from "node:test";
import { alternarOrdenacaoSku, ordenarSkus, ORDENACAO_SKU_PADRAO } from "../src/lib/anotar-sku/ordenacao";

test("tabelas SKU: quantidade numérica decrescente por padrão, desempate e preservação dos dados", () => {
  const itens = [
    { sku: "SKU10", produto: "Lenço", quantidade: 2 },
    { sku: "GRANDE", produto: "Tricoline", quantidade: 100 },
    { sku: "SKU2", produto: "Lenço", quantidade: 2 },
    { sku: "SEM", produto: null, quantidade: 2 },
    { sku: "DEZ", produto: "Oxford", quantidade: 10 },
  ];
  const antes = structuredClone(itens);
  assert.deepEqual(ordenarSkus(itens, ORDENACAO_SKU_PADRAO).map(i => i.sku), ["GRANDE", "DEZ", "SKU2", "SKU10", "SEM"]);
  assert.deepEqual(ordenarSkus(itens, { coluna: "quantidade", direcao: "asc" }).map(i => i.quantidade), [2, 2, 2, 10, 100]);
  assert.deepEqual(itens, antes);
});

test("colunas textuais ordenam nos dois sentidos, com títulos ausentes ao final", () => {
  const itens = [
    { sku: "SKU10", produto: "Tricoline", tecido: "Tricoline", quantidade: 1 },
    { sku: "SKU2", produto: "Árvore", tecido: "Fourway", quantidade: 2 },
    { sku: "SKU1", produto: null, tecido: "Oxford", quantidade: 3 },
  ];
  assert.deepEqual(ordenarSkus(itens, { coluna: "sku", direcao: "asc" }).map(i => i.sku), ["SKU1", "SKU2", "SKU10"]);
  assert.deepEqual(ordenarSkus(itens, { coluna: "sku", direcao: "desc" }).map(i => i.sku), ["SKU10", "SKU2", "SKU1"]);
  assert.deepEqual(ordenarSkus(itens, { coluna: "produto", direcao: "asc" }).map(i => i.sku), ["SKU2", "SKU10", "SKU1"]);
  assert.deepEqual(ordenarSkus(itens, { coluna: "produto", direcao: "desc" }).map(i => i.sku), ["SKU10", "SKU2", "SKU1"]);
  assert.deepEqual(ordenarSkus(itens, { coluna: "tecido", direcao: "asc" }).map(i => i.sku), ["SKU2", "SKU1", "SKU10"]);
  assert.deepEqual(ordenarSkus(itens, { coluna: "tecido", direcao: "desc" }).map(i => i.sku), ["SKU10", "SKU1", "SKU2"]);
});

test("cabeçalho alterna direção e escolhe quantidade decrescente ou texto crescente", () => {
  assert.deepEqual(alternarOrdenacaoSku(ORDENACAO_SKU_PADRAO, "quantidade"), { coluna: "quantidade", direcao: "asc" });
  const texto = alternarOrdenacaoSku(ORDENACAO_SKU_PADRAO, "produto");
  assert.deepEqual(texto, { coluna: "produto", direcao: "asc" });
  assert.deepEqual(alternarOrdenacaoSku(texto, "produto"), { coluna: "produto", direcao: "desc" });
  assert.deepEqual(alternarOrdenacaoSku(texto, "quantidade"), ORDENACAO_SKU_PADRAO);
  assert.deepEqual(ordenarSkus([], ORDENACAO_SKU_PADRAO), []);
});
