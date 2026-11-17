import assert from "node:assert/strict";
import test from "node:test";
import { calcularPrevisaoValidacaoSync, inicioJanelaPrevisaoSync } from "../src/lib/olist-sync/previsao";
import { consultaValidacoesRecentesSync } from "../src/repositories/olist-sync-previsao-repository";

const agora = new Date("2026-11-17T21:00:00Z");
const base = { execucaoId: "execucao", agora, iniciadaEm: new Date("2026-11-17T12:00:00Z"),
  contadores: { listados: 17_222, analisados: 6_878 }, validadosNaJanela: 600, listagemPendente: false, pausada: false };

test("previsão usa somente os últimos 30min e não a média desde o início", () => {
  const previsao = calcularPrevisaoValidacaoSync(base);
  assert.equal(previsao.janelaInicio, "2026-11-17T20:30:00.000Z");
  assert.equal(previsao.porMinuto, 20);assert.equal(previsao.restantes, 10_344);
  assert.equal(previsao.terminoPrevisto, "2026-11-18T05:37:12.000Z");
});
test("execução nova usa apenas o tempo decorrido, sem diluir a taxa em 30 minutos", () => {
  const previsao = calcularPrevisaoValidacaoSync({ ...base, iniciadaEm: new Date(agora.getTime() - 5 * 60_000), validadosNaJanela: 100 });
  assert.equal(previsao.porMinuto, 20);assert.equal(previsao.estado, "ESTIMADA");
  assert.equal(inicioJanelaPrevisaoSync(agora, new Date(agora.getTime() + 1_000)).getTime(), agora.getTime());
});
test("sem progresso, amostra curta, pausa ou listagem incompleta não fabricam uma data", () => {
  for (const [entrada, estado] of [
    [{ validadosNaJanela: 0 }, "SEM_RITMO"], [{ validadosNaJanela: 4 }, "AMOSTRA_INSUFICIENTE"],
    [{ iniciadaEm: new Date(agora.getTime() - 30_000) }, "AMOSTRA_INSUFICIENTE"],
    [{ pausada: true }, "PAUSADA"], [{ listagemPendente: true }, "LISTANDO"],
    [{ contadores: { listados: 10, analisados: 10 } }, "LEITURA_CONCLUIDA"],
  ] as const) {
    const previsao = calcularPrevisaoValidacaoSync({ ...base, ...entrada });
    assert.equal(previsao.estado, estado);assert.equal(previsao.terminoPrevisto, null);
  }
});
test("contadores malformados e relógio anterior ao início não produzem Infinity ou datas inválidas", () => {
  for (const contadores of [null, [], "texto", { listados: -1, analisados: Infinity }, { listados: Number.MAX_SAFE_INTEGER, analisados: 5 }]) {
    const previsao = calcularPrevisaoValidacaoSync({ ...base, contadores, iniciadaEm: new Date(agora.getTime() + 60_000) });
    assert.equal(previsao.terminoPrevisto, null);assert.equal(previsao.porMinuto, null);
  }
});
test("consulta é parametrizada, agregada, isolada e usa o predicado do índice parcial", () => {
  const inicio = new Date(agora.getTime() - 30 * 60_000);
  const query = consultaValidacoesRecentesSync("grupo", "execucao", inicio, agora);
  assert.deepEqual(query.values, ["grupo", "execucao", inicio.toISOString(), agora.toISOString()]);
  assert.match(query.text, /count\(\*\)::int/);assert.match(query.text, /configuracao_id = \$1::uuid/);
  assert.match(query.text, /ultima_execucao_id = \$2::uuid/);assert.match(query.text, /verificado_em > \$3::timestamptz AND verificado_em <= \$4::timestamptz/);
  assert.match(query.text, /metadados_json @> '\{"completo":true\}'::jsonb/);
  assert.doesNotMatch(query.text, /dados_criptografados|SELECT \*|JOIN/i);
});
