import test from "node:test";
import assert from "node:assert/strict";
import { esperaEnvioOlist, exigirPrazoEnvioOlist, ErroEsperaEnvioOlist } from "../src/lib/fila-olist-espera";
import { camposRejeicaoPedidoOlist } from "../src/lib/olist-errors";

test("prazo usa somente a tentativa atual e não libera resultados incertos", () => {
  const base = { estado: "REJEITADO", tentativaId: "atual", diagnostico: "HTTP 429", iniciadoEm: "2026-11-26T13:00:00Z", historico: [
    { acao: "LIMITE_REQUISICOES", tentativaId: "antiga", tentarNovamenteEm: "2026-11-26T15:00:00Z" },
    { acao: "LIMITE_REQUISICOES", tentativaId: "atual", tentarNovamenteEm: "2026-11-26T13:02:00Z" },
  ] };
  assert.equal(esperaEnvioOlist(base).tentarNovamenteEm, "2026-11-26T13:02:00.000Z");
  assert.throws(() => exigirPrazoEnvioOlist(base, Date.parse("2026-11-26T13:01:00Z")), ErroEsperaEnvioOlist);
  assert.doesNotThrow(() => exigirPrazoEnvioOlist(base, Date.parse("2026-11-26T13:02:00Z")));
  assert.deepEqual(esperaEnvioOlist({ ...base, estado: "INCERTO" }), { limitado: false, tentarNovamenteEm: null });
  assert.equal(esperaEnvioOlist({ ...base, historico: [] }).tentarNovamenteEm, "2026-11-26T13:01:00.000Z");
  assert.equal(esperaEnvioOlist({ ...base, diagnostico: "HTTP 400", historico: [] }).limitado, false);
});

test("rejeições comerciais indicam apenas campos conhecidos, sem conteúdo privado", () => {
  assert.deepEqual(camposRejeicaoPedidoOlist({ detalhes: [
    { campo: "pagamento.formaRecebimento.id", mensagem: "segredo de cliente" },
    { campo: "$.pagamento.parcelas.0.valor", mensagem: "obrigatório token privado" },
    { campo: "__proto__", mensagem: "privado" },
  ] }), { formaId: "Forma de recebimento: valor ou configuração recusados.", planoId: "Parcela 1: preenchimento obrigatório." });
});
