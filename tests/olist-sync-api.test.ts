import assert from "node:assert/strict";
import test from "node:test";
import { criarCriptografiaSync } from "../src/lib/olist-sync/cripto";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
process.env.OLIST_SYNC_DATA_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.OLIST_SYNC_HMAC_KEY = Buffer.alloc(32, 2).toString("base64");

const PAI = "00000000-0000-0000-0000-000000000002";
const MATRIZ = "00000000-0000-0000-0000-000000000003";
const FILHO = "00000000-0000-0000-0000-000000000004";
const OUTRO = "00000000-0000-0000-0000-000000000005";
const EXTERNO = "00000000-0000-4000-8000-000000000010";
const GRUPO = "10000000-0000-4000-8000-000000000001";
const REGISTRO = "20000000-0000-4000-8000-000000000001";
const PENDENCIA = "30000000-0000-4000-8000-000000000001";
const EXECUCAO = "40000000-0000-4000-8000-000000000001";
const IDEMPOTENCIA = "50000000-0000-4000-8000-000000000001";
const agora = new Date("2026-11-16T12:00:00Z");
const flags = "AGENDAR_SINCRONIZACAO_OLIST,AUDITAR_SINCRONIZACAO_OLIST,APLICAR_SINCRONIZACAO_OLIST,LIMPAR_HISTORICO_SINCRONIZACAO_OLIST";
const criptografia = criarCriptografiaSync();
const pendencia = { id: PENDENCIA, registroId: REGISTRO, entidade: "PRODUTO", tipo: "CAMPOS_DIVERGENTES", severidade: "ALTA", status: "AGUARDANDO_REVISAO", versao: 3, createdAt: agora, execucaoId: EXECUCAO, chaveDedupe: "dedupe", detalhesCriptografados: null };
const registro = { id: REGISTRO, entidade: "CONTATO", chave: "a".repeat(64), nome: "Contato protegido", revisao: 2, origemTipo: "DESCONHECIDA", aplicativoOrigemId: null, registroOlistOrigemId: null, origemRegistradaEm: null, ultimaFonteAppId: null, estados: [] };
const execucao = { id: EXECUCAO, configuracaoId: GRUPO, chaveIdempotencia: IDEMPOTENCIA, modo: "AUDITAR", origem: "MANUAL", completa: true, status: "PENDENTE", versaoConfiguracao: 1, solicitadoPor: "usuario", iniciadaEm: null, finalizadaEm: null, cancelamentoSolicitado: false, contadoresJson: {}, createdAt: agora, updatedAt: agora };
const empresas = [FILHO, OUTRO].map((id) => ({ id, nome: id === FILHO ? "Filial" : "Seu Olhar", aplicativoPaiId: PAI }));
function configuracao() {
  return { id: GRUPO, aplicativoPaiId: PAI, aplicativosBloqueados: [MATRIZ], ativo: true, entidades: ["PRODUTO", "CONTATO", "FORMA_PAGAMENTO", "VENDEDOR"], versao: 1, politicasJson: {}, readinessJson: {}, horaDiaria: "02:00", timezone: "America/Sao_Paulo", proximaExecucaoEm: null, ultimaLimpezaEm: null, autorizadoPor: "usuario", limiteAlteracoes: 100, createdAt: agora, updatedAt: agora,
    aplicativoPai: { id: PAI, jobs: flags }, participantes: empresas.map((app) => ({ id: app.id, aplicativoId: app.id, habilitado: true, contaIdentidade: null, proximaChamadaEm: null, aplicativo: { ...app, aplicativoPaiId: PAI } })),
  };
}
type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown | Promise<unknown>;
const chamadas: { metodo: string; args: Args }[] = [];
let handlers: Record<string, Handler> = {};
let usuarioApp = PAI;
let permissao = { podeVisualizarSincronizacaoOlist: true, podeExecutarSincronizacaoOlist: true, podeResolverSincronizacaoOlist: true, podeConfigurarSincronizacaoOlist: true };
function objeto(valor: unknown): Args { return valor !== null && typeof valor === "object" ? valor as Args : {}; }
function metodo(nome: string) { return async (args: Args = {}) => { chamadas.push({ metodo: nome, args }); return handlers[nome]?.(args); }; }
function delegate(nome: string) {
  return Object.fromEntries(["findUnique", "findUniqueOrThrow", "findFirst", "findMany", "count", "groupBy", "create", "createMany", "update", "updateMany", "upsert"].map((op) => [op, metodo(`${nome}.${op}`)]));
}
const db: Record<string, unknown> = Object.fromEntries(["usuario", "aplicativo", "configuracaoJob", "olistSyncConfiguracao", "olistSyncParticipante", "olistSyncCobertura", "olistSyncRegistro", "olistSyncEstado", "olistSyncExecucao", "olistSyncEtapa", "olistSyncOperacao", "olistSyncPendencia", "olistSyncEvento"].map((nome) => [nome, delegate(nome)]));
db.$queryRaw = async (query: unknown, ...values: unknown[]) => {
  const entrada = Array.isArray(query) ? { sql: query.join("?"), values } : { query };
  return (await metodo("$queryRaw")(entrada)) ?? [];
};
db.$executeRaw = (strings: TemplateStringsArray, ...values: unknown[]) => metodo("$executeRaw")({ sql: strings.join("?"), values });
db.$transaction = async (run: (tx: unknown) => Promise<unknown>) => run(db);
Object.assign(globalThis, { prisma: db });

