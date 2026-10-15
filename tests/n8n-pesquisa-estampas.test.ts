import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lerEstadoUrlPesquisaEstampas } from '../src/services/filtrosPesquisaEstampas';
// @ts-expect-error Módulo JavaScript incorporado ao sandbox n8n; testado pelo contrato público.
import { avancarConversa, normalizarEvento, criarLink, ESTILOS, LINGUAGENS } from '../integrations/n8n/pesquisa-estampas/conversa.mjs';
import { ESTILOS_DESIGN, LINGUAGENS_DESIGN } from '../src/domain/estampa-atributos-design';

const config = { instanceId: 'instancia-teste', instanceApi: 'https://api.z-api.io/instances/teste/token/teste', webhookSecret: 's'.repeat(32), allowedPhones: ['5511999999999'], serialProcessingConfirmed: true };
const payload = { query: { key: config.webhookSecret }, body: { instanceId: config.instanceId, phone: config.allowedPhones[0], messageId: 'msg-1', fromMe: false, isGroup: false, text: { message: 'pesquisar estampas' } } };
function conversa(respostas: string[]) {
  let estado = null;
  let resultado;
  for (const [i, text] of respostas.entries()) {
    resultado = avancarConversa({ key: 'teste', phone: config.allowedPhones[0], id: String(i), text }, estado, 1000 + i);
    estado = JSON.parse(resultado.state);
  }
  return { estado, resultado };
}
test('valida segredo, instância, remetentes, grupos, mensagens próprias e payloads', () => {
  assert.ok(normalizarEvento(payload, config));
  assert.throws(() => normalizarEvento(payload, { ...config, allowedPhones: [] }));
  assert.throws(() => normalizarEvento(payload, { ...config, serialProcessingConfirmed: false }));
  assert.throws(() => normalizarEvento(payload, { ...config, instanceApi: 'https://outro.example/' }));
  assert.equal(normalizarEvento({ ...payload, query: { key: 'invalido' } }, config), null);
  for (const alteracao of [{ instanceId: 'outra' }, { fromMe: true }, { isGroup: true }, { phone: '5511888888888' }, { messageId: '' }, { text: { message: 'a'.repeat(1001) } }, { isEdit: true }]) {
    assert.equal(normalizarEvento({ ...payload, body: { ...payload.body, ...alteracao } }, config), null);
  }
});
test('conversa completa gera link compatível com a tela e exige confirmação', () => {
  const respostas = ['pesquisar estampas', 'floral', 'amarelo, verde', 'romântico', 'aquarelado', '2', '100'];
  const { estado, resultado } = conversa(respostas);
  assert.equal(estado.etapa, 'confirmar');
  assert.ok(!resultado.message.includes('https://'));
  const final = avancarConversa({ key: 'teste', phone: config.allowedPhones[0], id: 'final', text: 'confirmar' }, estado, 1100);
  const url = new URL(final.message.match(/https:\/\/\S+/)[0]);
  const restaurado = lerEstadoUrlPesquisaEstampas(url.searchParams);
  assert.equal(restaurado.filtros.tema, 'floral');
  assert.deepEqual(restaurado.filtros.cores, ['amarelo', 'verde']);
  assert.deepEqual(restaurado.filtros.preferencias, ['cores', 'estilo', 'linguagemVisual']);
  assert.equal(restaurado.filtros.correspondenciaMinima, 100);
  assert.equal(restaurado.filtros.status, 'COMPLETED');
  assert.equal(JSON.parse(final.state).etapa, 'fim');
});
test('opções de design não divergem do contrato da aplicação', () => {
  assert.deepEqual(ESTILOS, [...ESTILOS_DESIGN]);
  assert.deepEqual(LINGUAGENS, [...LINGUAGENS_DESIGN]);
});
test('obrigatórios, preferências, codificação e cores repetidas', () => {
  for (const modo of ['1', '2', '3']) {
    const url = new URL(criarLink({ tema: 'floral & tropical', cores: ['rosa', 'creme'], modo }));
    assert.equal(url.searchParams.get('tema'), 'floral & tropical');
    assert.equal(url.searchParams.get('tropical'), null);
    assert.equal(url.searchParams.get('preferencias'), modo === '1' ? '' : modo === '2' ? 'cores' : 'tema,cores');
  }
});
test('ignora mensagens fora da conversa, duplicatas e expira sem consumir resposta atrasada', () => {
  const evento = { key: 'a', phone: '5511999999999', id: '1', text: 'floral' };
  assert.equal(avancarConversa(evento, null, 1000), null);
  const { estado } = conversa(['pesquisar estampas']);
  assert.equal(avancarConversa({ ...evento, id: '0' }, estado, 1002), null);
  assert.equal(avancarConversa(evento, estado, 1000 + 31 * 60 * 1000), null);
});
test('pular, voltar, cancelar e reiniciar preservam o fluxo', () => {
  assert.equal(conversa(['pesquisar estampas', 'pular', 'pular', 'pular', 'pular']).estado.etapa, 'tema');
  assert.equal(conversa(['pesquisar estampas', 'floral', 'voltar']).estado.etapa, 'tema');
  assert.equal(conversa(['pesquisar estampas', 'cancelar']).estado.etapa, 'fim');
  assert.deepEqual(conversa(['pesquisar estampas', 'floral', 'reiniciar']).estado.dados, {});
});
test('rejeita valores inválidos sem avançar etapa', () => {
  assert.equal(conversa(['pesquisar estampas', 'a'.repeat(101)]).estado.etapa, 'tema');
  assert.equal(conversa(['pesquisar estampas', 'floral', Array.from({ length: 11 }, (_, i) => `cor${i}`).join(',')]).estado.etapa, 'cores');
  assert.equal(conversa(['pesquisar estampas', 'floral', 'pular', '999']).estado.etapa, 'estilo');
  assert.equal(conversa(['pesquisar estampas', 'floral', 'pular', 'pular', 'pular', '3', '101']).estado.etapa, 'minimo');
});
test('workflow inativo, sem credenciais, ligado e com privacidade de execuções', () => {
  const w = JSON.parse(readFileSync(new URL('../integrations/n8n/pesquisa-estampas/workflow.json', import.meta.url), 'utf8'));
  assert.equal(w.active, false);
  assert.equal(w.settings.saveDataSuccessExecution, 'none');
  assert.equal(w.settings.saveDataErrorExecution, 'none');
  assert.ok(w.nodes.every((n: { credentials?: unknown }) => !n.credentials));
  for (const value of Object.values(w.connections) as Array<{main: Array<Array<{node: string}>>}>) {
    for (const edge of value.main.flat()) assert.ok(w.nodes.some((n: { name: string }) => n.name === edge.node));
  }
});
