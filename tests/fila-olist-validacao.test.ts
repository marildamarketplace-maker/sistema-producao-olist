import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { selecoesFilaOlistSchema } from "../src/lib/fila-olist-contrato";
import { detalharErrosFilaOlist, errosComerciaisCriacao, exigirComerciaisCriacao } from "../src/lib/fila-olist-validacao";
const uuid = "00000000-0000-0000-0000-000000000001";
const selecoes = { recursoForma: "RECEBIMENTO" as const, clienteId: 1, vendedorId: 2, formaId: 3, planoId: uuid, tipoVenda: "VENDA", tecidos: [{ tecidoId: uuid, id: 4, preco: 18.99 }], laser: null };
test("identifica plano pendente tanto no contrato direto quanto no corpo da API", () => {
  for (const schema of [selecoesFilaOlistSchema, z.object({ selecoes: selecoesFilaOlistSchema })]) {
    const dados = { ...selecoes, planoId: "" };
    const parsed = schema.safeParse(schema === selecoesFilaOlistSchema ? dados : { selecoes: dados }); assert.equal(parsed.success, false);
    if (!parsed.success) assert.deepEqual(detalharErrosFilaOlist(parsed.error).campos, { planoId: "Selecione um plano de recebimento associado à forma escolhida." });
  }
});
test("detalha todos os campos inválidos e identifica produto e preço por posição", () => {
  const parsed = selecoesFilaOlistSchema.safeParse({ ...selecoes, clienteId: 0, vendedorId: 0, formaId: 0, tipoVenda: "", tecidos: [{ tecidoId: uuid, id: 0, preco: null }], laser: { id: 0, preco: -1 } });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const r = detalharErrosFilaOlist(parsed.error);
    assert.equal(Object.keys(r.campos).length, 8); assert.match(r.campos["tecidos.0.preco"], /Produto 1.*preço/);
    assert.match(r.campos["laser.preco"], /preço.*corte a laser/); assert.match(r.error, /cliente/);
  }
});
test("erro interno desconhecido não expõe valores, mensagens brutas ou caminhos", () => {
  const erro = new z.ZodError([{ code: "custom", path: ["credencialInterna"], message: "TOKEN PRIVADO SQL" }]);
  const r = detalharErrosFilaOlist(erro);
  assert.deepEqual(r.campos, {}); assert.ok(!/TOKEN|SQL|credencialInterna/.test(JSON.stringify(r)));
});

test("criação exige forma/plano sempre e serviço/preço somente quando há laser", () => {
  assert.deepEqual(Object.keys(errosComerciaisCriacao({}, false)), ["formaId", "planoId"]);
  assert.deepEqual(errosComerciaisCriacao({ recursoForma: "RECEBIMENTO" as const, formaId: 1, planoId: uuid }, false), {});
  assert.ok(errosComerciaisCriacao({ recursoForma: "RECEBIMENTO" as const, formaId: 1, planoId: uuid }, true).laser);
  assert.ok(errosComerciaisCriacao({ recursoForma: "RECEBIMENTO" as const, formaId: 1, planoId: uuid, laser: { id: 2 } }, true)["laser.preco"]);
  assert.deepEqual(errosComerciaisCriacao({ recursoForma: "RECEBIMENTO" as const, formaId: 1, planoId: uuid, laser: { id: 2, preco: 0 } }, true), {});
  assert.throws(() => exigirComerciaisCriacao({ recursoForma: "RECEBIMENTO" as const, formaId: 1, planoId: uuid }, true), z.ZodError);
});
