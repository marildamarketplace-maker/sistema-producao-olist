import assert from "node:assert/strict";
import test from "node:test";
import { selecionarProdutoOlistPrioritario } from "../src/lib/produto-olist-importacao";

test("seleciona o cadastro com data de criação mais recente", () => {
  const antigo = {
    id: "1",
    ativo: true,
    dataCriacao: "2026-01-10T10:00:00-03:00",
    dataAlteracao: "2026-09-10T10:00:00-03:00",
  };
  const novo = {
    id: "2",
    ativo: true,
    dataCriacao: "2026-08-10T10:00:00-03:00",
    dataAlteracao: "2026-08-10T10:00:00-03:00",
  };

  assert.equal(selecionarProdutoOlistPrioritario(antigo, novo), novo);
});

test("usa a data de alteração quando a criação não está disponível", () => {
  const antigo = { id: "1", ativo: true, dataAlteracao: "2026-01-10T10:00:00-03:00" };
  const novo = { id: "2", ativo: true, dataAlteracao: "2026-08-10T10:00:00-03:00" };

  assert.equal(selecionarProdutoOlistPrioritario(antigo, novo), novo);
});

test("mantém o primeiro cadastro quando as datas empatam ou são inválidas", () => {
  const primeiro: { id: string; ativo: boolean; dataCriacao: string | null } = {
    id: "1",
    ativo: true,
    dataCriacao: "data inválida",
  };
  const segundo: { id: string; ativo: boolean; dataCriacao: string | null } = {
    id: "2",
    ativo: true,
    dataCriacao: null,
  };

  assert.equal(selecionarProdutoOlistPrioritario(primeiro, segundo), primeiro);
});

test("prioriza o cadastro ativo mesmo quando ele é mais antigo", () => {
  const ativo = {
    id: "1",
    ativo: true,
    dataCriacao: "2026-01-10T10:00:00-03:00",
  };
  const inativoMaisNovo = {
    id: "2",
    ativo: false,
    dataCriacao: "2026-08-10T10:00:00-03:00",
  };

  assert.equal(selecionarProdutoOlistPrioritario(ativo, inativoMaisNovo), ativo);
  assert.equal(selecionarProdutoOlistPrioritario(inativoMaisNovo, ativo), ativo);
});