function reset() {
  chamadas.length = 0; usuarioApp = PAI;
  permissao = { podeVisualizarSincronizacaoOlist: true, podeExecutarSincronizacaoOlist: true, podeResolverSincronizacaoOlist: true, podeConfigurarSincronizacaoOlist: true };
  handlers = {
    "$queryRaw": () => [],
    "$executeRaw": () => 0,
    "usuario.findFirst": ({ where }) => objeto(where).id === "usuario" ? { id: "usuario", aplicativoId: usuarioApp } : null,
    "usuario.findUnique": () => permissao,
    "olistSyncConfiguracao.findUnique": ({ where }) => objeto(where).aplicativoPaiId && objeto(where).aplicativoPaiId !== PAI ? null : configuracao(),
    "olistSyncConfiguracao.findUniqueOrThrow": () => configuracao(),
    "aplicativo.findUniqueOrThrow": () => ({ nome: "Pai" }), "aplicativo.findMany": ({ where }) => {
      const ids = objeto(objeto(where).id).in;
      return empresas.filter(app => (!Array.isArray(ids) || ids.includes(app.id)) && objeto(where).aplicativoPaiId === app.aplicativoPaiId);
    },
    "aplicativo.count": ({ where }) => Array.isArray(objeto(objeto(where).id).in) ? (objeto(objeto(where).id).in as unknown[]).filter((id) => [FILHO, OUTRO].includes(String(id))).length : 0,
    "aplicativo.findFirst": ({ where }) => [FILHO, OUTRO].includes(String(objeto(where).id)) ? { id: objeto(where).id } : null,
    "configuracaoJob.findMany": () => [{ chave: "auditar-sincronizacao-olist", pausado: false }],
    "configuracaoJob.findUnique": () => ({ pausado: false }),
    "olistSyncConfiguracao.updateMany": () => ({ count: 1 }), "olistSyncParticipante.updateMany": () => ({ count: 1 }),
    "olistSyncParticipante.upsert": () => ({ id: FILHO }), "olistSyncEvento.create": () => ({ id: "evento" }),
    "olistSyncParticipante.findMany": () => empresas.map(app => ({ aplicativoId: app.id, contaIdentidade: null })),
    "olistSyncCobertura.findMany": () => [], "olistSyncCobertura.upsert": () => ({ id: "cobertura" }),
    "olistSyncEvento.findFirst": () => null,
    "olistSyncRegistro.findMany": () => [registro], "olistSyncRegistro.count": () => 1,
    "olistSyncRegistro.findFirst": ({ where }) => objeto(where).id === REGISTRO && objeto(where).configuracaoId === GRUPO ? registro : null,
    "olistSyncRegistro.update": () => ({ id: REGISTRO }),
    "olistSyncPendencia.findMany": () => [pendencia], "olistSyncPendencia.count": () => 1,
    "olistSyncPendencia.findFirst": ({ where }) => objeto(where).id === PENDENCIA && objeto(where).configuracaoId === GRUPO ? pendencia : null,
    "olistSyncPendencia.update": () => ({ id: PENDENCIA }),
    "olistSyncEstado.findMany": () => [], "olistSyncEstado.groupBy": () => [],
    "olistSyncOperacao.groupBy": () => [], "olistSyncPendencia.groupBy": () => [{tipo:"DIVERGENCIA",_count:1}],
    "olistSyncExecucao.findUnique": () => null,
    "olistSyncExecucao.findFirst": () => null,
    "olistSyncExecucao.create": () => execucao,
    "olistSyncEtapa.createMany": () => ({ count: 8 }),
  };
}
const contexto = (recurso: string) => ({ params: Promise.resolve({ recurso: recurso.split("/") }) });
const request = (recurso: string, method = "GET", body?: unknown) => new Request(`https://example.test/api/olist/sincronizacao/${recurso}`, { method, headers: { authorization: "Bearer fake", "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const chamadasDe = (metodo: string) => chamadas.filter((item) => item.metodo === metodo);
const origem = { revisao: 2, aplicativoOrigemId: FILHO, registroOlistOrigemId: "123", motivo: "Origem confirmada por cadastro histórico", idempotencia: IDEMPOTENCIA };
const decisao = { versao: 3, acao: "IGNORAR", motivo: "Diferença operacional aceita pelo responsável" };

void test("API de sincronização: autorização, isolamento, validação e trabalho durável", async (t) => {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test", email_confirmed_at: "2026-11-16" } }, error: null }));
  const { GET, PUT, POST } = await import("../src/app/api/olist/sincronizacao/[[...recurso]]/route");

  const configuracaoInput = { versao: 1, ativo: true, entidades: ["PRODUTO"], participantesIds: [FILHO, OUTRO], horaDiaria: "02:00", limiteAlteracoes: 100, prontidao: { sincronizacaoNativaCompativel: false, semanticaPutValidada: false, incrementalValidado: false } };
  const validacaoIncremental = { aplicativoId: FILHO, entidade: "PRODUTO", validado: true, fusoHorario: "America/Sao_Paulo", versaoContrato: 1, evidencia: "Ensaiados cadastro antigo atualizado, inativação, exclusão e paginação na conta." };
  const operacoesProtegidas = [
    { nome: "enfileirar", chave: "podeExecutarSincronizacaoOlist", caminho: "execucoes", dados: { modo: "AUDITAR", idempotencia: IDEMPOTENCIA } },
    { nome: "cancelar", chave: "podeExecutarSincronizacaoOlist", caminho: `execucoes/${EXECUCAO}/cancelar`, dados: {} },
    { nome: "retomar", chave: "podeExecutarSincronizacaoOlist", caminho: `execucoes/${EXECUCAO}/retomar`, dados: {} },
    { nome: "declarar origem", chave: "podeResolverSincronizacaoOlist", caminho: `registros/${REGISTRO}/origem`, dados: origem },
    { nome: "resolver pendência", chave: "podeResolverSincronizacaoOlist", caminho: `pendencias/${PENDENCIA}/decisao`, dados: decisao },
    { nome: "configurar", chave: "podeConfigurarSincronizacaoOlist", caminho: "configuracao", dados: configuracaoInput },
  ] as const;
  for (const operacao of operacoesProtegidas) {
    await t.test(`permissão independente: ${operacao.nome} exige sua flag mesmo com as outras concedidas`, async () => {
      reset(); permissao[operacao.chave] = false;
      const executar = operacao.nome === "configurar" ? PUT : POST;
      const response = await executar(request(operacao.caminho, operacao.nome === "configurar" ? "PUT" : "POST", operacao.dados), contexto(operacao.caminho));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(chamadas.filter(c => /\.(create|createMany|update|updateMany|upsert)$/.test(c.metodo)).length, 0);
    });
  }

  await t.test("revogar visualização bloqueia leitura e todas as mutações apesar das flags específicas", async () => {
    reset(); permissao.podeVisualizarSincronizacaoOlist = false;
    for (const recurso of ["configuracao", "resumo", "registros", "pendencias", "execucoes", "previsao"]) {
      assert.equal((await GET(request(recurso), contexto(recurso))).status, 403, recurso);
    }
    for (const operacao of operacoesProtegidas) {
      const executar = operacao.nome === "configurar" ? PUT : POST;
      assert.equal((await executar(request(operacao.caminho, operacao.nome === "configurar" ? "PUT" : "POST", operacao.dados), contexto(operacao.caminho))).status, 403, operacao.nome);
    }
    assert.equal(chamadasDe("olistSyncRegistro.findMany").length, 0);
    assert.equal(chamadas.filter(c => /\.(create|createMany|update|updateMany|upsert)$/.test(c.metodo)).length, 0);
  });

  await t.test("previsão consulta uma linha agregada isolada ao pai e à execução ativa", async () => {
    reset();
    handlers["olistSyncExecucao.findFirst"] = ({ where, select }) => {
      assert.equal(objeto(where).configuracaoId, GRUPO);
      assert.deepEqual(objeto(objeto(where).status).in, ["PENDENTE", "AUDITANDO", "APLICANDO", "AGUARDANDO_RETRY"]);
      assert.equal(objeto(select).etapas && objeto(objeto(select).etapas).take, 201);
      return { ...execucao, status: "AUDITANDO", iniciadaEm: new Date(Date.now() - 3_600_000),
        contadoresJson: { listados: 1_000, analisados: 400 }, etapas: [{ fase: "DETALHAR", status: "PENDENTE" }] };
    };
    handlers["$queryRaw"] = ({ query }) => {
      const valores = objeto(query).values as unknown[];
      assert.equal(valores[0], GRUPO);assert.equal(valores[1], EXECUCAO);
      assert.equal(Date.parse(String(valores[3])) - Date.parse(String(valores[2])), 30 * 60_000);
      return [{ total: 300 }];
    };
    const response = await GET(request("previsao?janela=9999&configuracaoId=externo"), contexto("previsao"));
    assert.equal(response.status, 200);assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.previsao.porMinuto, 10);assert.equal(body.previsao.restantes, 600);
    assert.equal(Date.parse(body.previsao.terminoPrevisto) - Date.parse(body.previsao.calculadoEm), 3_600_000);
    assert.equal(chamadasDe("$queryRaw").length, 1);assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
    assert.deepEqual(chamadasDe("olistSyncConfiguracao.findUnique")[0].args.select,
      { id: true, ativo: true, aplicativoPai: { select: { jobs: true } } }, "A previsão não lê participantes, políticas ou prontidão");
    assert.doesNotMatch(JSON.stringify(body), /Criptograf|metadados|token|cpfCnpj/);
  });
  await t.test("previsão de aplicação agrega fila antiga e ritmo de confirmações sem expor dados",async()=>{
    reset();
    handlers["olistSyncExecucao.findFirst"]=()=>({...execucao,modo:"APLICAR",status:"APLICANDO",iniciadaEm:new Date(Date.now()-86_400_000),contadoresJson:{criados:7_096},etapas:[{fase:"APLICAR",status:"PENDENTE"}]});
    handlers["configuracaoJob.findUnique"]=({where})=>{assert.equal(objeto(where).chave,"aplicar-sincronizacao-olist");return {pausado:false};};
    handlers["$queryRaw"]=({query})=>{
      const q=objeto(query);assert.equal((q.values as unknown[])[0],GRUPO);assert.equal((q.values as unknown[])[1],EXECUCAO);
      return String(q.text).includes("WITH alvos")?[{iniciada:new Date(Date.now()-3_600_000),restantes:600,falhas:64}]:[{total:300}];
    };
    const response=await GET(request("previsao?configuracaoId=externo"),contexto("previsao"));
    assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
    const body=await response.json();assert.equal(body.previsao,null);
    assert.equal(body.previsaoAplicacao.porMinuto,10);assert.equal(body.previsaoAplicacao.restantes,600);assert.equal(body.previsaoAplicacao.falhas,64);
    assert.equal(body.previsaoAplicacao.tempoRestanteSegundos,3_600);assert.equal(chamadasDe("$queryRaw").length,2);
    assert.doesNotMatch(JSON.stringify(body),/payload|cursor|token|cpfCnpj|Criptograf/);
    reset();usuarioApp=FILHO;
    assert.equal((await GET(request("previsao"),contexto("previsao"))).status,403);assert.equal(chamadasDe("$queryRaw").length,0);
  });
  await t.test("aplicação pausada e preparação incompleta não consultam confirmações nem mostram data",async()=>{
    for(const [pausado,fase,estado] of [[true,"APLICAR","PAUSADA"],[false,"COMPARAR","PREPARANDO"]] as const) {
      reset();handlers["olistSyncExecucao.findFirst"]=()=>({...execucao,modo:"AUDITAR_E_APLICAR",status:"APLICANDO",iniciadaEm:new Date(Date.now()-3_600_000),etapas:[{fase,status:"PENDENTE"}]});
      handlers["configuracaoJob.findUnique"]=()=>({pausado});
      handlers["$queryRaw"]=()=>[{iniciada:new Date(Date.now()-3_600_000),restantes:10,falhas:0}];
      const body=await (await GET(request("previsao"),contexto("previsao"))).json();
      assert.equal(body.previsaoAplicacao.estado,estado);assert.equal(body.previsaoAplicacao.terminoPrevisto,null);
      assert.equal(chamadasDe("$queryRaw").length,1);
    }
  });
  await t.test("sem execução ativa, listagem incompleta e job pausado não contam o catálogo", async () => {
    reset();
    assert.deepEqual(await (await GET(request("previsao"), contexto("previsao"))).json(), { previsao: null });
    for (const [fase, pausado, estado] of [["LISTAR", false, "LISTANDO"], ["DETALHAR", true, "PAUSADA"]] as const) {
      handlers["olistSyncExecucao.findFirst"] = () => ({ ...execucao, iniciadaEm: new Date(Date.now() - 3_600_000), contadoresJson: { listados: 10, analisados: 1 }, etapas: [{ fase, status: "PENDENTE" }] });
      handlers["configuracaoJob.findUnique"] = () => ({ pausado });
      const response = await GET(request("previsao"), contexto("previsao"));
      assert.equal((await response.json()).previsao.estado, estado);
    }
    assert.equal(chamadasDe("$queryRaw").length, 0);
  });
  await t.test("detalhe da pausa expõe somente um sinal público sem erro bruto do provedor", async () => {
    reset();
    handlers["olistSyncExecucao.findFirst"] = () => ({...execucao,etapas:[{id:"etapa",aplicativoId:FILHO,entidade:"CONTATO",fase:"APLICAR",status:"PAUSADA",tentativas:0,disponivelEm:agora}]});
    handlers["$queryRaw"] = () => [{id:"etapa",modo:null,iniciadaEm:null,desde:null,confirmacoesDivergentes:true}];
    const caminho=`execucoes/${EXECUCAO}`;
    const response=await GET(request(caminho),contexto(caminho));assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.etapas[0].confirmacoesDivergentes,true);
    assert.doesNotMatch(JSON.stringify(body),/erroCodigo|payload|criptografado|cursorJson|cpfCnpj/);
  });
  await t.test("polling do resumo e consultas de detalhes/lista não calculam previsão", async () => {
    reset();handlers["olistSyncExecucao.findMany"] = () => [];handlers["olistSyncExecucao.count"] = () => 0;
    for (const caminho of ["resumo", "execucoes", `execucoes/${EXECUCAO}`]) await GET(request(caminho), contexto(caminho));
    assert.equal(chamadasDe("$queryRaw").length, 0);
  });
  await t.test("leitura concluída e execução nova dispensam a contagem da janela", async () => {
    for (const [iniciadaEm, contadoresJson, estado] of [
      [new Date(Date.now() - 3_600_000), { listados: 100, analisados: 100 }, "LEITURA_CONCLUIDA"],
      [new Date(Date.now() - 20_000), { listados: 100, analisados: 5 }, "AMOSTRA_INSUFICIENTE"],
      [null, { listados: 100, analisados: 0 }, "AMOSTRA_INSUFICIENTE"],
    ] as const) {
      reset();handlers["olistSyncExecucao.findFirst"] = () => ({ ...execucao, iniciadaEm, contadoresJson, etapas: [{ fase: "DETALHAR", status: "PENDENTE" }] });
      const response = await GET(request("previsao"), contexto("previsao"));
      assert.equal(response.status, 200);assert.equal((await response.json()).previsao.estado, estado);
      assert.equal(chamadasDe("$queryRaw").length, 0);
    }
  });
  await t.test("pai sem liberação e filhos não disparam consultas adicionais de previsão", async () => {
    reset();handlers["olistSyncConfiguracao.findUnique"] = () => ({ ...configuracao(), ativo: false });
    handlers["olistSyncExecucao.findFirst"] = () => ({ ...execucao, iniciadaEm: agora, etapas: [] });
    assert.equal((await (await GET(request("previsao"), contexto("previsao"))).json()).previsao.estado, "PAUSADA");
    assert.equal(chamadasDe("configuracaoJob.findUnique").length, 0);assert.equal(chamadasDe("$queryRaw").length, 0);
    reset();usuarioApp = FILHO;
    assert.equal((await GET(request("previsao"), contexto("previsao"))).status, 403);
    assert.equal(chamadasDe("olistSyncExecucao.findFirst").length, 0);assert.equal(chamadasDe("$queryRaw").length, 0);
  });

  await t.test("reauditar exige executar além de resolver e não registra decisão sem ambas", async () => {
    reset(); permissao.podeExecutarSincronizacaoOlist = false;
    const path = `pendencias/${PENDENCIA}/decisao`;
    assert.equal((await POST(request(path, "POST", { ...decisao, acao: "REAUDITAR" }), contexto(path))).status, 403);
    assert.equal(chamadasDe("olistSyncPendencia.update").length, 0);
    assert.equal(chamadasDe("olistSyncEvento.create").length, 0);
  });

  await t.test("JSON malformado, corpo excessivo e campos privilegiados são rejeitados antes de mutar", async () => {
    reset(); const path = `registros/${REGISTRO}/origem`;
    for (const [body, status] of [["{", 400], ["x".repeat(16_385), 413], [JSON.stringify({ ...origem, configuracaoId: EXTERNO }), 400]] as const) {
      const req = new Request(`https://example.test/${path}`, { method: "POST", headers: { authorization: "Bearer fake" }, body });
      assert.equal((await POST(req, contexto(path))).status, status);
    }
    assert.equal(chamadasDe("olistSyncRegistro.findFirst").length, 0);
    assert.equal(chamadasDe("olistSyncRegistro.update").length, 0);
  });

  await t.test("erro interno e observação adulterada não expõem SQL, segredo ou ciphertext", async () => {
    reset(); const segredo = "postgres://privilegiado:segredo@banco/SELECT * FROM usuario";
    handlers["olistSyncRegistro.findMany"] = () => { throw new Error(segredo); };
    let response = await GET(request("registros"), contexto("registros"));
    assert.equal(response.status, 500); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "Não foi possível concluir a solicitação de sincronização." });
    const cifrado = criptografia.cifrar({ aplicativoId: FILHO, remoteId: "10", segredo }, `${GRUPO}:pendencia:outro-dedupe`);
    handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, detalhesCriptografados: cifrado });
    response = await GET(request(`pendencias/${PENDENCIA}`), contexto(`pendencias/${PENDENCIA}`));
    assert.equal(response.status, 409);
    const texto = await response.text(); assert.ok(!texto.includes(segredo)); assert.ok(!texto.includes(cifrado));
    assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
  });

  await t.test("pendência já decidida não aceita nova rejeição nem novo evento na mesma versão", async () => {
    reset(); handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, status: "IGNORADA" });
    const path = `pendencias/${PENDENCIA}/decisao`;
    assert.equal((await POST(request(path, "POST", { ...decisao, acao: "REJEITAR" }), contexto(path))).status, 409);
    assert.equal(chamadasDe("olistSyncPendencia.update").length, 0);
    assert.equal(chamadasDe("olistSyncEvento.create").length, 0);
  });

  await t.test("projeções de listas e detalhes de execução excluem payload, cursor e erros de provedores", async () => {
    reset();
    handlers["olistSyncExecucao.findMany"] = () => [execucao]; handlers["olistSyncExecucao.count"] = () => 1;
    handlers["olistSyncExecucao.findFirst"] = () => ({ ...execucao, etapas: [] });
    for (const recurso of ["pendencias", "execucoes", `execucoes/${EXECUCAO}`]) {
      const response = await GET(request(recurso), contexto(recurso));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    const pendenciaSelect = objeto(chamadasDe("olistSyncPendencia.findMany")[0].args.select);
    for (const campo of ["detalhesCriptografados", "decisaoJson", "motivo"]) assert.equal(pendenciaSelect[campo], undefined, campo);
    const etapaSelect = objeto(objeto(objeto(chamadasDe("olistSyncExecucao.findFirst")[0].args.select).etapas).select);
    for (const campo of ["cursorJson", "erroMensagem", "erroCodigo", "leaseDono"]) assert.equal(etapaSelect[campo], undefined, campo);
    assert.equal(objeto(objeto(chamadasDe("olistSyncExecucao.findFirst")[0].args.select).etapas).take, 200);
  });

  await t.test("detalhe projeta só modo e janela públicos sem carregar cursor, conta ou lote", async () => {
    reset();
    handlers["olistSyncExecucao.findFirst"] = () => ({ ...execucao, etapas: [{ id: "etapa", aplicativoId: FILHO, entidade: "PRODUTO", fase: "COLETA", status: "AUDITANDO", tentativas: 1, disponivelEm: agora }] });
    handlers["$queryRaw"] = () => [{ id: "etapa", modo: "INCREMENTAL", iniciadaEm: agora.toISOString(), desde: "2026-11-15T12:00:00Z" }];
    const response = await GET(request(`execucoes/${EXECUCAO}`), contexto(`execucoes/${EXECUCAO}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.etapas[0].plano, { modo: "INCREMENTAL", iniciadaEm: agora.toISOString(), desde: "2026-11-15T12:00:00Z" });
    const consulta = chamadasDe("$queryRaw")[0].args;
    assert.deepEqual(consulta.values, [EXECUCAO, GRUPO]);
    assert.match(String(consulta.sql), /desdeUtc/); assert.match(String(consulta.sql), /LIMIT 200/);
    assert.doesNotMatch(String(consulta.sql), /contaIdentidade|assinaturaEscopo|SELECT\s+\*/);
  });

  await t.test("declaração incremental vincula identidade atual sob lock, exige evidência e preserva baseline", async () => {
    reset();
    handlers["olistSyncParticipante.findMany"] = () => [{ aplicativoId: FILHO, contaIdentidade: "identidade-atual-no-servidor" }];
    const response = await PUT(request("configuracao", "PUT", { ...configuracaoInput, incrementalValidacoes: [validacaoIncremental] }), contexto("configuracao"));
    assert.equal(response.status, 200);
    const cobertura = chamadasDe("olistSyncCobertura.upsert")[0].args;
    assert.deepEqual(objeto(cobertura.where).configuracaoId_aplicativoId_entidade, { configuracaoId: GRUPO, aplicativoId: FILHO, entidade: "PRODUTO" });
    assert.equal(objeto(cobertura.update).incrementalContaIdentidade, "identidade-atual-no-servidor");
    assert.equal(objeto(cobertura.update).incrementalValidadoPor, "usuario");
    assert.equal(objeto(cobertura.update).incrementalVersaoContrato, 1);
    for (const campo of ["completaEm", "incrementalEm", "watermarkConfirmado", "contaIdentidade", "geracao"]) assert.equal(objeto(cobertura.create)[campo], undefined, campo);
    assert.ok(chamadas.findIndex(c => c.metodo === "$queryRaw") < chamadas.findIndex(c => c.metodo === "olistSyncParticipante.findMany"));
    const evento = chamadasDe("olistSyncEvento.create").map(c => objeto(c.args.data)).find(e => e.tipo === "INCREMENTAL_VALIDACAO_DECLARADA");
    assert.equal(objeto(evento?.metadadosJson).evidencia, validacaoIncremental.evidencia);
    assert.ok(!JSON.stringify(evento).includes("identidade-atual-no-servidor"));
  });

  await t.test("validação incremental recusa falta de identidade, escopo estranho, versão antiga e hashes enviados", async () => {
    for (const [alteracao, status] of [
      [{}, 400], [{ aplicativoId: EXTERNO }, 400], [{ entidade: "CONTATO" }, 400], [{ versaoContrato: 2 }, 409],
      [{ contaIdentidade: "forjada" }, 400], [{ evidencia: "curto" }, 400], [{ fusoHorario: "Brasil/invalido" }, 400],
    ] as const) {
      reset();
      const response = await PUT(request("configuracao", "PUT", { ...configuracaoInput, incrementalValidacoes: [{ ...validacaoIncremental, ...alteracao }] }), contexto("configuracao"));
      assert.equal(response.status, status, JSON.stringify(alteracao));
      assert.equal(chamadasDe("olistSyncCobertura.upsert").length, 0);
      assert.equal(chamadasDe("olistSyncConfiguracao.updateMany").length, 0);
    }
  });

  await t.test("revogação limpa a declaração e não exige nova identificação nem apaga cobertura", async () => {
    reset();
    const response = await PUT(request("configuracao", "PUT", { ...configuracaoInput, incrementalValidacoes: [{ ...validacaoIncremental, validado: false, evidencia: undefined }] }), contexto("configuracao"));
    assert.equal(response.status, 200);
    const dados = objeto(chamadasDe("olistSyncCobertura.upsert")[0].args.update);
    assert.equal(dados.incrementalValidado, false); assert.equal(dados.incrementalContaIdentidade, null);
    assert.equal(dados.incrementalValidadoEm, null); assert.equal(dados.watermarkConfirmado, undefined);
  });

  await t.test("declarar validação em A preserva baseline legado de A e B antes do bump sem certificar B", async () => {
    reset();
    handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => ({ ...configuracao(), entidades: ["PRODUTO"] });
    handlers["olistSyncParticipante.findMany"] = () => [{ aplicativoId: FILHO, contaIdentidade: "conta-atual" }, { aplicativoId: OUTRO, contaIdentidade: "conta-b" }];
    handlers["olistSyncCobertura.findUnique"] = ({ where }) => ({ id: `cobertura-${objeto(objeto(where).configuracaoId_aplicativoId_entidade).aplicativoId}`, completaEm: null, watermarkConfirmado: null, geracao: 0 });
    handlers["olistSyncCobertura.updateMany"] = () => ({ count: 1 });
    handlers["olistSyncExecucao.findFirst"] = ({ where }) => objeto(where).completa ? { id: EXECUCAO, createdAt: agora, iniciadaEm: agora, finalizadaEm: new Date("2026-11-16T13:00:00Z"), etapas: [
      ...[FILHO, OUTRO].map(aplicativoId => ({ aplicativoId, fase: "DETALHAR", status: "CONCLUIDA", cursorJson: {} })),
      { aplicativoId: null, fase: "COMPARAR", status: "CONCLUIDA", cursorJson: {} },
    ] } : null;
    handlers["$queryRaw"] = ({ sql }) => String(sql).includes("count(*)") ? [{ quantidade: BigInt(0) }] : [];
    const response = await PUT(request("configuracao", "PUT", { ...configuracaoInput, incrementalValidacoes: [validacaoIncremental] }), contexto("configuracao"));
    assert.equal(response.status, 200);
    const adotada = objeto(chamadasDe("olistSyncCobertura.updateMany")[0].args.data);
    assert.equal(adotada.watermarkConfirmado, agora); assert.equal(adotada.completaExecucaoId, EXECUCAO);
    assert.equal(adotada.contaIdentidade, "conta-atual");
    const adotadas = chamadasDe("olistSyncCobertura.updateMany");
    assert.equal(adotadas.length, 2); assert.equal(objeto(adotadas[1].args.data).contaIdentidade, "conta-b");
    assert.ok(adotadas.every(c => objeto(c.args.data).incrementalValidado === undefined));
    const declaradas = chamadasDe("olistSyncCobertura.upsert").filter(c => objeto(c.args.update).incrementalValidado === true);
    assert.equal(declaradas.length, 1); assert.equal(objeto(objeto(declaradas[0].args.where).configuracaoId_aplicativoId_entidade).aplicativoId, FILHO);
    assert.equal(objeto(chamadasDe("olistSyncExecucao.findFirst")[0].args.where).versaoConfiguracao, 1);
    assert.ok(chamadas.findIndex(c => c.metodo === "olistSyncCobertura.updateMany") < chamadas.findIndex(c => c.metodo === "olistSyncConfiguracao.updateMany"));
    assert.equal(objeto(chamadasDe("olistSyncCobertura.upsert").at(-1)?.args.update).incrementalValidado, true);
  });

  await t.test("alterar entidades ou versão impede adoção oportunista de cobertura legada", async () => {
    reset(); handlers["olistSyncParticipante.findMany"] = () => [{ aplicativoId: FILHO, contaIdentidade: "conta-atual" }];
    assert.equal((await PUT(request("configuracao", "PUT", { ...configuracaoInput, incrementalValidacoes: [validacaoIncremental] }), contexto("configuracao"))).status, 200);
    assert.equal(chamadasDe("olistSyncCobertura.findUnique").length, 0);
    reset(); handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => ({ ...configuracao(), versao: 2, entidades: ["PRODUTO"] });
    assert.equal((await PUT(request("configuracao", "PUT", { ...configuracaoInput, incrementalValidacoes: [validacaoIncremental] }), contexto("configuracao"))).status, 409);
    assert.equal(chamadasDe("olistSyncCobertura.upsert").length, 0);
  });

  await t.test("GET cobertura oculta identidade, limita consulta e invalida declaração de outra conta ou versão", async () => {
    for (const [identidade, versaoContrato, esperado] of [["conta-atual", 1, true], ["conta-anterior", 1, false], ["conta-atual", 2, false]] as const) {
      reset();
      handlers["olistSyncConfiguracao.findUnique"] = () => ({ ...configuracao(), participantes: configuracao().participantes.map(p => ({ ...p, contaIdentidade: "conta-atual" })) });
      handlers["olistSyncCobertura.findMany"] = () => [{ aplicativoId: FILHO, entidade: "PRODUTO", incrementalValidado: true, incrementalFuso: "America/Sao_Paulo", incrementalContaIdentidade: identidade, incrementalVersaoContrato: versaoContrato, incrementalValidadoEm: agora, completaEm: agora, incrementalEm: null, watermarkConfirmado: agora }];
      const response = await GET(request("configuracao"), contexto("configuracao"));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.incremental.coberturas[0].validado, esperado);
      assert.equal(body.incremental.completaCadaDias, 15); assert.equal(body.incremental.sobreposicaoHoras, 24);
      assert.ok(!JSON.stringify(body).includes("conta-atual")); assert.ok(!JSON.stringify(body).includes("conta-anterior"));
      const consulta = chamadasDe("olistSyncCobertura.findMany")[0].args;
      assert.equal(consulta.take, 80); assert.equal(objeto(consulta.where).configuracaoId, GRUPO);
      assert.equal(objeto(consulta.select).assinaturaEscopo, undefined);
    }
  });

  await t.test("nega não autenticados e filhos mesmo com todas as flags", async () => {
    reset(); assert.equal((await GET(new Request("https://example.test"), contexto("registros"))).status, 401);
    assert.equal(chamadasDe("olistSyncRegistro.findMany").length, 0);
    usuarioApp = FILHO;
    assert.equal((await GET(request("registros"), contexto("registros"))).status, 403);
    assert.equal(chamadasDe("olistSyncRegistro.findMany").length, 0);
    reset(); permissao.podeExecutarSincronizacaoOlist = false;
    assert.equal((await POST(request("execucoes", "POST", { modo: "AUDITAR", idempotencia: IDEMPOTENCIA }), contexto("execucoes"))).status, 403);
    assert.equal(chamadasDe("olistSyncExecucao.create").length, 0);
  });

  await t.test("listagens limitam e paginam no banco, ocultam documento e respeitam grupo", async () => {
    reset();
    const response = await GET(request("registros?limit=25&offset=25"), contexto("registros"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.offset, 25); assert.equal(body.limit, 25);
    assert.equal(body.itens[0].chave, undefined); assert.match(body.itens[0].chaveExibicao, /Identificador protegido/);
    const args = chamadasDe("olistSyncRegistro.findMany")[0].args;
    assert.equal(objeto(args.where).configuracaoId, GRUPO); assert.equal(args.take, 25); assert.equal(args.skip, 25);
    assert.equal(objeto(args.select).dadosCriptografados, undefined);
    for (const query of ["limit=101", "limit=0", "offset=-1", "aplicativoId=invalido", "entidade=PEDIDO"]) assert.equal((await GET(request(`registros?${query}`), contexto("registros"))).status, 400);
  });

  await t.test("filtro de proveniência chega à consulta, sem filtrar toda a base em memória", async () => {
    reset();
    const response = await GET(request("registros?origemTipo=DESCONHECIDA"), contexto("registros"));
    assert.equal(response.status, 200);
    assert.equal(objeto(chamadasDe("olistSyncRegistro.findMany")[0].args.where).origemTipo, "DESCONHECIDA");
  });

  await t.test("pendências filtram empresa no banco sem carregar conteúdo protegido ou estados", async () => {
    reset();
    const response = await GET(request(`pendencias?aplicativoId=${FILHO}&limit=10&offset=20`), contexto("pendencias"));
    assert.equal(response.status, 200);
    const consulta = chamadasDe("olistSyncPendencia.findMany")[0].args;
    assert.equal(consulta.take, 10); assert.equal(consulta.skip, 20);
    assert.deepEqual(objeto(consulta.where).OR, [
      { aplicativoId: FILHO },
      { aplicativoId: null, registro: { estados: { some: { aplicativoId: FILHO } } } },
    ]);
    assert.equal(objeto(consulta.where).configuracaoId, GRUPO);
    assert.deepEqual(chamadasDe("olistSyncPendencia.count")[0].args.where, consulta.where);
    assert.equal(objeto(consulta.select).detalhesCriptografados, undefined);
    assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
  });

  await t.test("detalhes externos ao grupo não são revelados", async () => {
    reset();
    const response = await GET(request(`pendencias/${EXTERNO}`), contexto(`pendencias/${EXTERNO}`));
    assert.equal(response.status, 404);
    assert.equal(objeto(chamadasDe("olistSyncPendencia.findFirst")[0].args.where).configuracaoId, GRUPO);
    assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
    assert.equal((await GET(request(`execucoes/${EXTERNO}`), contexto(`execucoes/${EXTERNO}`))).status, 404);
  });

  await t.test("comparação só decifra sob demanda e apresenta campos das empresas habilitadas", async () => {
    reset();
    const observacao = { id: "123", chave: "SKU1", nome: "Produto", situacao: "A", completo: true, alteradoEm: null, campos: { sku: "SKU1", descricao: "Produto" }, pendencias: [] };
    handlers["olistSyncEstado.findMany"] = () => [{ aplicativoId: FILHO, remoteId: "123", dadosCriptografados: criptografia.cifrar(observacao, `${GRUPO}:estado:${FILHO}:PRODUTO:123`), participante: { aplicativo: { nome: "Filial" } } }];
    let response = await GET(request("pendencias"), contexto("pendencias"));
    assert.equal(response.status, 200); assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
    response = await GET(request(`pendencias/${PENDENCIA}`), contexto(`pendencias/${PENDENCIA}`));
    const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.comparacao[0].campos.sku, "SKU1");
    const where = objeto(chamadasDe("olistSyncEstado.findMany")[0].args.where);
    assert.equal(where.configuracaoId, GRUPO); assert.deepEqual(where.participante, { habilitado: true });
    assert.equal(body.detalhesCriptografados, undefined);
  });

  await t.test("edição não aceita filhos externos, flags globais ou versão obsoleta", async () => {
    reset();
    const input = { versao: 1, ativo: true, entidades: ["PRODUTO"], participantesIds: [FILHO, OUTRO], horaDiaria: "02:00", limiteAlteracoes: 100, prontidao: { sincronizacaoNativaCompativel: false, semanticaPutValidada: false, incrementalValidado: false } };
    assert.equal((await PUT(request("configuracao", "PUT", { ...input, participantesIds: [FILHO, EXTERNO] }), contexto("configuracao"))).status, 400);
    assert.equal(chamadasDe("olistSyncConfiguracao.updateMany").length, 0);
    assert.equal((await PUT(request("configuracao", "PUT", { ...input, jobs: [] }), contexto("configuracao"))).status, 400);
    handlers["olistSyncConfiguracao.updateMany"] = () => ({ count: 0 });
    assert.equal((await PUT(request("configuracao", "PUT", input), contexto("configuracao"))).status, 409);
    assert.equal(chamadasDe("olistSyncParticipante.updateMany").length, 0);
  });

  await t.test("elegibilidade preserva filhos desabilitados e origem histórica de aplicativo bloqueado", async () => {
    reset();
    const config = configuracao();
    config.participantes[1].habilitado = false;
    handlers["olistSyncConfiguracao.findUnique"] = () => config;
    handlers["aplicativo.findMany"] = () => [...empresas, { id: MATRIZ, nome: "Matriz", aplicativoPaiId: PAI }];
    const response = await GET(request("configuracao"), contexto("configuracao"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.aplicativosElegiveis, [
      { id: FILHO, nome: "Filial", habilitado: true }, { id: OUTRO, nome: "Seu Olhar", habilitado: false },
    ]);
    assert.ok(body.aplicativosOrigem.some((app: { id: string }) => app.id === MATRIZ));
    assert.equal(body.aplicativosBloqueados, undefined);
    const consulta = chamadasDe("aplicativo.findMany")[0].args;
    assert.deepEqual(consulta.select, { id: true, nome: true, aplicativoPaiId: true });
    assert.equal(consulta.take, 100);
  });

  await t.test("edição usa política relida na transação e rejeita bloqueio posterior ao escopo", async () => {
    reset();
    handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => ({ ...configuracao(), aplicativosBloqueados: [OUTRO] });
    const response = await PUT(request("configuracao", "PUT", configuracaoInput), contexto("configuracao"));
    assert.equal(response.status, 400);
    assert.deepEqual(chamadasDe("olistSyncConfiguracao.findUniqueOrThrow")[0].args.select, { aplicativoPaiId: true, aplicativosBloqueados: true, versao: true, entidades: true, participantes: { where: { habilitado: true }, select: { aplicativoId: true } } });
    assert.equal(chamadasDe("aplicativo.findMany")[0].args.take, 2);
    assert.equal(chamadasDe("olistSyncConfiguracao.updateMany").length, 0);
    assert.equal(chamadasDe("olistSyncParticipante.upsert").length, 0);
  });

  await t.test("seleção de participantes preserva bloqueios e recusa sua alteração pelo formulário", async () => {
    reset();
    assert.equal((await PUT(request("configuracao", "PUT", configuracaoInput), contexto("configuracao"))).status, 200);
    assert.equal(objeto(chamadasDe("olistSyncConfiguracao.updateMany")[0].args.data).aplicativosBloqueados, undefined);
    assert.equal(chamadasDe("olistSyncParticipante.upsert").length, 2);
    reset();
    assert.equal((await PUT(request("configuracao", "PUT", { ...configuracaoInput, aplicativosBloqueados: [] }), contexto("configuracao"))).status, 400);
    assert.equal(chamadasDe("olistSyncConfiguracao.updateMany").length, 0);
    assert.equal(chamadasDe("olistSyncParticipante.upsert").length, 0);
  });

  await t.test("política persistida vale para outro grupo e UUIDs fora do piloto", async () => {
    reset(); usuarioApp = EXTERNO;
    const bloqueado = "60000000-0000-4000-8000-000000000001", livre = "60000000-0000-4000-8000-000000000002";
    const config = { ...configuracao(), aplicativoPaiId: EXTERNO, aplicativosBloqueados: [bloqueado], participantes: [] };
    handlers["olistSyncConfiguracao.findUnique"] = () => config;
    handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => config;
    handlers["aplicativo.findMany"] = () => [bloqueado, livre].map(id => ({ id, nome: id, aplicativoPaiId: EXTERNO }));
    const response = await GET(request("configuracao"), contexto("configuracao"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.aplicativosElegiveis, [{ id: livre, nome: livre, habilitado: false }]);
    assert.equal((await PUT(request("configuracao", "PUT", { ...configuracaoInput, participantesIds: [bloqueado, livre] }), contexto("configuracao"))).status, 400);
    assert.equal(chamadasDe("olistSyncParticipante.upsert").length, 0);
  });

  for (const acao of ["APROVAR", "VINCULAR"] as const) {
    await t.test(`${acao} relê bloqueio administrativo sem mudança de versão antes de autorizar`, async () => {
      reset();
      handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => ({ ...configuracao(), aplicativosBloqueados: [OUTRO] });
      if (acao === "VINCULAR") handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, registroId: null, entidade: "FORMA_PAGAMENTO" });
      const path = `pendencias/${PENDENCIA}/decisao`, input = { ...decisao, acao, aplicativoFonteId: FILHO,
        vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: OUTRO, registroOlistId: "11" }] };
      const response = await POST(request(path, "POST", input), contexto(path));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /sem bloqueios/);
      assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
      assert.equal(chamadasDe("olistSyncOperacao.create").length, 0);
      assert.equal(chamadasDe("olistSyncRegistro.create").length, 0);
      assert.equal(chamadasDe("olistSyncPendencia.update").length, 0);
      assert.equal(chamadasDe("olistSyncEvento.create").length, 0);
    });
  }

  await t.test("vínculo usa participantes atuais mesmo quando o escopo anterior tinha dois habilitados", async () => {
    reset(); const config = configuracao();
    handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => ({ ...config, participantes: config.participantes.slice(0, 1) });
    handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, registroId: null, entidade: "FORMA_PAGAMENTO" });
    const path = `pendencias/${PENDENCIA}/decisao`;
    const response = await POST(request(path, "POST", { ...decisao, acao: "VINCULAR", vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: OUTRO, registroOlistId: "11" }] }), contexto(path));
    assert.equal(response.status, 400);
    assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
    assert.equal(chamadasDe("olistSyncPendencia.update").length, 0);
  });

  await t.test("rejeitar e ignorar continuam disponíveis após bloqueio de um participante", async () => {
    for (const acao of ["REJEITAR", "IGNORAR"]) {
      reset();
      handlers["olistSyncConfiguracao.findUniqueOrThrow"] = () => ({ ...configuracao(), aplicativosBloqueados: [OUTRO] });
      const path = `pendencias/${PENDENCIA}/decisao`;
      assert.equal((await POST(request(path, "POST", { ...decisao, acao }), contexto(path))).status, 200);
      assert.equal(chamadasDe("olistSyncPendencia.update").length, 1);
      assert.equal(chamadasDe("olistSyncOperacao.create").length, 0);
      assert.equal(chamadasDe("olistSyncEstado.findMany").length, 0);
    }
  });

  await t.test("declaração de origem exige versão e empresa do grupo; não agenda sincronização", async () => {
    reset(); const path = `registros/${REGISTRO}/origem`;
    assert.equal((await POST(request(path, "POST", { ...origem, revisao: 1 }), contexto(path))).status, 409);
    assert.equal((await POST(request(path, "POST", { ...origem, aplicativoOrigemId: EXTERNO }), contexto(path))).status, 400);
    assert.equal(chamadasDe("olistSyncRegistro.update").length, 0);
    assert.equal((await POST(request(path, "POST", origem), contexto(path))).status, 200);
    const data = objeto(chamadasDe("olistSyncRegistro.update")[0].args.data);
    assert.equal(data.origemTipo, "DECLARADA_POR_USUARIO"); assert.equal(data.aplicativoOrigemId, FILHO);
    assert.equal(data.ultimaFonteAppId, undefined); assert.equal(chamadasDe("olistSyncExecucao.create").length, 0);
    assert.equal(chamadasDe("olistSyncEvento.create").length, 1);
  });

  await t.test("repetir declaração com mesma chave preserva efeitos e rejeita outro conteúdo", async () => {
    reset(); const path = `registros/${REGISTRO}/origem`;
    handlers["olistSyncEvento.findFirst"] = () => ({ metadadosJson: origem });
    assert.equal((await POST(request(path, "POST", origem), contexto(path))).status, 200);
    assert.equal(chamadasDe("olistSyncRegistro.update").length, 0);
    assert.equal((await POST(request(path, "POST", { ...origem, registroOlistOrigemId: "999" }), contexto(path))).status, 409);
  });

  await t.test("decisão obsoleta e tentativa de escrita em forma de pagamento são bloqueadas", async () => {
    reset(); const path = `pendencias/${PENDENCIA}/decisao`;
    assert.equal((await POST(request(path, "POST", { ...decisao, versao: 2 }), contexto(path))).status, 409);
    assert.equal(chamadasDe("olistSyncPendencia.update").length, 0);
    handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, entidade: "FORMA_PAGAMENTO" });
    assert.equal((await POST(request(path, "POST", { ...decisao, acao: "APROVAR", aplicativoFonteId: FILHO }), contexto(path))).status, 409);
    assert.equal(chamadasDe("olistSyncOperacao.create").length, 0);
  });

  await t.test("rejeição é auditada sem aplicar e sem conceder precedência à origem", async () => {
    reset(); const path = `pendencias/${PENDENCIA}/decisao`;
    assert.equal((await POST(request(path, "POST", { ...decisao, acao: "REJEITAR" }), contexto(path))).status, 200);
    const data = objeto(chamadasDe("olistSyncPendencia.update")[0].args.data);
    assert.equal(data.status, "REJEITADA"); assert.equal(data.decididoPor, "usuario");
    assert.equal(chamadasDe("olistSyncEvento.create").length, 1);
    assert.equal(chamadasDe("olistSyncRegistro.update").length, 0);
    assert.equal(chamadasDe("olistSyncOperacao.create").length, 0);
  });

  await t.test("nova auditoria vinculada à revisão rejeita pendência externa ou obsoleta", async () => {
    reset(); let path = `pendencias/${EXTERNO}/decisao`;
    assert.equal((await POST(request(path, "POST", { ...decisao, acao: "REAUDITAR" }), contexto(path))).status, 404);
    path = `pendencias/${PENDENCIA}/decisao`;
    assert.equal((await POST(request(path, "POST", { ...decisao, versao: 2, acao: "REAUDITAR" }), contexto(path))).status, 409);
    assert.equal(chamadasDe("olistSyncExecucao.create").length, 0);
  });

  await t.test("aceite 202 só após registro durável, com idempotência e etapas de auditoria", async () => {
    reset();
    const input = { modo: "AUDITAR", idempotencia: IDEMPOTENCIA };
    let response = await POST(request("execucoes", "POST", input), contexto("execucoes"));
    assert.equal(response.status, 202); const body = await response.json();
    assert.equal(body.id, EXECUCAO); assert.equal(body.status, "PENDENTE"); assert.ok(body.statusUrl.endsWith(EXECUCAO));
    const etapas = chamadasDe("olistSyncEtapa.createMany")[0].args.data as { aplicativoId: string; fase: string }[];
    assert.equal(etapas.length, 8); assert.ok(etapas.every((item) => item.aplicativoId !== PAI && item.fase === "LISTAR"));
    handlers["olistSyncExecucao.findUnique"] = () => execucao;
    response = await POST(request("execucoes", "POST", input), contexto("execucoes"));
    assert.equal(response.status, 202); assert.equal(chamadasDe("olistSyncExecucao.create").length, 1);
    assert.equal((await POST(request("execucoes", "POST", { ...input, modo: "APLICAR" }), contexto("execucoes"))).status, 409);
  });

  await t.test("API preserva completa por omissão e aceita automático explícito sem certificação global", async () => {
    for (const completa of [undefined, false, true]) {
      reset();
      const input = { modo: "AUDITAR", idempotencia: IDEMPOTENCIA, ...(completa === undefined ? {} : { completa }) };
      assert.equal((await POST(request("execucoes", "POST", input), contexto("execucoes"))).status, 202);
      assert.equal(objeto(chamadasDe("olistSyncExecucao.create")[0].args.data).completa, completa ?? true);
    }
    reset(); handlers["olistSyncExecucao.findUnique"] = () => execucao;
    assert.equal((await POST(request("execucoes", "POST", { modo: "AUDITAR", idempotencia: IDEMPOTENCIA, completa: false }), contexto("execucoes"))).status, 409);
  });

  await t.test("vínculo manual de formas de pagamento mantém origem desconhecida e não escreve na Olist", async () => {
    reset(); const path = `pendencias/${PENDENCIA}/decisao`;
    const detalhesCriptografados = criptografia.cifrar({ aplicativoId: FILHO, remoteId: "10" }, `${GRUPO}:pendencia:dedupe`);
    handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, registroId: null, entidade: "FORMA_PAGAMENTO", tipo: "IDENTIDADE_REQUER_REVISAO", detalhesCriptografados });
    const estados = [FILHO, OUTRO].map((app, index) => ({ id: `estado-${index}`, registroId: null, aplicativoId: app, remoteId: String(10 + index), presente: true, detalhePendente: false, metadadosJson: {}, dadosCriptografados: criptografia.cifrar({ id: String(10 + index), chave: null, nome: "Cartão", situacao: "1", completo: true, alteradoEm: null, campos: { nome: "Cartão" }, pendencias: ["IDENTIDADE_REQUER_REVISAO"] }, `${GRUPO}:estado:${app}:FORMA_PAGAMENTO:${10 + index}`) }));
    handlers["olistSyncEstado.findMany"] = () => estados;
    handlers["olistSyncRegistro.create"] = () => ({ id: REGISTRO });
    handlers["olistSyncEstado.update"] = () => ({ id: "estado" });
    handlers["olistSyncPendencia.updateMany"] = () => ({ count: 1 });
    const input = { ...decisao, acao: "VINCULAR", vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: OUTRO, registroOlistId: "11" }] };
    assert.equal((await POST(request(path, "POST", input), contexto(path))).status, 200);
    const data = objeto(chamadasDe("olistSyncRegistro.create")[0].args.data);
    assert.equal(data.origemTipo, "DESCONHECIDA"); assert.match(String(data.chave), /^manual:/);
    assert.equal(data.aplicativoOrigemId, undefined);
    assert.equal(chamadasDe("olistSyncEstado.update").length, 2);
    assert.equal(chamadasDe("olistSyncOperacao.create").length, 0);
    assert.equal(chamadasDe("olistSyncExecucao.create").length, 0);
    assert.equal(chamadasDe("olistSyncEvento.create").length, 1);
  });

  await t.test("vínculo exige empresas distintas habilitadas e não admite produtos com outro SKU", async () => {
    reset(); const path = `pendencias/${PENDENCIA}/decisao`;
    const vinculo = { ...decisao, acao: "VINCULAR", vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: OUTRO, registroOlistId: "11" }] };
    assert.equal((await POST(request(path, "POST", vinculo), contexto(path))).status, 400);
    handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, registroId: null, entidade: "FORMA_PAGAMENTO" });
    assert.equal((await POST(request(path, "POST", { ...vinculo, vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: EXTERNO, registroOlistId: "11" }] }), contexto(path))).status, 400);
    assert.equal((await POST(request(path, "POST", { ...vinculo, vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: FILHO, registroOlistId: "11" }] }), contexto(path))).status, 400);
    assert.equal(chamadasDe("olistSyncRegistro.create").length, 0);
  });

  await t.test("vínculo manual não substitui documento confiável nem reativa registros inativos", async () => {
    const path = `pendencias/${PENDENCIA}/decisao`;
    const input = { ...decisao, acao: "VINCULAR", vinculos: [{ aplicativoId: FILHO, registroOlistId: "10" }, { aplicativoId: OUTRO, registroOlistId: "11" }] };
    for (const caso of [{ entidade: "CONTATO", chave: "12345678909", situacao: "B", completo: true }, { entidade: "FORMA_PAGAMENTO", chave: null, situacao: "2", completo: true }, { entidade: "VENDEDOR", chave: null, situacao: "B", completo: false }]) {
      reset();
      handlers["olistSyncPendencia.findFirst"] = () => ({ ...pendencia, registroId: null, entidade: caso.entidade, tipo: "IDENTIDADE_REQUER_REVISAO", detalhesCriptografados: criptografia.cifrar({ aplicativoId: FILHO, remoteId: "10" }, `${GRUPO}:pendencia:dedupe`) });
      handlers["olistSyncEstado.findMany"] = () => [FILHO, OUTRO].map((app, index) => ({ id: `estado-${index}`, registroId: null, aplicativoId: app, remoteId: String(10 + index), metadadosJson: {}, dadosCriptografados: criptografia.cifrar({ id: String(10 + index), chave: caso.chave, nome: "Cadastro", situacao: caso.situacao, completo: caso.completo, alteradoEm: null, campos: {}, pendencias: [] }, `${GRUPO}:estado:${app}:${caso.entidade}:${10 + index}`) }));
      assert.equal((await POST(request(path, "POST", input), contexto(path))).status, 409, caso.entidade);
      assert.equal(chamadasDe("olistSyncRegistro.create").length, 0);
    }
  });

  await t.test("job ausente, pausado ou sem flag exata no pai impede aceite", async () => {
    const input = { modo: "AUDITAR", idempotencia: IDEMPOTENCIA };
    for (const job of [null, { pausado: true }]) {
      reset(); handlers["configuracaoJob.findUnique"] = () => job;
      assert.equal((await POST(request("execucoes", "POST", input), contexto("execucoes"))).status, 503);
      assert.equal(chamadasDe("olistSyncExecucao.create").length, 0);
    }
    reset(); handlers["olistSyncConfiguracao.findUnique"] = () => ({ ...configuracao(), aplicativoPai: { id: PAI, jobs: "PREFIXO_AUDITAR_SINCRONIZACAO_OLIST" } });
    assert.equal((await POST(request("execucoes", "POST", input), contexto("execucoes"))).status, 503);
    assert.equal(chamadasDe("olistSyncExecucao.create").length, 0);
  });
});
