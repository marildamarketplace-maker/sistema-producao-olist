import assert from "node:assert/strict";
import test from "node:test";
import { calcularPrevisaoValidacaoSync, calcularPrevisaoAplicacaoSync, inicioJanelaPrevisaoSync } from "../src/lib/olist-sync/previsao";
import { consultaValidacoesRecentesSync, consultaFilaAplicacaoSync, consultaConfirmacoesRecentesSync } from "../src/repositories/olist-sync-previsao-repository";

const agora = new Date("2026-11-17T21:00:00Z");
const base = { execucaoId: "execucao", agora, iniciadaEm: new Date("2026-11-17T12:00:00Z"),
  contadores: { listados: 17_222, analisados: 6_878 }, validadosNaJanela: 600, listagemPendente: false, pausada: false };
const aplicacao = {execucaoId:"execucao",agora,iniciadaEm:new Date("2026-11-17T12:00:00Z"),restantes:8_400,falhas:64,
  confirmadosNaJanela:210,preparacaoPendente:false,pausada:false};

test("aplicação prevê o fim da fila pelo ritmo recente de confirmações e separa falhas",()=>{
  const p=calcularPrevisaoAplicacaoSync(aplicacao);
  assert.equal(p.porMinuto,7);assert.equal(p.restantes,8_400);assert.equal(p.falhas,64);
  assert.equal(p.tempoRestanteSegundos,72_000);assert.equal(p.terminoPrevisto,"2026-11-18T17:00:00.000Z");
  assert.equal(p.janelaInicio,"2026-11-17T20:30:00.000Z");
});
test("início da aplicação recente usa tempo real decorrido e não a duração da auditoria",()=>{
  const p=calcularPrevisaoAplicacaoSync({...aplicacao,iniciadaEm:new Date(agora.getTime()-300_000),confirmadosNaJanela:50});
  assert.equal(p.porMinuto,10);
});
test("aplicação sem amostra, pausada, preparando ou sem fila não inventa data",()=>{
  for(const [entrada,estado] of [
    [{confirmadosNaJanela:0},"SEM_RITMO"],[{confirmadosNaJanela:4},"AMOSTRA_INSUFICIENTE"],
    [{iniciadaEm:null},"AMOSTRA_INSUFICIENTE"],[{iniciadaEm:new Date(agora.getTime()-30_000)},"AMOSTRA_INSUFICIENTE"],
    [{pausada:true},"PAUSADA"],[{preparacaoPendente:true},"PREPARANDO"],[{restantes:0},"FILA_CONCLUIDA"],
    [{restantes:-1},"AMOSTRA_INSUFICIENTE"],[{restantes:NaN},"AMOSTRA_INSUFICIENTE"],
  ] as const) {
    const p=calcularPrevisaoAplicacaoSync({...aplicacao,...entrada});
    assert.equal(p.estado,estado);assert.equal(p.terminoPrevisto,null);assert.equal(p.tempoRestanteSegundos,null);
  }
  const distante=calcularPrevisaoAplicacaoSync({...aplicacao,restantes:Number.MAX_SAFE_INTEGER,confirmadosNaJanela:5});
  assert.equal(distante.terminoPrevisto,null);assert.equal(distante.tempoRestanteSegundos,null);
});
test("fila agrega operações por alvo e execução; confirmações são isoladas e limitadas por janela",()=>{
  const fila=consultaFilaAplicacaoSync("grupo","execucao");
  assert.match(fila.text,/o.configuracao_id=\$\d+::uuid/);assert.match(fila.text,/a.aplicativo_id=o.destino_app_id/);
  assert.match(fila.text,/a.entidade=r.entidade/);assert.match(fila.text,/operacao_atual/);
  assert.match(fila.text,/o.execucao_id<>/);assert.doesNotMatch(fila.text,/SELECT \*|payload_criptografado|precondicoes_json/i);
  const recentes=consultaConfirmacoesRecentesSync("grupo","execucao",new Date(agora.getTime()-1_800_000),agora);
  assert.deepEqual(recentes.values,["grupo","execucao",new Date(agora.getTime()-1_800_000).toISOString(),agora.toISOString()]);
  assert.match(recentes.text,/tipo='ESCRITA_CONFIRMADA'/);assert.doesNotMatch(recentes.text,/metadados_json|SELECT \*/i);
});

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
