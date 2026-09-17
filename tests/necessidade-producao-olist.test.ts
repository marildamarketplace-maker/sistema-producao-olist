import assert from "node:assert/strict";
import test from "node:test";
import { calcularNecessidadeProducaoOlist } from "../src/lib/necessidade-producao-olist";

test("não cria novo item quando estoque e produção existente cobrem a demanda", () => {
  const resultado = calcularNecessidadeProducaoOlist({
    estoqueAtual: 2,
    quantidadePedidos: 8,
    quantidadeEmProducao: 6,
    metaEstoque: 4,
    minimoEstoque: 2,
  });

  assert.equal(resultado.tipo, "COBERTO_POR_PRODUCAO_EXISTENTE");
  assert.equal(resultado.quantidadeDisponivel, 8);
});

test("mantém nova solicitação e desconta a produção existente quando a cobertura é insuficiente", () => {
  const resultado = calcularNecessidadeProducaoOlist({
    estoqueAtual: 2,
    quantidadePedidos: 10,
    quantidadeEmProducao: 3,
    metaEstoque: 4,
    minimoEstoque: 0,
  });

  assert.equal(resultado.tipo, "NOVA_PRODUCAO");
  if (resultado.tipo !== "NOVA_PRODUCAO") return;
  assert.equal(resultado.quantidadeSolicitada, 10);
  assert.equal(resultado.prioridade, true);
});

test("preserva o cálculo anterior quando não existe produção em andamento", () => {
  const resultado = calcularNecessidadeProducaoOlist({
    estoqueAtual: 2,
    quantidadePedidos: 10,
    quantidadeEmProducao: 0,
    metaEstoque: 4,
    minimoEstoque: 0,
  });

  assert.equal(resultado.tipo, "NOVA_PRODUCAO");
  if (resultado.tipo !== "NOVA_PRODUCAO") return;
  assert.equal(resultado.quantidadeSolicitada, 12);
});

test("produção existente suficiente evita nova solicitação mesmo abaixo do estoque mínimo", () => {
  const resultado = calcularNecessidadeProducaoOlist({
    estoqueAtual: 0,
    quantidadePedidos: 3,
    quantidadeEmProducao: 3,
    metaEstoque: 4,
    minimoEstoque: 2,
  });

  assert.equal(resultado.tipo, "COBERTO_POR_PRODUCAO_EXISTENTE");
});

test("classifica como estoque suficiente quando o estoque atende a demanda e o mínimo", () => {
  const resultado = calcularNecessidadeProducaoOlist({
    estoqueAtual: 12,
    quantidadePedidos: 5,
    quantidadeEmProducao: 0,
    metaEstoque: 10,
    minimoEstoque: 2,
  });

  assert.equal(resultado.tipo, "ESTOQUE_SUFICIENTE");
  assert.equal(resultado.quantidadeDisponivel, 12);
  assert.equal(resultado.estoqueProjetado, 7);
});
