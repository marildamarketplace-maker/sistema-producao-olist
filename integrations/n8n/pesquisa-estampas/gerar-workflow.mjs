import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = new URL('./', import.meta.url);
const fonte = readFileSync(new URL('conversa.mjs', base), 'utf8').replace(/^export /gm, '');
const config = { instanceId: '', instanceApi: '', webhookSecret: '', allowedPhones: [], serialProcessingConfirmed: false };
const nodes = [];
const connections = {};
function node(name, type, typeVersion, parameters, extra = {}) {
  nodes.push({ id: `meury-${nodes.length}`, name, type: `n8n-nodes-base.${type}`, typeVersion, position: [nodes.length * 240, 0], parameters, ...extra });
}
function connect(a, b) { connections[a] = { main: [[{ node: b, type: 'main', index: 0 }]] }; }
const table = { __rl: true, mode: 'list', value: '' };
const filters = { conditions: [{ keyName: 'key', condition: 'eq', keyValue: "={{ $('Validar evento').first().json.key }}" }] };
node('Receber WhatsApp', 'webhook', 2, { httpMethod: 'POST', path: 'meury-pesquisa-estampas', responseMode: 'onReceived', options: {} }, { webhookId: 'meury-pesquisa-estampas' });
node('Configurar piloto', 'code', 2, { jsCode: `const config = ${JSON.stringify(config, null, 2)};\nreturn [{json: { ...$input.first().json, config }}];` });
node('Validar evento', 'code', 2, { jsCode: `${fonte}\nconst entrada = $input.first().json;\nconst evento = normalizarEvento(entrada, entrada.config);\nreturn evento ? [{json: { ...evento, instanceApi: entrada.config.instanceApi }}] : [];` });
node('Ler conversa', 'dataTable', 1, { resource: 'row', operation: 'get', dataTableId: table, filters, matchType: 'allConditions', returnAll: false, limit: 2 }, { alwaysOutputData: true });
node('Preparar resposta', 'code', 2, { jsCode: `${fonte}\nconst rows = $input.all().map(i => i.json).filter(r => r.state);\nif (rows.length > 1) throw new Error('Conversas duplicadas: corrija a tabela antes de continuar.');\nconst evento = $('Validar evento').first().json;\nconst anterior = rows[0]?.state ? JSON.parse(rows[0].state) : null;\nconst resultado = avancarConversa(evento, anterior);\nreturn resultado ? [{json: resultado}] : [];` });
node('Salvar conversa', 'dataTable', 1, { resource: 'row', operation: 'upsert', dataTableId: table, filters, matchType: 'allConditions', columns: { mappingMode: 'defineBelow', value: { key: '={{ $json.key }}', state: '={{ $json.state }}' }, schema: [{ id: 'key', displayName: 'key', type: 'string', required: false, display: true }, { id: 'state', displayName: 'state', type: 'string', required: false, display: true }] }, options: {} });
node('Responder via Z-API', 'httpRequest', 4.2, {
  method: 'POST', url: "={{ $('Validar evento').first().json.instanceApi.replace(/\/$/, '') + '/send-text' }}",
  authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
  sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify({ phone: $('Preparar resposta').first().json.phone, message: $('Preparar resposta').first().json.message }) }}",
  options: { timeout: 15000, redirect: { redirect: { followRedirects: false } } },
});
node('Conferir envio', 'code', 2, { jsCode: "const r = $input.first().json;\nif (![r.zaapId, r.messageId, r.id].some(v => typeof v === 'string' && v.trim())) throw new Error('Z-API não confirmou o envio. Inspecione a execução e recupere a conversa com reiniciar.');\nreturn [{json: { envioConfirmado: true }}];" });
for (let i = 0; i < nodes.length - 1; i++) connect(nodes[i].name, nodes[i + 1].name);
const workflow = { name: 'Meury — pesquisa guiada de estampas (piloto)', active: false, nodes, connections, settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, executionTimeout: 120 }, pinData: {} };
const path = new URL('workflow.json', base);
writeFileSync(path, JSON.stringify(workflow, null, 2) + '\n');
console.log(fileURLToPath(path));
