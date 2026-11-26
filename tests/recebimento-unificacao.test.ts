import test from "node:test";
import assert from "node:assert/strict";
import { criarRascunhoFilaOlist, serializarRascunhoFilaOlist, selecoesFilaOlistSchema, dadosOlistFilaSchema } from "../src/lib/fila-olist-contrato";
import { exigirComerciaisCriacao } from "../src/lib/fila-olist-validacao";
import { configuracaoSchema, filtrosSchema } from "../src/lib/olist-sync/validacao";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const legado = { clienteId: 10, vendedorId: 20, formaId: 30, planoId: id(4), tipoVenda: "VENDA" as const, tecidos: [{ tecidoId: id(5), id: 40, preco: 0 }], laser: { id: 50, preco: 2 } };

test("leitura histórica não reinterpreta IDs; somente forma/plano são descartados no editor", () => {
  assert.deepEqual(dadosOlistFilaSchema.parse({ filialId: id(1), selecoes: legado }).selecoes, legado);
  const r = criarRascunhoFilaOlist([id(5)], legado);
  assert.equal(r.formaId, 0); assert.equal(r.planoId, "");
  assert.equal(r.clienteId, 10); assert.equal(r.vendedorId, 20); assert.deepEqual(r.tecidos, legado.tecidos); assert.deepEqual(r.laser, legado.laser);
  assert.equal(serializarRascunhoFilaOlist(r).recursoForma, "RECEBIMENTO");
  assert.equal(selecoesFilaOlistSchema.safeParse(legado).success, false);
  assert.throws(() => exigirComerciaisCriacao(legado, true));
  const novo = { ...legado, recursoForma: "RECEBIMENTO" as const };
  assert.equal(selecoesFilaOlistSchema.safeParse(novo).success, true);
  assert.equal(criarRascunhoFilaOlist([id(5)], novo).formaId, 30);
  assert.doesNotThrow(() => exigirComerciaisCriacao(novo, true));
  assert.equal(Object.hasOwn(legado, "recursoForma"), false);
});

test("novas configurações não admitem pagamento; filtro histórico continua válido", () => {
  const base = { versao: 1, ativo: false, entidades: ["CONTATO"], participantesIds: [id(1), id(2)], horaDiaria: "02:00", limiteAlteracoes: 10,
    prontidao: { sincronizacaoNativaCompativel: false, semanticaPutValidada: false, incrementalValidado: false } };
  assert.equal(configuracaoSchema.safeParse(base).success, true);
  assert.equal(configuracaoSchema.safeParse({ ...base, entidades: ["CONTATO", "FORMA_PAGAMENTO"] }).success, false);
  assert.equal(filtrosSchema.parse({ entidade: "FORMA_PAGAMENTO" }).entidade, "FORMA_PAGAMENTO");
});
