import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticarErroBaixaEstoqueOlist } from "../src/lib/diagnostico-baixa-estoque-olist";

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
