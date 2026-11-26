import test from "node:test";
import assert from "node:assert/strict";
import { ErroCadastroOlist, resumirRejeicaoPedidoOlist } from "../src/lib/olist-errors";

test("ErrorDTO expõe apenas campos e motivos permitidos, sem mensagem bruta ou dados pessoais", () => {
  const resposta = { mensagem: "Bearer segredo", detalhes: [
    { campo: "idContato", mensagem: "CPF 12345678900 não encontrado" },
    { campo: "pagamento.parcelas[0].valor", mensagem: "valor obrigatório email@privado.test" },
    { campo: "itens[1].produto.id", mensagem: "Produto inativo" },
    { campo: "campo secreto", mensagem: "Senha" },
  ] };
  assert.equal(resumirRejeicaoPedidoOlist(resposta), "Cliente: não encontrado na conta destinatária. Parcela 1: preenchimento obrigatório. Item 2: cadastro: inativo ou bloqueado.");
  for (const v of [null, "senha", { detalhes: "segredo" }, { detalhes: [null, {}, { campo: "email@privado.test" }] }]) assert.equal(resumirRejeicaoPedidoOlist(v), "");
  assert.equal(resumirRejeicaoPedidoOlist({ detalhes: Array(100).fill({ campo: "idContato" }) }), "Cliente: valor ou configuração recusados.");
  assert.equal(resumirRejeicaoPedidoOlist({ detalhes: [{ campo: "__proto__" }, { campo: "toString" }, { campo: "constructor" }] }), "");
  assert.equal(resumirRejeicaoPedidoOlist({ detalhes: [{ campo: "$.pagamento.parcelas.0.valor", mensagem: "Obrigatório" }] }), "Parcela 1: preenchimento obrigatório.");
});

test("erros de consulta distinguem ausência, permissão, limite, rede e resposta incompatível", () => {
  assert.match(new ErroCadastroOlist("formas-recebimento", 404, "HTTP").message, /Forma de recebimento: Cadastro não encontrado/);
  assert.match(new ErroCadastroOlist("servicos", 403, "HTTP").message, /Serviço de corte a laser: A integração não tem permissão/);
  assert.match(new ErroCadastroOlist("contatos", 429, "HTTP").message, /Limite de consultas/);
  assert.match(new ErroCadastroOlist("produtos", null, "REDE").message, /não terminou/);
  assert.match(new ErroCadastroOlist("produtos", 200, "RESPOSTA").message, /cadastro diferente/);
});
