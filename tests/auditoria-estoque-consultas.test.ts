import assert from "node:assert/strict";
import test from "node:test";
import { criarConsultorAuditoria } from "../src/lib/auditoria-estoque-consultas";
import { LimiteRequisicoesOlistError } from "../src/lib/olist-errors";

function relogio(limiteEm = 240_000) {
  let tempo = 0;
  const esperas: number[] = [];
  return {
    esperas,
    consultar: criarConsultorAuditoria({ limiteEm, agora: () => tempo, aguardar: async (ms) => { esperas.push(ms); tempo += ms; } }),
  };
}

test("espaça listagens e saldos em pelo menos 2,1 segundos", async () => {
  const { consultar, esperas } = relogio();
  assert.equal(await consultar(async () => "pagina"), "pagina");
  assert.equal(await consultar(async () => "saldo"), "saldo");
  await consultar(async () => "proximo aplicativo");
  assert.deepEqual(esperas, [2100, 2100]);
});

test("repete a mesma operação após 429 respeitando Retry-After", async () => {
  const { consultar, esperas } = relogio();
  let chamadas = 0;
  const resultado = await consultar(async () => {
    if (++chamadas === 1) throw new LimiteRequisicoesOlistError(30_000);
    return "mesma página recuperada";
  });
  assert.equal(chamadas, 2);
  assert.equal(resultado, "mesma página recuperada");
  assert.deepEqual(esperas, [30_000]);
});

test("sem Retry-After aguarda 60 segundos e limita a três tentativas", async () => {
  const { consultar, esperas } = relogio();
  let chamadas = 0;
  await assert.rejects(consultar(async () => { chamadas++; throw new LimiteRequisicoesOlistError(null); }), /429/);
  assert.equal(chamadas, 3);
  assert.deepEqual(esperas, [60_000, 60_000]);
});

test("não repete erros de permissão ou espera além do orçamento", async () => {
  let chamadas = 0;
  await assert.rejects(relogio().consultar(async () => { chamadas++; throw new Error("403"); }), /403/);
  assert.equal(chamadas, 1);
  const { consultar, esperas } = relogio(50_000);
  await assert.rejects(consultar(async () => { throw new LimiteRequisicoesOlistError(60_000); }), /Prazo/);
  assert.deepEqual(esperas, []);
});
