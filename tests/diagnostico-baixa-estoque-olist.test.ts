import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticarErroBaixaEstoqueOlist } from "../src/lib/diagnostico-baixa-estoque-olist";
import { expandirItemKit } from "../src/lib/kits-estoque";

test("erro real de kit sem composição orienta o cadastro sem expor SKU", () => {
  assert.throws(() => expandirItemKit({ sku: "KIT-PRIVADO", quantidade: 1 }, []), (error) => {
    const diagnostico = diagnosticarErroBaixaEstoqueOlist(error);
    assert.equal(diagnostico.motivo, "Kit sem composição cadastrada. Cadastre em Produtos → Associação de kits.");
    assert.doesNotMatch(JSON.stringify(diagnostico), /PRIVADO/);
    return true;
  });
});

test("reconhece timeout de transação sem registrar a mensagem original", () => {
  const erro = new Error("Transaction already closed: transaction expired. SQL privado");
  assert.equal(diagnosticarErroBaixaEstoqueOlist(erro).motivo, "Tempo limite da transação de baixa excedido.");
});

test("classifica falhas conhecidas sem expor os dados da mensagem", () => {
  for (const [mensagem, motivo] of [
    ["Token inválido ou sem permissão.", "Falha de autenticação ou integração Olist desconectada."],
    ["Erro Olist 429", "Limite de requisições da Olist atingido."],
    ["Erro Tiny 503", "Falha HTTP 503 na API Olist."],
    ["Baixa duplicada bloqueada para pedido/item: privado", "Baixa duplicada bloqueada."],
    ["Pedido Olist privado retornou sem itens para baixa automatica.", "Pedido retornou sem itens para baixa."],
    ["Pedido Olist privado retornou item invalido para baixa automatica.", "Item sem SKU ou com quantidade inválida."],
    ["Composição do kit alterada durante a baixa.", "Composição do kit alterada durante a baixa."],
  ]) {
    assert.equal(diagnosticarErroBaixaEstoqueOlist(new Error(mensagem)).motivo, motivo);
  }
});

test("erros de banco expõem somente código permitido", () => {
  const erro = Object.assign(new Error("SQL contendo credenciais"), { code: "P2028", meta: { segredo: "privado" } });
  assert.deepEqual(diagnosticarErroBaixaEstoqueOlist(erro), {
    tipoErro: "Error", motivo: "Falha na operação de banco de dados.", codigoBanco: "P2028",
  });
});

test("falhas desconhecidas e nomes maliciosos não vazam informações", () => {
  const erro = Object.assign(new Error("Bearer segredo email@privado.test"), { name: "segredo", code: "token-secreto" });
  for (const entrada of [erro, "segredo", null, { message: "segredo" }]) {
    const diagnostico = diagnosticarErroBaixaEstoqueOlist(entrada);
    assert.equal(diagnostico.motivo, "Falha não classificada; investigar a etapa indicada.");
    assert.doesNotMatch(JSON.stringify(diagnostico), /segredo|privado/);
  }
});
