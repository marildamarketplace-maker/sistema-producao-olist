import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { aplicarMigrationsOlistSync } from "./fixtures/olist-sync-migrations";
import { criarOlistSyncRepository } from "../src/repositories/olist-sync-repository";
import { criarServicoOlistSync } from "../src/services/olist-sync-service";
import { resolverPendenciaSync } from "../src/services/olist-sync-review-service";
import { criarClienteSync, type RequisicaoSync, type RespostaHttpSync } from "../src/lib/olist-sync/cliente";
import { criarCriptografiaSync } from "../src/lib/olist-sync/cripto";
import type { CotaLeituraSync } from "../src/lib/olist-sync/ritmo";
import type { CamposSync } from "../src/lib/olist-sync/contrato";

const url = process.env.OLIST_SYNC_INCREMENTAL_TEST_DATABASE_URL;
const dia = 86_400_000;

test("Olist sync incremental: cobertura, consistência e custo de coleta", { skip: !url, timeout: 240_000 }, async t => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname));
  assert.match(endereco.pathname, /^\/olist_sync_test_incremental$/);
  const sql = new Client({ connectionString: url! }); await sql.connect(); t.after(() => sql.end());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) }); t.after(() => db.$disconnect());
  assert.equal((await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'")).rows[0].total, 0);
  await sql.query(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL,jobs text NOT NULL DEFAULT '',aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),ativo boolean NOT NULL DEFAULT true);
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY,pausado boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),termos_ignorados_nome_arquivo text[] DEFAULT '{}',variantes_permitidas text[] DEFAULT '{}');
    CREATE TABLE integracao_olist_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;`);
  const pai = "00000000-0000-0000-0000-000000000002", a = "00000000-0000-0000-0000-000000000004", b = "00000000-0000-0000-0000-000000000005", usuario = randomUUID();
  await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Pai')", [pai]);
  await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$3),($2,'B',$3)", [a, b, pai]);
  await aplicarMigrationsOlistSync(sql);
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist,pode_configurar_sincronizacao_olist,pode_resolver_sincronizacao_olist) VALUES ($1,$2,true,true,true)", [usuario, pai]);
  const repo = criarOlistSyncRepository(db), config = await repo.obterConfiguracao(pai); assert.ok(config);
  const grupo = config.id;
  const cripto = criarCriptografiaSync({ OLIST_SYNC_DATA_KEY: Buffer.alloc(32, 1).toString("base64"), OLIST_SYNC_HMAC_KEY: Buffer.alloc(32, 2).toString("base64") });
  const contas = new Map<string, Map<string, CamposSync>>();
  const cotas = new Map<string, CotaLeituraSync>();
  const documentos = new Map([[a, "04252011000110"], [b, "11222333000181"]]);
  let agora = Date.now(), proximoId = 10_000;
  const chamadas: { requisicao: RequisicaoSync; instante: number; bytesResposta: number }[] = [];
  let interceptar: ((r: RequisicaoSync, app: string) => Promise<RespostaHttpSync | undefined>) | null = null;
  const cliente = criarClienteSync({
    async configurar() { return { apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }; },
    async token(app) { return app; },
    async http(r) {
      const app = r.token, conta = contas.get(app); assert.ok(conta, "Não pode consultar uma conta fora do grupo.");
      const medicao = { requisicao: r, instante: agora, bytesResposta: 0 }; chamadas.push(medicao);
      const responder = (resposta: RespostaHttpSync) => {
        medicao.bytesResposta = Buffer.byteLength(JSON.stringify(resposta.dados), "utf8");
        const cota=cotas.get(app);
        return {...resposta,...(r.metodo==="GET" && cota && !resposta.cotaLeitura?{cotaLeitura:cota}:{})};
      };
      const interceptada = await interceptar?.(r, app); if (interceptada) return responder(interceptada);
      const caminho = new URL(r.url);
      if (caminho.pathname.endsWith("/info")) return responder({ status: 200, dados: { cpfCnpj: documentos.get(app), razaoSocial: "Conta de teste" } });
      if (caminho.pathname.endsWith("/produtos") && r.metodo === "GET") {
        const desde = caminho.searchParams.get("dataAlteracao"), codigo = caminho.searchParams.get("codigo");
        const offset = Number(caminho.searchParams.get("offset") ?? 0), limit = Number(caminho.searchParams.get("limit") ?? 100);
        // Esta fixture valida o filtro no fuso UTC; a API recebe data/hora local sem offset.
        const limiteInferior = desde ? Date.parse(`${desde.replace(" ", "T")}Z`) : null;
        const itens = [...conta.values()].filter(item => (!codigo || item.sku === codigo) && (limiteInferior === null || Date.parse(String(item.dataAlteracao)) >= limiteInferior));
        return responder({ status: 200, dados: { itens: itens.slice(offset, offset + limit), paginacao: { total: itens.length, offset, limit } } });
      }
      const id = caminho.pathname.split("/").at(-1)!;
      if (r.metodo === "GET") return responder(conta.has(id) ? { status: 200, dados: conta.get(id) } : { status: 404, dados: {} });
      assert.ok(r.payload && !Array.isArray(r.payload) && typeof r.payload === "object");
      for (const protegido of ["estoque", "precos", "custos", "tributacao"]) assert.equal(protegido in r.payload, false);
      if (r.metodo === "POST") {
        const novo = String(proximoId++); conta.set(novo, { id: Number(novo), situacao: "A", ...r.payload, dataAlteracao: new Date(agora).toISOString() });
        return responder({ status: 200, dados: { id: Number(novo) } });
      }
      conta.set(id, { ...conta.get(id), ...r.payload, dataAlteracao: new Date(agora).toISOString() });
      return responder({ status: 204, dados: null });
    },
  });
  const servico = criarServicoOlistSync(db, cliente, { agora: () => new Date(agora), aguardar: async ms => { agora += ms; }, cripto });
  const produto = (id: number, indice = 0): CamposSync => ({ id, sku: `SKU-${String(indice).padStart(5, "0")}`, descricao: `Ref Produto ${indice}`, tipo: "S", situacao: "A", dataAlteracao: new Date(agora - 3 * dia).toISOString(), estoque: { saldo: 10 } });
  const escritas = () => chamadas.filter(c => c.requisicao.metodo !== "GET");
  const listas = () => chamadas.filter(c => new URL(c.requisicao.url).pathname.endsWith("/produtos") && !new URL(c.requisicao.url).searchParams.has("codigo"));
  async function reset(quantidade = 1) {
    await sql.query("TRUNCATE olist_sync_cobertura,olist_sync_registro,olist_sync_execucao CASCADE");
    await db.configuracaoJob.updateMany({ data: { pausado: false } });
    await db.olistSyncConfiguracao.update({ where: { id: grupo }, data: { ativo: true, entidades: ["PRODUTO"], versao: 1, autorizadoPor: usuario, limiteAlteracoes: 100, readinessJson: { sincronizacaoNativaCompativel: true, semanticaPutValidada: true }, proximaExecucaoEm: new Date(Date.now() + 30 * dia) } });
    await db.olistSyncParticipante.updateMany({ where: { configuracaoId: grupo }, data: { contaIdentidade: null, proximaChamadaEm: null } });
    await db.olistSyncParticipante.updateMany({ where: { configuracaoId: grupo, aplicativoId: { notIn: [a, b] } }, data: { habilitado: false } });
    agora = Date.now() + 1000; proximoId = 10_000; interceptar = null; chamadas.length = 0; contas.clear(); cotas.clear();
    for (const app of [a, b]) {
      const itens = new Map<string, CamposSync>(); contas.set(app, itens);
      for (let i = 0; i < quantidade; i++) { const id = (app === a ? 100 : 1000) + i; itens.set(String(id), produto(id, i)); }
    }
    documentos.set(b, "11222333000181");
  }
  const enfileirar = (completa = false, modo: "AUDITAR" | "AUDITAR_E_APLICAR" = "AUDITAR") => repo.enfileirar({ configuracaoId: grupo, modo, completa, idempotencia: randomUUID(), solicitadoPor: usuario, origem: "MANUAL" });
  async function passo() {
    agora += 6_001;
    const reserva = await repo.reservarEtapa({ agora: new Date(agora) });
    if (reserva) await servico.processar(reserva);
    return reserva;
  }
  async function terminar(execucaoId: string, limite = 2500) {
    for (let i = 0; i < limite; i++) {
      const execucao = await db.olistSyncExecucao.findUniqueOrThrow({ where: { id: execucaoId } });
      if (["CONCLUIDA", "CONCLUIDA_COM_PENDENCIAS", "CANCELADA", "FALHOU"].includes(execucao.status)) return execucao;
      await passo();
    }
    assert.fail("Execução incremental não terminou dentro do limite de etapas simulado.");
  }
  async function validarIncremental() {
    const coberturas = await db.olistSyncCobertura.findMany({ where: { configuracaoId: grupo, entidade: "PRODUTO" } });
    assert.equal(coberturas.length, 2);
    for (const cobertura of coberturas) {
      assert.ok(cobertura.contaIdentidade);
      await db.olistSyncCobertura.update({ where: { id: cobertura.id }, data: { incrementalValidado: true, incrementalFuso: "UTC", incrementalContaIdentidade: cobertura.contaIdentidade, incrementalValidadoEm: new Date(agora), incrementalValidadoPor: usuario, incrementalVersaoContrato: 1 } });
    }
  }
  async function baseline(quantidade = 1) {
    await reset(quantidade); const execucao = await enfileirar(true); await terminar(execucao.id); await validarIncremental();
    chamadas.length = 0; agora += 2 * dia;
  }
  function alterar(app: string, id: string, campos: CamposSync) {
    const atual = contas.get(app)!.get(id); assert.ok(atual); contas.get(app)!.set(id, { ...atual, ...campos, dataAlteracao: new Date(agora).toISOString() });
  }
  const estados = () => db.olistSyncEstado.findMany({ where: { configuracaoId: grupo }, orderBy: [{ aplicativoId: "asc" }, { remoteId: "asc" }], select: { id: true, dadosCriptografados: true, fingerprint: true, presente: true, hashesJson: true } });
  const registros = () => db.olistSyncRegistro.findMany({ where: { configuracaoId: grupo }, orderBy: { chave: "asc" }, select: { id: true, revisao: true, hashesBaseJson: true, aplicativoOrigemId: true, origemTipo: true } });
  async function conflitoIncremental() {
    await reset(); contas.get(a)!.get("100")!.descricao = "Ref Cadastro inicial A";
    const completa = await enfileirar(true); await terminar(completa.id); await validarIncremental();
    agora += 2 * dia; chamadas.length = 0; alterar(a, "100", { descricao: "Ref Cadastro A alterado no delta" });
    const incremental = await enfileirar(); await terminar(incremental.id);
    const pendencia = await db.olistSyncPendencia.findFirstOrThrow({ where: { execucaoId: incremental.id, status: "AGUARDANDO_REVISAO" } });
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: b } })).ultimaExecucaoId, completa.id);
    const aprovar = async () => {
      const anterior = { data: process.env.OLIST_SYNC_DATA_KEY, hmac: process.env.OLIST_SYNC_HMAC_KEY };
      process.env.OLIST_SYNC_DATA_KEY = Buffer.alloc(32, 1).toString("base64");process.env.OLIST_SYNC_HMAC_KEY = Buffer.alloc(32, 2).toString("base64");
      try {
        const atual = await repo.obterConfiguracao(pai); assert.ok(atual);
        return await resolverPendenciaSync(db, atual, usuario, pendencia.id, { acao: "APROVAR", versao: pendencia.versao, aplicativoFonteId: a, motivo: "Conflito revisado e versão da empresa A aprovada" });
      } finally {
        if (anterior.data === undefined) delete process.env.OLIST_SYNC_DATA_KEY; else process.env.OLIST_SYNC_DATA_KEY = anterior.data;
        if (anterior.hmac === undefined) delete process.env.OLIST_SYNC_HMAC_KEY; else process.env.OLIST_SYNC_HMAC_KEY = anterior.hmac;
      }
    };
    return { completa, incremental, pendencia, aprovar };
  }

  async function prepararLegado() {
    await baseline();
    const completa = await db.olistSyncExecucao.findFirstOrThrow({ where: { configuracaoId: grupo, completa: true } });
    await db.olistSyncEtapa.updateMany({ where: { execucaoId: completa.id }, data: { cursorJson: {} } });
    await db.olistSyncCobertura.updateMany({ where: { configuracaoId: grupo }, data: { contaIdentidade: null, assinaturaEscopo: "", completaExecucaoId: null, completaIniciadaEm: null, completaEm: null, watermarkConfirmado: null, ultimaExecucaoId: null, incrementalEm: null, geracao: 0 } });
    await db.olistSyncEstado.updateMany({ where: { configuracaoId: grupo }, data: { fingerprint: null, ultimaListagemExecucaoId: null, ultimaCompletaExecucaoId: null } });
    return completa;
  }

  async function consumirComRitmo(execucaoId:string) {
    for(let i=0;i<30;i++) {
      await servico.executar(agora+240_000);
      const execucao=await db.olistSyncExecucao.findUniqueOrThrow({where:{id:execucaoId}});
      if(["CONCLUIDA","CONCLUIDA_COM_PENDENCIAS","FALHOU","CANCELADA"].includes(execucao.status))return execucao;
      agora+=60_000;
    }
    assert.fail("Consumidor não concluiu a coleta com ritmo real simulado.");
  }
  await t.test("delta vazio preserva plano e headers na transição LISTAR→DETALHAR e fecha cobertura",async()=>{
    await baseline();const anteriores=await estados();
    for(const app of [a,b])cotas.set(app,{limite:60,restante:59,resetSegundos:60});
    const e=await enfileirar();assert.equal((await consumirComRitmo(e.id)).status,"CONCLUIDA");
    assert.equal(chamadas.length,4);assert.deepEqual(await estados(),anteriores);
    const etapas=await db.olistSyncEtapa.findMany({where:{execucaoId:e.id,fase:"DETALHAR"},select:{aplicativoId:true,cursorJson:true,status:true}});
    for(const etapa of etapas) {
      const cursor=etapa.cursorJson as {plano:{modo:string;iniciadaEm:string;desde:string};cotaLeitura:{limite:number;restante:number};offset:number;total:number};
      assert.equal(cursor.plano.modo,"INCREMENTAL");assert.ok(cursor.plano.desde);assert.equal(cursor.cotaLeitura.limite,60);
      assert.equal(cursor.cotaLeitura.restante,59);assert.equal(cursor.total,0);assert.equal(cursor.offset,0);
      const cobertura=await db.olistSyncCobertura.findFirstOrThrow({where:{configuracaoId:grupo,aplicativoId:etapa.aplicativoId!,entidade:"PRODUTO"}});
      assert.equal(cobertura.watermarkConfirmado!.toISOString(),cursor.plano.iniciadaEm);
    }
    for(const app of [a,b]) {
      const leituras=chamadas.filter(c=>c.requisicao.token===app);
      assert.ok(leituras[1].instante-leituras[0].instante>=2_000&&leituras[1].instante-leituras[0].instante<6_000);
    }
  });
  await t.test("delta com alterações respeita 30/min e exclui a cota do fingerprint e payload",async()=>{
    await baseline(3);const anteriores=await estados();
    for(const app of [a,b])cotas.set(app,{limite:60,restante:59,resetSegundos:60});
    for(let i=0;i<3;i++)alterar(a,String(100+i),{descricao:`Ref Atualizado ${i}`});
    const e=await enfileirar();await consumirComRitmo(e.id);
    const detalhes=chamadas.filter(c=>/\/produtos\/\d+$/.test(new URL(c.requisicao.url).pathname));
    assert.equal(detalhes.length,3);
    for(let i=1;i<detalhes.length;i++)assert.ok(detalhes[i].instante-detalhes[i-1].instante>=2_000&&detalhes[i].instante-detalhes[i-1].instante<6_000);
    const inalterados=await db.olistSyncEstado.findMany({where:{configuracaoId:grupo,aplicativoId:b},orderBy:{remoteId:"asc"}});
    for(const estado of inalterados)assert.equal(estado.dadosCriptografados,anteriores.find(a=>a.id===estado.id)!.dadosCriptografados);
    const alterados=await db.olistSyncEstado.findMany({where:{configuracaoId:grupo,aplicativoId:a}});
    for(const estado of alterados) {
      const conteudo=cripto.decifrar(estado.dadosCriptografados!,`${grupo}:estado:${a}:PRODUTO:${estado.remoteId}`);
      assert.ok(conteudo&&typeof conteudo==="object"&&!Array.isArray(conteudo));assert.equal("cotaLeitura" in conteudo,false);
    }
    assert.equal(escritas().length,0);
  });
  await t.test("paginação incremental preserva offset, janela e cota entre páginas",async()=>{
    await baseline();for(let i=0;i<101;i++)contas.get(a)!.set(String(2000+i),{...produto(2000+i,i+1),dataAlteracao:new Date(agora).toISOString()});
    cotas.set(a,{limite:60,restante:59,resetSegundos:60});const e=await enfileirar();
    for(let i=0;i<30;i++) {
      const etapa=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:a}});
      if(etapa.fase==="DETALHAR") {
        const cursor=etapa.cursorJson as {plano:{modo:string;desde:string};offset:number;total:number;cotaLeitura:{restante:number}};
        assert.equal(cursor.plano.modo,"INCREMENTAL");assert.equal(cursor.offset,101);assert.equal(cursor.total,101);assert.equal(cursor.cotaLeitura.restante,59);
        break;
      }
      await passo();
    }
    const paginas=listas().filter(c=>c.requisicao.token===a).map(c=>new URL(c.requisicao.url));
    assert.deepEqual(paginas.map(p=>p.searchParams.get("offset")),["0","100"]);
    assert.equal(paginas[0].searchParams.get("dataAlteracao"),paginas[1].searchParams.get("dataAlteracao"));
    await repo.cancelarExecucao(e.id,pai);
  });
  await t.test("429 no delta preserva a janela, bloqueia a conta e só confirma marco após recuperação",async()=>{
    await baseline();alterar(a,"100",{descricao:"Ref Atualização pendente"});
    const antes=await db.olistSyncCobertura.findFirstOrThrow({where:{configuracaoId:grupo,aplicativoId:a}});
    const e=await enfileirar();
    interceptar=async(r,app)=>app===a&&new URL(r.url).pathname.endsWith("/produtos/100")
      ? {status:429,dados:{},retryAfter:"180",cotaLeitura:{limite:60,restante:0,resetSegundos:60}}:undefined;
    for(let i=0;i<30;i++) {await passo();if(await db.olistSyncEtapa.count({where:{execucaoId:e.id,erroCodigo:"OLIST_429"}}))break;}
    const etapa=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:a}});
    assert.equal(etapa.erroCodigo,"OLIST_429");const cursor=etapa.cursorJson as {plano:{modo:string;iniciadaEm:string;desde:string};cotaLeitura:{restante:number}};
    assert.equal(cursor.plano.modo,"INCREMENTAL");assert.equal(cursor.cotaLeitura.restante,0);
    assert.equal((await db.olistSyncCobertura.findUniqueOrThrow({where:{id:antes.id}})).watermarkConfirmado!.getTime(),antes.watermarkConfirmado!.getTime());
    assert.ok((await db.olistSyncParticipante.findFirstOrThrow({where:{configuracaoId:grupo,aplicativoId:a}})).proximaChamadaEm!.getTime()>=agora+180_000);
    interceptar=null;agora+=180_001;await consumirComRitmo(e.id);
    const depois=await db.olistSyncEtapa.findUniqueOrThrow({where:{id:etapa.id}});
    assert.deepEqual((depois.cursorJson as {plano:unknown}).plano,cursor.plano);
    assert.equal((await db.olistSyncCobertura.findUniqueOrThrow({where:{id:antes.id}})).watermarkConfirmado!.toISOString(),cursor.plano.iniciadaEm);
    assert.equal(escritas().length,0);
  });
  await t.test("automático sem baseline executa completa, sem permitir incremental apenas por prontidão global", async () => {
    await reset(); await db.olistSyncConfiguracao.update({ where: { id: grupo }, data: { readinessJson: { incrementalValidado: true } } });
    const execucao = await enfileirar(); await terminar(execucao.id);
    assert.ok(listas().length === 2 && listas().every(c => !new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
    const coberturas = await db.olistSyncCobertura.findMany({ where: { configuracaoId: grupo } });
    assert.equal(coberturas.length, 2); assert.ok(coberturas.every(c => c.completaEm && c.watermarkConfirmado));
  });

  await t.test("completa seguida de delta vazio preserva snapshots e revisões com quatro GETs", async () => {
    await baseline(); const antes = await estados(), bases = await registros();
    const execucao = await enfileirar(); await terminar(execucao.id);
    assert.equal(chamadas.length, 4); assert.equal(escritas().length, 0);
    assert.ok(listas().every(c => new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
    assert.deepEqual(await estados(), antes); assert.deepEqual(await registros(), bases);
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: execucao.id } }), 0);
    assert.equal(await db.olistSyncPendencia.count({ where: { tipo: "REGISTRO_REMOVIDO" } }), 0);
  });

  await t.test("delta unilateral usa réplica completa anterior e confirma atualização", async () => {
    await baseline(); alterar(a, "100", { descricao: "Ref Nova descrição" });
    const execucao = await enfileirar(false, "AUDITAR_E_APLICAR"); await terminar(execucao.id);
    assert.equal(contas.get(b)!.get("1000")!.descricao, "Ref Nova descrição"); assert.equal(escritas().length, 1);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status, "CONFIRMADA");
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: execucao.id } }), 1);
  });

  await t.test("deltas bilaterais conflitantes não elegem vencedor nem avançam base", async () => {
    await baseline(); const antes = await registros(); alterar(a, "100", { descricao: "Ref Valor A" }); alterar(b, "1000", { descricao: "Ref Valor B" });
    await terminar((await enfileirar(false, "AUDITAR_E_APLICAR")).id);
    assert.equal(escritas().length, 0); assert.deepEqual((await registros())[0].hashesBaseJson, antes[0].hashesBaseJson);
    assert.ok(await db.olistSyncPendencia.count({ where: { tipo: { startsWith: "CONFLITO" }, status: "AGUARDANDO_REVISAO" } }));
  });

  await t.test("aprovação manual de conflito incremental aceita a réplica completa preservada do outro irmão", async () => {
    const { pendencia, incremental, aprovar } = await conflitoIncremental();
    await aprovar();
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: pendencia.id } })).status, "APROVADA");
    const operacao = await db.olistSyncOperacao.findFirstOrThrow({ where: { registroId: pendencia.registroId!, status: "AUTORIZADA" } });
    assert.equal(operacao.execucaoId, incremental.id);assert.equal(operacao.sourceAppId, a);assert.equal(operacao.destinoAppId, b);
    assert.equal(escritas().length, 0, "Aprovação cria proposta; não executa a chamada durante a decisão.");
  });

  for (const alteracao of ["hashes", "presença", "fingerprint"] as const) {
    await t.test(`aprovação do delta rejeita alteração posterior de ${alteracao}`, async () => {
      const { pendencia, aprovar } = await conflitoIncremental();
      const estado = await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: b } });
      await db.olistSyncEstado.update({ where: { id: estado.id }, data: alteracao === "hashes" ? { hashesJson: { descricao: "Ref outra-versao" } } : alteracao === "presença" ? { presente: false } : { fingerprint: "outra-observacao" } });
      await assert.rejects(aprovar(), /mudou|removida|observação|Reaudite/i);
      assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: pendencia.id } })).status, "AGUARDANDO_REVISAO");
      assert.equal(await db.olistSyncOperacao.count({ where: { status: "AUTORIZADA" } }), 0);
    });
  }

  await t.test("sobreposição e timestamp novo com conteúdo igual não recifram nem reabrem revisão", async () => {
    await baseline(); const antes = await estados(), bases = await registros(); alterar(a, "100", {}); alterar(b, "1000", {});
    const execucao = await enfileirar(); await terminar(execucao.id);
    assert.deepEqual(await estados(), antes); assert.deepEqual(await registros(), bases);
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: execucao.id } }), 0); assert.equal(escritas().length, 0);
    chamadas.length = 0; await terminar((await enfileirar()).id);
    assert.deepEqual(await estados(), antes); assert.deepEqual(await registros(), bases);
  });

  await t.test("resumo parcial não apaga snapshot completo enquanto o detalhe está pendente", async () => {
    await baseline(); const antes = await estados(); alterar(a, "100", { descricao: "Ref Alteração aguardando detalhe" }); const e = await enfileirar();
    for (let i = 0; i < 20; i++) {
      if (await db.olistSyncEstado.count({ where: { aplicativoId: a, detalhePendente: true } })) break;
      await passo();
    }
    const pendente = await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a }, select: { detalhePendente: true, dadosCriptografados: true } });
    assert.equal(pendente.detalhePendente, true); assert.equal(pendente.dadosCriptografados, antes[0].dadosCriptografados);
    await terminar(e.id);
  });

  await t.test("mudança apenas de situação impede escrita mesmo quando os campos transferíveis são iguais", async () => {
    await baseline(); const antes = await registros(); alterar(a, "100", { situacao: "I" });
    const e = await enfileirar(false, "AUDITAR_E_APLICAR"); await terminar(e.id);
    assert.equal(escritas().length, 0); assert.ok((await registros())[0].revisao > antes[0].revisao);
    assert.ok(await db.olistSyncPendencia.count({ where: { tipo: "REGISTRO_INATIVO" } }));
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: e.id } }), 1);
  });

  await t.test("troca de identidade marca chave anterior e nova, sem criar duplicata automaticamente", async () => {
    await baseline(); alterar(a, "100", { sku: "SKU-ALTERADO" }); const e = await enfileirar(false, "AUDITAR_E_APLICAR"); await terminar(e.id);
    assert.equal(escritas().length, 0);
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: e.id } }), 2);
    assert.ok(await db.olistSyncPendencia.count({ where: { status: "AGUARDANDO_REVISAO" } }));
  });

  await t.test("nova duplicidade no delta inclui observação sem registro lógico e bloqueia aplicação", async () => {
    await baseline(); contas.get(a)!.set("999", { ...produto(999), dataAlteracao: new Date(agora).toISOString() });
    const e = await enfileirar(false, "AUDITAR_E_APLICAR"); await terminar(e.id);
    assert.equal(escritas().length, 0); assert.equal(await db.olistSyncEstado.count({ where: { aplicativoId: a } }), 2);
    assert.ok(await db.olistSyncPendencia.count({ where: { tipo: "IDENTIDADE_DUPLICADA" } }));
    const duplicada = await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a, remoteId: "999" } });
    assert.equal(duplicada.registroId, null);
    alterar(a, "999", { sku: "SKU-DUPLICATA-CORRIGIDA" });
    const corrigir = await enfileirar(false, "AUDITAR_E_APLICAR"); await terminar(corrigir.id);
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: corrigir.id, identidadeAlterada: true } }), 2,
      "A equivalência anterior também precisa ser reavaliada quando a duplicata não possui registroId");
    assert.equal(escritas().length, 0);
  });

  await t.test("cadastro novo sem chave recebe detalhe e pendência estável mesmo sem registro lógico", async () => {
    await baseline(); contas.get(a)!.set("999", { ...produto(999), sku: "", dataAlteracao: new Date(agora).toISOString() });
    await terminar((await enfileirar()).id);
    const estado = await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a, remoteId: "999" } });
    assert.equal(estado.registroId, null); assert.equal(estado.detalhePendente, false); assert.ok(estado.dadosCriptografados);
    const pendencia = await db.olistSyncPendencia.findFirstOrThrow({ where: { aplicativoId: a, registroId: null } });
    await terminar((await enfileirar()).id);
    const repetida = await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: pendencia.id } });
    assert.equal(repetida.versao, pendencia.versao); assert.equal(await db.olistSyncPendencia.count({ where: { aplicativoId: a, registroId: null } }), 1);
    assert.equal(escritas().length, 0);
  });

  await t.test("remoção não aparece como ausência no delta; completa posterior confirma 404 sem recriar", async () => {
    await baseline(); contas.get(a)!.delete("100"); const antes = await estados();
    await terminar((await enfileirar()).id); assert.deepEqual(await estados(), antes);
    assert.equal(await db.olistSyncPendencia.count({ where: { tipo: "REGISTRO_REMOVIDO" } }), 0);
    chamadas.length = 0; await terminar((await enfileirar(true, "AUDITAR_E_APLICAR")).id);
    assert.ok(chamadas.some(c => c.requisicao.token === a && c.requisicao.url.endsWith("/produtos/100")));
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a } })).presente, false);
    assert.ok(await db.olistSyncPendencia.count({ where: { tipo: "REGISTRO_REMOVIDO" } })); assert.equal(escritas().length, 0);
  });

  await t.test("watermark confirmado usa início da coleta e conserva sobreposição de 24 horas", async () => {
    await baseline(); const anterior = await db.olistSyncCobertura.findMany({ where: { configuracaoId: grupo } });
    alterar(a, "100", { descricao: "Ref Novo" }); const inicio = agora; const e = await enfileirar(); await terminar(e.id);
    const coberturas = await db.olistSyncCobertura.findMany({ where: { configuracaoId: grupo } });
    for (const cobertura of coberturas) {
      const lista = listas().find(c => c.requisicao.token === cobertura.aplicativoId)!; const ultima = anterior.find(c => c.aplicativoId === cobertura.aplicativoId)!;
      assert.ok(cobertura.watermarkConfirmado && cobertura.watermarkConfirmado.getTime() >= inicio && cobertura.watermarkConfirmado.getTime() <= lista.instante);
      const desde = new URL(lista.requisicao.url).searchParams.get("dataAlteracao"); assert.ok(desde); assert.ok(ultima.watermarkConfirmado);
      assert.ok(Date.parse(`${desde.replace(" ", "T")}Z`) <= ultima.watermarkConfirmado.getTime() - dia, "A janela deve repetir pelo menos as últimas 24 horas.");
    }
  });

  await t.test("validação ausente em uma conta mantém fallback completo apenas nessa conta", async () => {
    await baseline(); await db.olistSyncCobertura.updateMany({ where: { configuracaoId: grupo, aplicativoId: b }, data: { incrementalValidado: false } });
    await terminar((await enfileirar()).id);
    assert.ok(new URL(listas().find(c => c.requisicao.token === a)!.requisicao.url).searchParams.has("dataAlteracao"));
    assert.equal(new URL(listas().find(c => c.requisicao.token === b)!.requisicao.url).searchParams.has("dataAlteracao"), false);
  });

  await t.test("intervalo de quinze dias e solicitação manual forçam reconciliação completa", async () => {
    await baseline(); agora += 15 * dia; await terminar((await enfileirar()).id);
    assert.ok(listas().every(c => !new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
    chamadas.length = 0; await terminar((await enfileirar(true)).id);
    assert.ok(listas().every(c => !new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
  });

  await t.test("novo participante invalida a cobertura do conjunto anterior", async () => {
    await baseline(); const terceiro = randomUUID();
    await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'C',$2)", [terceiro, pai]);
    await db.olistSyncParticipante.create({ data: { configuracaoId: grupo, aplicativoId: terceiro, habilitado: true } });
    contas.set(terceiro, new Map([["2000", produto(2000)]]));documentos.set(terceiro, "12ABC34501DE35");
    await db.olistSyncConfiguracao.update({ where: { id: grupo }, data: { versao: { increment: 1 } } });
    await terminar((await enfileirar()).id);
    assert.equal(listas().length, 3);
    assert.ok(listas().every(c => !new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
  });

  await t.test("mudança de horário replaneja proposta antiga em delta vazio sem reler detalhes", async () => {
    await reset();contas.get(b)!.clear();
    const primeira = await enfileirar(true);await terminar(primeira.id);await validarIncremental();
    const antiga = await db.olistSyncOperacao.findFirstOrThrow({ where: { execucaoId: primeira.id, status: "AUTORIZADA" } });
    const configuracao = await db.olistSyncConfiguracao.update({ where: { id: grupo }, data: { versao: { increment: 1 }, horaDiaria: "03:00" } });
    chamadas.length = 0;agora += 2 * dia;
    const nova = await enfileirar();await terminar(nova.id);
    assert.equal(chamadas.length, 4, "Alteração administrativa não obriga reler conteúdos cuja cobertura permanece válida.");
    assert.ok(listas().every(c => new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: antiga.id } })).status, "OBSOLETA");
    const atual = await db.olistSyncOperacao.findFirstOrThrow({ where: { execucaoId: nova.id, status: "AUTORIZADA" } });
    assert.equal(atual.registroId, antiga.registroId);assert.notEqual(atual.id, antiga.id);
    assert.ok(atual.precondicoesJson && typeof atual.precondicoesJson === "object" && !Array.isArray(atual.precondicoesJson));
    assert.equal(atual.precondicoesJson.versaoConfiguracao, configuracao.versao);
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: nova.id } }), 1);assert.equal(escritas().length, 0);
  });

  await t.test("completa legada comprovada é adotada sem repetir o catálogo antes do primeiro delta", async () => {
    const anterior = await prepararLegado();
    await terminar((await enfileirar()).id);
    assert.equal(chamadas.length, 4);assert.ok(listas().every(c => new URL(c.requisicao.url).searchParams.has("dataAlteracao")));
    const coberturas = await db.olistSyncCobertura.findMany({ where: { configuracaoId: grupo } });
    assert.ok(coberturas.every(c => c.completaExecucaoId === anterior.id && c.completaEm && c.watermarkConfirmado));
  });

  await t.test("histórico legado com observação antiga não comprova ausência e força completa na conta", async () => {
    const anterior = await prepararLegado();
    await db.olistSyncEstado.updateMany({ where: { aplicativoId: a }, data: { ultimaExecucaoId: null } });contas.get(a)!.delete("100");
    const e = await enfileirar(); await terminar(e.id);
    assert.equal(new URL(listas().find(c => c.requisicao.token === a)!.requisicao.url).searchParams.has("dataAlteracao"), false);
    assert.equal((await db.olistSyncCobertura.findFirstOrThrow({ where: { aplicativoId: a } })).completaExecucaoId, e.id);
    assert.equal((await db.olistSyncCobertura.findFirstOrThrow({ where: { aplicativoId: b } })).completaExecucaoId, anterior.id);
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a } })).presente, false);assert.equal(escritas().length, 0);
  });

  await t.test("falha no detalhe não avança watermark da conta nem transforma réplica em ausente", async () => {
    await baseline(); const anterior = await db.olistSyncCobertura.findFirstOrThrow({ where: { configuracaoId: grupo, aplicativoId: a } });
    alterar(a, "100", { descricao: "Ref Não coletado" });
    interceptar = async (r, app) => app === a && r.metodo === "GET" && r.url.endsWith("/produtos/100") ? { status: 503, dados: {} } : undefined;
    const e = await enfileirar(); await terminar(e.id);
    const atual = await db.olistSyncCobertura.findUniqueOrThrow({ where: { id: anterior.id } });
    assert.deepEqual(atual.watermarkConfirmado, anterior.watermarkConfirmado);
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a } })).presente, true);
    assert.equal(escritas().length, 0);
  });

  for (const desfecho of ["alterado", "removido"] as const) {
    await t.test(`delta vazio recupera detalhe antigo pendente e confirma cadastro ${desfecho}`, async () => {
      await baseline(); alterar(a, "100", { descricao: "Ref Detalhe pendente da execução anterior" });
      interceptar = async (r, app) => app === a && r.metodo === "GET" && r.url.endsWith("/produtos/100") ? { status: 503, dados: {} } : undefined;
      await terminar((await enfileirar()).id);
      assert.equal((await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a } })).detalhePendente, true);
      interceptar = null; chamadas.length = 0; agora += 2 * dia;
      if (desfecho === "removido") contas.get(a)!.delete("100");
      else contas.get(a)!.get("100")!.dataAlteracao = new Date(agora - 10 * dia).toISOString();
      const e = await enfileirar(); await terminar(e.id);
      assert.ok(chamadas.some(c => c.requisicao.token === a && c.requisicao.url.endsWith("/produtos/100")), "A fila de detalhes antigos independe dos IDs retornados nesta janela.");
      const estado = await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a } });
      assert.equal(estado.detalhePendente, false);assert.equal(estado.presente, desfecho === "alterado");
      if (desfecho === "alterado") assert.equal(await db.olistSyncOperacao.count({ where: { execucaoId: e.id, sourceAppId: a, destinoAppId: b, status: "AUTORIZADA" } }), 1);
      else assert.ok(await db.olistSyncPendencia.count({ where: { tipo: "REGISTRO_REMOVIDO" } }));
      assert.equal(escritas().length, 0);
    });
  }

  for (const falha of ["total ausente", "página vazia prematura", "ID repetido entre páginas"] as const) {
    await t.test(`paginação com ${falha} não confirma cobertura nem autoriza escrita`, async () => {
      await baseline(); const anterior = await db.olistSyncCobertura.findFirstOrThrow({ where: { configuracaoId: grupo, aplicativoId: a } });
      alterar(a, "100", { descricao: "Ref Aguardando cobertura válida" });
      interceptar = async (r, app) => {
        const caminho = new URL(r.url);
        if (app !== a || r.metodo !== "GET" || !caminho.pathname.endsWith("/produtos")) return;
        const offset = Number(caminho.searchParams.get("offset") ?? 0);
        if (falha === "total ausente") return { status: 200, dados: { itens: [contas.get(a)!.get("100")] } };
        if (falha === "página vazia prematura") return { status: 200, dados: { itens: [], paginacao: { offset, limit: 100, total: 1 } } };
        return { status: 200, dados: { itens: [contas.get(a)!.get("100")], paginacao: { offset, limit: 100, total: 2 } } };
      };
      const e = await enfileirar(false, "AUDITAR_E_APLICAR"); await terminar(e.id);
      assert.deepEqual((await db.olistSyncCobertura.findUniqueOrThrow({ where: { id: anterior.id } })).watermarkConfirmado, anterior.watermarkConfirmado);
      assert.equal(escritas().length, 0);
      assert.ok(await db.olistSyncEtapa.count({ where: { execucaoId: e.id, erroCodigo: falha === "total ausente" ? "CONTRATO" : "COBERTURA_INCOMPLETA" } }));
    });
  }

  await t.test("cancelamento com alterações coletadas não perde a comparação na execução seguinte", async () => {
    await baseline(); alterar(a, "100", { descricao: "Ref Pendente de comparação" });
    const e = await enfileirar();
    for (let i = 0; i < 50 && !await db.olistSyncEtapa.count({ where: { execucaoId: e.id, fase: "COMPARAR", status: "PENDENTE" } }); i++) await passo();
    assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: e.id, fase: "COMPARAR", status: "PENDENTE" } }), 1);
    assert.ok(await db.olistSyncAfetado.count({ where: { execucaoId: e.id } }));
    await repo.cancelarExecucao(e.id, pai); await terminar(e.id);
    chamadas.length = 0; agora += 2 * dia;
    // A observação já persistida deve ser comparada mesmo se o provedor não a
    // repetir. A fila durável é a autoridade para esse trabalho interrompido.
    contas.get(a)!.get("100")!.dataAlteracao = new Date(agora - 10 * dia).toISOString();
    await terminar((await enfileirar(false, "AUDITAR_E_APLICAR")).id);
    assert.equal(contas.get(b)!.get("1000")!.descricao, "Ref Pendente de comparação"); assert.equal(escritas().length, 1);
  });

  await t.test("falha após comparar um lote transfere também itens já processados de uma comparação incompleta", async () => {
    await baseline(26);for (let i = 0; i < 26; i++) alterar(a, String(100 + i), { descricao: `Ref Alteração ${i}` });
    const e = await enfileirar();
    for (let i = 0; i < 200 && !await db.olistSyncAfetado.count({ where: { execucaoId: e.id, processadoEm: { not: null } } }); i++) await passo();
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: e.id, processadoEm: { not: null } } }), 25);
    agora += 6_001;const reserva = await repo.reservarEtapa({ agora: new Date(agora) });assert.ok(reserva);assert.equal(reserva.fase, "COMPARAR");
    await repo.falharEtapa(reserva, "FALHA_SIMULADA_COMPARACAO", null);await terminar(e.id);
    for (const item of contas.get(a)!.values()) item.dataAlteracao = new Date(agora - 10 * dia).toISOString();
    agora += 2 * dia;chamadas.length = 0;const nova = await enfileirar();await terminar(nova.id);
    assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: nova.id, processadoEm: { not: null } } }), 26);
    assert.equal(await db.olistSyncOperacao.count({ where: { execucaoId: nova.id, status: "AUTORIZADA" } }), 26);
    assert.equal(await db.olistSyncOperacao.count({ where: { execucaoId: e.id, status: "AUTORIZADA" } }), 0);
    assert.equal(escritas().length, 0);
  });

  await t.test("custos de coleta: fixtures com 0%, 1% e 100% de cem registros por conta", async () => {
    await baseline(100);
    const medidas: { percentual: number; gets: number; bytesJsonResposta: number }[] = [];
    for (const percentual of [0, 1, 100]) {
      chamadas.length = 0; agora += 2 * dia;
      for (let i = 0; i < percentual; i++) {
        alterar(a, String(100 + i), { descricao: `Ref Revisão ${percentual} do produto ${i}` });
        alterar(b, String(1000 + i), { descricao: `Ref Revisão ${percentual} do produto ${i}` });
      }
      const e = await enfileirar(); await terminar(e.id);
      const gets = chamadas.filter(c => c.requisicao.metodo === "GET").length;
      assert.equal(gets, 2 * (1 + Math.max(1, Math.ceil(percentual / 100)) + percentual));
      assert.equal(escritas().length, 0);
      assert.equal(await db.olistSyncAfetado.count({ where: { execucaoId: e.id } }), percentual);
      medidas.push({ percentual, gets, bytesJsonResposta: chamadas.reduce((total, c) => total + c.bytesResposta, 0) });
    }
    assert.ok(medidas[0].bytesJsonResposta < medidas[1].bytesJsonResposta && medidas[1].bytesJsonResposta < medidas[2].bytesJsonResposta);
    t.diagnostic(`Coleta simulada, bytes JSON Olist→servidor (não egress faturado): ${JSON.stringify(medidas)}`);
  });

  await t.test("novas tabelas mantêm RLS e impedem fila de comparação cruzando grupos", async () => {
    await reset();
    for (const tabela of ["olist_sync_cobertura", "olist_sync_afetado"]) {
      assert.equal((await sql.query("SELECT relrowsecurity FROM pg_class WHERE relname=$1", [tabela])).rows[0].relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) assert.equal((await sql.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS permitido", [role, tabela])).rows[0].permitido, false);
    }
    const outroPai = randomUUID();await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Outro grupo isolado')", [outroPai]);
    const outroGrupo = await db.olistSyncConfiguracao.create({ data: { aplicativoPaiId: outroPai } });
    const externo = await db.olistSyncRegistro.create({ data: { configuracaoId: outroGrupo.id, entidade: "PRODUTO", chave: "EXTERNO" } });
    const local = await db.olistSyncRegistro.create({ data: { configuracaoId: grupo, entidade: "PRODUTO", chave: "LOCAL" } });
    const e = await enfileirar();
    const outraExecucao = await db.olistSyncExecucao.create({ data: { configuracaoId: outroGrupo.id, chaveIdempotencia: randomUUID(), modo: "AUDITAR", versaoConfiguracao: 1 } });
    await assert.rejects(db.olistSyncAfetado.create({ data: { configuracaoId: grupo, execucaoId: e.id, entidade: "PRODUTO", registroId: externo.id } }));
    await assert.rejects(db.olistSyncAfetado.create({ data: { configuracaoId: grupo, execucaoId: outraExecucao.id, entidade: "PRODUTO", registroId: local.id } }));
    await assert.rejects(db.olistSyncCobertura.create({ data: { configuracaoId: outroGrupo.id, aplicativoId: a, entidade: "PRODUTO" } }));
    assert.equal(await db.olistSyncAfetado.count({ where: { configuracaoId: grupo } }), 0);
  });
});
