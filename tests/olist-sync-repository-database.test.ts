import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { criarOlistSyncRepository, ESTADOS_EXECUCAO_SYNC_ATIVOS, JOBS_SYNC, type ReservaEtapaSync } from "../src/repositories/olist-sync-repository";

const url = process.env.OLIST_SYNC_TEST_DATABASE_URL;
test("Olist sync: persistência real, isolamento, leases, gates e retenção", { skip: !url }, async t => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname));
  assert.match(endereco.pathname, /^\/olist_sync_test/);
  const sql = new Client({ connectionString: url! }); await sql.connect();
  t.after(() => sql.end());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) });
  t.after(() => db.$disconnect());
  assert.equal((await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'")).rows[0].total, 0, "Exige banco local vazio.");
  await sql.query(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL,jobs text NOT NULL DEFAULT '',aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),ativo boolean NOT NULL DEFAULT true);
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY,pausado boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),termos_ignorados_nome_arquivo text[] DEFAULT '{}',variantes_permitidas text[] DEFAULT '{}');
    CREATE TABLE integracao_olist_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
    GRANT ALL ON integracao_olist_tokens TO anon,authenticated;`);
  const pai = "00000000-0000-0000-0000-000000000002", matriz = "00000000-0000-0000-0000-000000000003";
  const filhoA = "00000000-0000-0000-0000-000000000004", filhoB = "00000000-0000-0000-0000-000000000005", isolado = "00000000-0000-0000-0000-000000000001";
  await sql.query("INSERT INTO aplicativo(id,nome,jobs) VALUES ($1,'Pai','EXISTENTE'),($2,'Isolado','')", [pai, isolado]);
  await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'Filho A',$4),($2,'Filho B',$4),($3,'Matriz excluída',$4)",[filhoA,filhoB,matriz,pai]);
  const migration = await readFile(new URL("../prisma/migrations/20261116000100_olist_sync_multiempresa/migration.sql", import.meta.url),"utf8");
  await sql.query(migration);
  const repo = criarOlistSyncRepository(db), config = await repo.obterConfiguracao(pai); assert.ok(config);
  const user = randomUUID(), userFilho = randomUUID();
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist,pode_configurar_sincronizacao_olist) VALUES ($1,$2,true,true),($3,$4,true,true)",[user,pai,userFilho,filhoA]);
  const nova = (modo: "AUDITAR" | "AUDITAR_E_APLICAR" | "APLICAR" = "AUDITAR", idempotencia = randomUUID()) => repo.enfileirar({configuracaoId:config.id,modo,idempotencia,solicitadoPor:user,origem:"MANUAL",completa:true});
  async function reservar():Promise<ReservaEtapaSync>{const reserva=await repo.reservarEtapa();assert.ok(reserva);return reserva;}
  async function cancelar(id:string){await repo.cancelarExecucao(id,pai);await db.olistSyncEtapa.updateMany({where:{execucaoId:id,status:"PROCESSANDO"},data:{status:"CANCELADA",leaseToken:null,leaseAte:null}});await repo.concluirExecucaoQuandoPossivel(id);}
  await t.test("seeds preservam pai e excluem matriz, jobs iniciam pausados e RLS protege tokens", async()=>{
    assert.equal(config.ativo,false);assert.deepEqual(config.participantes.map(p=>p.aplicativoId),[filhoA,filhoB]);
    assert.deepEqual(config.aplicativosBloqueados,[matriz],"A exclusão obrigatória deve ser política persistida do grupo.");
    assert.equal(config.aplicativoPai.jobs.includes("EXISTENTE"),true);
    for(const job of Object.values(JOBS_SYNC))assert.equal((await db.configuracaoJob.findUniqueOrThrow({where:{chave:job.chave},select:{pausado:true}})).pausado,true);
    assert.equal((await sql.query("SELECT jobs FROM aplicativo WHERE id=$1",[filhoA])).rows[0].jobs,"");
    for(const table of ["olist_sync_configuracao","olist_sync_participante","olist_sync_registro","olist_sync_estado","olist_sync_execucao","olist_sync_etapa","olist_sync_operacao","olist_sync_pendencia","olist_sync_evento","integracao_olist_tokens"]){
      assert.equal((await sql.query("SELECT relrowsecurity FROM pg_class WHERE relname=$1",[table])).rows[0].relrowsecurity,true);
      for(const role of ["anon","authenticated"])assert.equal((await sql.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS permitido",[role,table])).rows[0].permitido,false);
    }
    await assert.rejects(nova(),/pausado/);
    await db.configuracaoJob.updateMany({where:{chave:{in:Object.values(JOBS_SYNC).map(j=>j.chave)}},data:{pausado:false}});
    await db.olistSyncConfiguracao.update({where:{id:config.id},data:{ativo:true,autorizadoPor:user}});
  });
  await t.test("gates recusam usuário filho e vínculo externo; reparent exige desabilitar",async()=>{
    await assert.rejects(repo.enfileirar({configuracaoId:config.id,modo:"AUDITAR",idempotencia:randomUUID(),solicitadoPor:userFilho,origem:"MANUAL",completa:true}),/autorização/);
    await assert.rejects(db.olistSyncParticipante.create({data:{configuracaoId:config.id,aplicativoId:isolado,habilitado:true}}));
    await assert.rejects(sql.query("UPDATE aplicativo SET aplicativo_pai_id=$1 WHERE id=$2",[isolado,filhoA]));
    await assert.rejects(db.olistSyncParticipante.create({data:{configuracaoId:config.id,aplicativoId:pai,habilitado:true}}));
    await assert.rejects(db.olistSyncParticipante.create({data:{configuracaoId:config.id,aplicativoId:matriz,habilitado:true}}));
  });
  await t.test("aceite concorrente idempotente, uma execução ativa, duas contas e lease exclusivo",async()=>{
    const chave=randomUUID();const [a,b]=await Promise.all([nova("AUDITAR",chave),nova("AUDITAR",chave)]);assert.equal(a.id,b.id);
    await assert.rejects(nova(),/ativa/);await assert.rejects(nova("APLICAR",chave),/idempotência/);
    const reservas=await Promise.all([repo.reservarEtapa(),repo.reservarEtapa(),repo.reservarEtapa()]);
    const ativos=reservas.filter((r):r is ReservaEtapaSync=>Boolean(r));assert.ok(ativos.length>=1&&ativos.length<=2);
    if(ativos.length===1){const segunda=await reservar();ativos.push(segunda);}
    assert.notEqual(ativos[0].aplicativoId,ativos[1].aplicativoId);assert.equal(await repo.reservarEtapa(),null);
    const antiga=ativos[0];await db.olistSyncEtapa.update({where:{id:antiga.id},data:{leaseAte:new Date(0)}});
    const novaReserva=await reservar();assert.notEqual(novaReserva.leaseToken,antiga.leaseToken);
    assert.equal(await repo.salvarCheckpoint({etapaId:antiga.id,leaseToken:antiga.leaseToken,cursor:{offset:999}}),null);
    assert.equal(await repo.salvarCheckpoint({etapaId:novaReserva.id,leaseToken:novaReserva.leaseToken,cursor:{offset:100},status:"CONCLUIDA"}),true);
    await cancelar(a.id);
  });
  await t.test("pausa e ausência de job não consomem tentativas; manual independe do scheduler",async()=>{
    await db.configuracaoJob.update({where:{chave:JOBS_SYNC.agendar.chave},data:{pausado:true}});
    const e=await nova();
    await db.configuracaoJob.update({where:{chave:JOBS_SYNC.auditar.chave},data:{pausado:true}});
    assert.equal(await repo.reservarEtapa(),null);assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,tentativas:{gt:0}}}),0);
    await db.configuracaoJob.delete({where:{chave:JOBS_SYNC.auditar.chave}});assert.equal(await repo.reservarEtapa(),null);
    await db.configuracaoJob.create({data:{chave:JOBS_SYNC.auditar.chave,pausado:false}});
    const r=await reservar();await repo.falharEtapa(r,"FALHA_TRANSITORIA",60_000);
    assert.equal((await db.olistSyncEtapa.findUniqueOrThrow({where:{id:r.id}})).status,"AGUARDANDO_RETRY");
    await cancelar(e.id);
    await assert.rejects(repo.enfileirar({configuracaoId:config.id,modo:"AUDITAR",idempotencia:randomUUID(),solicitadoPor:null,origem:"AGENDADA",completa:true}),/pausado/);
    await db.configuracaoJob.update({where:{chave:JOBS_SYNC.agendar.chave},data:{pausado:false}});
  });
  await t.test("flags somente no filho não concedem gate do pai e autorização revogada bloqueia reserva",async()=>{
    const e=await nova();const flags=config.aplicativoPai.jobs;
    await sql.query("UPDATE aplicativo SET jobs='' WHERE id=$1",[pai]);await sql.query("UPDATE aplicativo SET jobs=$1 WHERE id=$2",[flags,filhoA]);
    assert.equal(await repo.reservarEtapa(),null);
    await sql.query("UPDATE aplicativo SET jobs=$1 WHERE id=$2",[flags,pai]);await sql.query("UPDATE usuario SET pode_executar_sincronizacao_olist=false WHERE id=$1",[user]);
    assert.equal(await repo.reservarEtapa(),null);await sql.query("UPDATE usuario SET pode_executar_sincronizacao_olist=true WHERE id=$1",[user]);
    await cancelar(e.id);
  });
  await t.test("janela curta ignora jobs pausados, retries distantes e contas em uso",async()=>{
    const e=await nova(),agora=new Date(),janela=new Date(agora.getTime()+6000);
    await db.olistSyncEtapa.updateMany({where:{execucaoId:e.id},data:{disponivelEm:janela}});
    assert.equal((await repo.proximaJanelaEtapa({agora}))?.getTime(),janela.getTime());
    assert.equal(await repo.proximaJanelaEtapa({agora,limiteMs:5000}),null);
    await db.configuracaoJob.update({where:{chave:JOBS_SYNC.auditar.chave},data:{pausado:true}});
    assert.equal(await repo.proximaJanelaEtapa({agora}),null);
    await db.configuracaoJob.update({where:{chave:JOBS_SYNC.auditar.chave},data:{pausado:false}});
    await db.olistSyncEtapa.updateMany({where:{execucaoId:e.id},data:{disponivelEm:agora}});
    const primeira=await reservar(),segunda=await reservar();assert.notEqual(primeira.aplicativoId,segunda.aplicativoId);
    assert.equal(await repo.proximaJanelaEtapa({agora}),null);
    await cancelar(e.id);
  });
  await t.test("aplicação pausada libera execução para novas auditorias",async()=>{
    const e=await nova("APLICAR");await db.configuracaoJob.update({where:{chave:JOBS_SYNC.aplicar.chave},data:{pausado:true}});
    assert.equal(await repo.reservarEtapa(),null);
    assert.ok(["CONCLUIDA","CONCLUIDA_COM_PENDENCIAS"].includes((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status));
    const auditoria=await nova();await cancelar(auditoria.id);
    await db.configuracaoJob.update({where:{chave:JOBS_SYNC.aplicar.chave},data:{pausado:false}});
  });
  await t.test("cancelamento em voo persiste checkpoint e conclui sem reabrir a etapa",async()=>{
    const e=await nova();const r=await reservar();
    assert.equal((await repo.cancelarExecucao(e.id,pai)).cancelamentoSolicitado,true);
    assert.equal(await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{respostaPersistida:true}}),true);
    assert.equal((await db.olistSyncEtapa.findUniqueOrThrow({where:{id:r.id}})).status,"CANCELADA");
    assert.equal((await repo.concluirExecucaoQuandoPossivel(e.id))?.status,"CANCELADA");
  });
  await t.test("alteração de configuração termina após a fronteira segura e libera grupo",async()=>{
    const e=await nova();const r=await reservar();
    await db.olistSyncConfiguracao.update({where:{id:config.id},data:{versao:{increment:1}}});
    assert.equal(await repo.reservarEtapa(),null);
    assert.equal(await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{offset:100}}),true);
    assert.equal(await repo.reservarEtapa(),null);
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA_COM_PENDENCIAS");
    const proxima=await nova();await cancelar(proxima.id);
  });
  await t.test("queda durante escrita preserva incerteza e esgotamento não repete infinitamente",async()=>{
    const e=await nova("APLICAR"),r=await reservar();assert.ok(r.aplicativoId);
    const registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:r.entidade,chave:"CRASH",revisao:2}});
    const op=await db.olistSyncOperacao.create({data:{configuracaoId:config.id,registroId:registro.id,execucaoId:e.id,sourceAppId:r.aplicativoId===filhoA?filhoB:filhoA,destinoAppId:r.aplicativoId,acao:"CRIAR",revisao:2,status:"EM_APLICACAO"}});
    await db.olistSyncEtapa.update({where:{id:r.id},data:{leaseAte:new Date(0),tentativas:5}});
    await repo.reservarEtapa();
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:op.id}})).status,"RESULTADO_INCONCLUSIVO");
    assert.equal((await db.olistSyncEtapa.findUniqueOrThrow({where:{id:r.id}})).status,"FALHOU");
    assert.equal(await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{}}),null);
    await cancelar(e.id);
    await db.olistSyncExecucao.update({where:{id:e.id},data:{finalizadaEm:new Date(Date.now()-400*86_400_000)}});
    await repo.limparHistorico(config.id);
    assert.ok(await db.olistSyncExecucao.findUnique({where:{id:e.id}}));
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:op.id}})).status,"RESULTADO_INCONCLUSIVO");
  });
  await t.test("duplicidades mantêm observações distintas e FKs impedem vínculos entre grupos",async()=>{
    const registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:"PRODUTO",chave:"00123"}});
    await db.olistSyncEstado.create({data:{configuracaoId:config.id,registroId:registro.id,aplicativoId:filhoA,entidade:"PRODUTO",remoteId:"1",chave:"00123"}});
    await db.olistSyncEstado.create({data:{configuracaoId:config.id,aplicativoId:filhoA,entidade:"PRODUTO",remoteId:"2",chave:"00123"}});
    assert.equal(await db.olistSyncEstado.count({where:{configuracaoId:config.id,chave:"00123"}}),2);
    const outro=await db.olistSyncConfiguracao.create({data:{aplicativoPaiId:isolado}});
    await assert.rejects(db.olistSyncEstado.create({data:{configuracaoId:outro.id,registroId:registro.id,aplicativoId:filhoB,entidade:"PRODUTO",remoteId:"cross"}}));
    const exec=await db.olistSyncExecucao.create({data:{configuracaoId:outro.id,chaveIdempotencia:randomUUID(),modo:"AUDITAR",versaoConfiguracao:1,status:"CONCLUIDA",finalizadaEm:new Date()}});
    await assert.rejects(db.olistSyncEvento.create({data:{configuracaoId:config.id,execucaoId:exec.id,tipo:"ERRO"}}));
  });
  await t.test("retém origem e pendências inconclusivas após limpar execuções antigas",async()=>{
    const antiga=new Date(Date.now()-400*86_400_000);
    const exec=await db.olistSyncExecucao.create({data:{configuracaoId:config.id,chaveIdempotencia:randomUUID(),modo:"AUDITAR",versaoConfiguracao:1,status:"CONCLUIDA",finalizadaEm:antiga,createdAt:antiga}});
    const registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:"PRODUTO",chave:"ORIGEM",aplicativoOrigemId:filhoA,registroOlistOrigemId:"10",origemTipo:"OBSERVADA_PELO_MODULO",origemRegistradaEm:antiga,origemExecucaoId:exec.id}});
    await db.olistSyncEstado.create({data:{configuracaoId:config.id,registroId:registro.id,aplicativoId:filhoA,entidade:"PRODUTO",remoteId:"10",chave:"ORIGEM",ultimaExecucaoId:exec.id}});
    const pendencia=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,registroId:registro.id,execucaoId:exec.id,entidade:"PRODUTO",tipo:"DIVERGENCIA",severidade:"ALTA",chaveDedupe:"ORIGEM",createdAt:antiga}});
    const resultado=await repo.limparHistorico(config.id);assert.equal(resultado.executada,true);
    assert.equal(await db.olistSyncExecucao.findUnique({where:{id:exec.id}}),null);
    const preservado=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});assert.equal(preservado.aplicativoOrigemId,filhoA);assert.equal(preservado.origemExecucaoId,null);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendencia.id}})).status,"AGUARDANDO_REVISAO");
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({where:{registroId:registro.id}})).ultimaExecucaoId,null);
  });

  await t.test("regressões isoladas de recuperação, concorrência e retenção", async suite => {
    const configuracaoId = config.id, jobsPai = config.aplicativoPai.jobs, bloqueiosOriginais = config.aplicativosBloqueados;
    const liberar = { leaseToken: null, leaseAte: null };
    async function reset() {
      // Cada cenário começa e termina limpo, inclusive quando uma regressão falha.
      await sql.query("TRUNCATE olist_sync_registro,olist_sync_execucao CASCADE");
      await db.olistSyncConfiguracao.updateMany({ data: { ativo: false } });
      await db.olistSyncConfiguracao.update({ where: { id: configuracaoId }, data: { ativo: true, entidades: ["PRODUTO"], versao: 1, autorizadoPor: user, ultimaLimpezaEm: null, aplicativosBloqueados: bloqueiosOriginais } });
      await db.olistSyncParticipante.updateMany({ where: { configuracaoId }, data: { habilitado: false, proximaChamadaEm: null } });
      await db.olistSyncParticipante.updateMany({ where: { configuracaoId, aplicativoId: { in: [filhoA, filhoB] } }, data: { habilitado: true } });
      await db.configuracaoJob.updateMany({ data: { pausado: false } });
      await sql.query("UPDATE aplicativo SET jobs=$1 WHERE id=$2", [jobsPai, pai]);
      await sql.query("UPDATE usuario SET ativo=true,pode_executar_sincronizacao_olist=true,pode_configurar_sincronizacao_olist=true WHERE id=$1", [user]);
    }
    suite.beforeEach(reset);
    suite.afterEach(reset);
    const etapa = (id: string) => db.olistSyncEtapa.findUniqueOrThrow({ where: { id } });
    const execucao = (id: string) => db.olistSyncExecucao.findUniqueOrThrow({ where: { id } });
    async function operacaoEmVoo(r: ReservaEtapaSync) {
      assert.ok(r.aplicativoId);
      const registro = await db.olistSyncRegistro.create({ data: { configuracaoId, entidade: r.entidade, chave: randomUUID(), revisao: 2 } });
      return db.olistSyncOperacao.create({ data: { configuracaoId, registroId: registro.id, execucaoId: r.execucaoId, sourceAppId: r.aplicativoId === filhoA ? filhoB : filhoA, destinoAppId: r.aplicativoId, acao: "CRIAR", revisao: 2, status: "EM_APLICACAO" } });
    }

    async function criarGrupoArbitrario() {
      const paiId = randomUUID(), responsavel = randomUUID();
      const filhos:string[] = [randomUUID(), randomUUID(), randomUUID()];
      await sql.query("INSERT INTO aplicativo(id,nome,jobs) VALUES ($1,'Pai de teste',$2)", [paiId, jobsPai]);
      await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$4),($2,'B',$4),($3,'Bloqueado',$4)", [...filhos, paiId]);
      await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist) VALUES ($1,$2,true)", [responsavel, paiId]);
      const grupo = await db.olistSyncConfiguracao.create({ data: { aplicativoPaiId: paiId, ativo: true, entidades: ["PRODUTO"], aplicativosBloqueados: [filhos[2]] } });
      await db.olistSyncParticipante.createMany({ data: filhos.map((aplicativoId, indice) => ({ configuracaoId: grupo.id, aplicativoId, habilitado: indice < 2 })) });
      const enfileirar = () => repo.enfileirar({ configuracaoId: grupo.id, modo: "AUDITAR", idempotencia: randomUUID(), solicitadoPor: responsavel, origem: "MANUAL", completa: true });
      return { grupo, filhos, enfileirar };
    }

    await suite.test("bloqueio persistido protege qualquer grupo e permite apenas referência histórica", async () => {
      const { grupo, filhos, enfileirar } = await criarGrupoArbitrario();
      await assert.rejects(db.olistSyncParticipante.update({ where: { configuracaoId_aplicativoId: { configuracaoId: grupo.id, aplicativoId: filhos[2] } }, data: { habilitado: true } }));
      await db.olistSyncParticipante.delete({ where: { configuracaoId_aplicativoId: { configuracaoId: grupo.id, aplicativoId: filhos[2] } } });
      await assert.rejects(db.olistSyncParticipante.create({ data: { configuracaoId: grupo.id, aplicativoId: filhos[2], habilitado: true } }));
      const registro = await db.olistSyncRegistro.create({ data: { configuracaoId: grupo.id, entidade: "PRODUTO", chave: "ORIGEM-BLOQUEADA", aplicativoOrigemId: filhos[2], origemTipo: "DECLARADA_POR_USUARIO", origemRegistradaEm: new Date() } });
      assert.equal(registro.aplicativoOrigemId, filhos[2]);
      const execucao = await enfileirar();
      const etapas = await db.olistSyncEtapa.findMany({ where: { execucaoId: execucao.id }, select: { aplicativoId: true } });
      assert.deepEqual(etapas.map(e => e.aplicativoId).sort(), filhos.slice(0, 2).sort(), "Origem histórica não deve criar acesso à conta bloqueada.");
    });

    await suite.test("bloqueio posterior ao aceite fecha reserva e janela sem consumir tentativas", async () => {
      const { grupo, filhos, enfileirar } = await criarGrupoArbitrario();
      const execucao = await enfileirar();
      await db.olistSyncConfiguracao.update({ where: { id: grupo.id }, data: { aplicativosBloqueados: [filhos[0], filhos[2]] } });
      const disponibilidade = await repo.disponibilidade(grupo.id, "auditar");
      assert.equal(disponibilidade.habilitado, false);
      await assert.rejects(enfileirar(), /filhos diretos/);
      assert.equal(await repo.reservarEtapa(), null);
      assert.equal(await repo.proximaJanelaEtapa({}), null);
      const final = await db.olistSyncExecucao.findUniqueOrThrow({ where: { id: execucao.id } });
      assert.equal(final.status, "CONCLUIDA_COM_PENDENCIAS");
      assert.equal(final.erroCodigo, "CONFIGURACAO_ALTERADA");
      const etapas = await db.olistSyncEtapa.findMany({ where: { execucaoId: execucao.id }, select: { status: true, tentativas: true } });
      assert.equal(etapas.length, 2);
      assert.ok(etapas.every(etapa => etapa.status === "PAUSADA" && etapa.tentativas === 0));
    });

    await suite.test("bloqueio preserva lease vigente e encerra o grupo quando a reserva expira", async () => {
      const { grupo, filhos, enfileirar } = await criarGrupoArbitrario();
      const e = await enfileirar(), reserva = await repo.reservarEtapa(); assert.ok(reserva); assert.ok(reserva.aplicativoId);
      await db.olistSyncConfiguracao.update({ where: { id: grupo.id }, data: { aplicativosBloqueados: [reserva.aplicativoId, filhos[2]] } });
      assert.equal(await repo.reservarEtapa(), null);
      assert.ok(ESTADOS_EXECUCAO_SYNC_ATIVOS.includes((await execucao(e.id)).status), "A recuperação precisa aguardar a fronteira segura do consumidor atual.");
      const vigente = await etapa(reserva.id);
      assert.equal(vigente.status, "PROCESSANDO");assert.equal(vigente.leaseToken, reserva.leaseToken);
      await db.olistSyncEtapa.update({ where: { id: reserva.id }, data: { leaseAte: new Date(0) } });
      assert.equal(await repo.reservarEtapa(), null);
      const final = await execucao(e.id);
      assert.equal(final.status, "CONCLUIDA_COM_PENDENCIAS");assert.equal(final.erroCodigo, "CONFIGURACAO_ALTERADA");
      const pausada = await etapa(reserva.id);
      assert.equal(pausada.status, "PAUSADA");assert.equal(pausada.leaseToken, null);assert.equal(pausada.tentativas, 1);
      await db.olistSyncConfiguracao.update({ where: { id: grupo.id }, data: { aplicativosBloqueados: [filhos[2]] } });
      assert.notEqual((await enfileirar()).id, e.id, "A execução encerrada não pode impedir a nova auditoria após regularizar o grupo.");
    });

    await suite.test("bloqueio de um grupo não impede o consumo de outro grupo elegível", async () => {
      const bloqueado = await criarGrupoArbitrario(), permitido = await criarGrupoArbitrario();
      await bloqueado.enfileirar();
      const execucaoPermitida = await permitido.enfileirar();
      await db.olistSyncConfiguracao.update({ where: { id: bloqueado.grupo.id }, data: { aplicativosBloqueados: [bloqueado.filhos[0], permitido.filhos[0]] } });
      assert.equal((await repo.disponibilidade(permitido.grupo.id, "auditar")).habilitado, true, "A lista de bloqueios pertence à configuração em que foi gravada.");
      const reserva = await repo.reservarEtapa(); assert.ok(reserva);
      assert.equal(reserva.execucaoId, execucaoPermitida.id);
      assert.ok(permitido.filhos.includes(reserva.aplicativoId!));
    });

    await suite.test("quinta expiração finaliza a última etapa e libera nova execução", async () => {
      const e = await nova(), r = await reservar();
      await db.olistSyncEtapa.updateMany({ where: { execucaoId: e.id, id: { not: r.id } }, data: { status: "CONCLUIDA", ...liberar } });
      await db.olistSyncEtapa.update({ where: { id: r.id }, data: { tentativas: 5, leaseAte: new Date(0) } });
      assert.equal(await repo.reservarEtapa(), null);
      assert.equal((await etapa(r.id)).status, "FALHOU");
      assert.equal(ESTADOS_EXECUCAO_SYNC_ATIVOS.includes((await execucao(e.id)).status), false, "Não pode deixar execução ativa sem etapa consumível");
      assert.notEqual((await nova()).id, e.id);
    });

    await suite.test("pausa com lease vencido põe escrita em quarentena e libera auditoria", async () => {
      const e = await nova("APLICAR"), r = await reservar(), op = await operacaoEmVoo(r);
      await db.olistSyncEtapa.update({ where: { id: r.id }, data: { leaseAte: new Date(0) } });
      await db.configuracaoJob.update({ where: { chave: JOBS_SYNC.aplicar.chave }, data: { pausado: true } });
      assert.equal(await repo.reservarEtapa(), null);
      assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: op.id } })).status, "RESULTADO_INCONCLUSIVO");
      assert.equal(ESTADOS_EXECUCAO_SYNC_ATIVOS.includes((await execucao(e.id)).status), false);
      assert.equal(await repo.salvarCheckpoint({ etapaId: r.id, leaseToken: r.leaseToken, cursor: {} }), null);
      assert.equal((await nova()).modo, "AUDITAR");
    });

    await suite.test("retomar auditoria e aplicação incompleta preserva a coleta necessária", async () => {
      const e = await nova("AUDITAR_E_APLICAR"), r = await reservar();
      await repo.falharEtapa(r, "OLIST_422", null);
      await db.olistSyncEtapa.updateMany({ where: { execucaoId: e.id, id: { not: r.id } }, data: { status: "CONCLUIDA", ...liberar } });
      await repo.concluirExecucaoQuandoPossivel(e.id);
      const retomada = await repo.retomarExecucao(e.id, pai, user, randomUUID());
      assert.equal(retomada.modo, "AUDITAR_E_APLICAR", "Falha na coleta não pode ser retomada só como aplicação");
      const etapas = await db.olistSyncEtapa.findMany({ where: { execucaoId: retomada.id }, select: { fase: true } });
      assert.equal(etapas.length, 2);
      assert.ok(etapas.every(s => s.fase === "LISTAR"));
    });

    await suite.test("cancelar depois de lease vencer preserva a incerteza da escrita", async () => {
      const e = await nova("APLICAR"), r = await reservar(), op = await operacaoEmVoo(r);
      await db.olistSyncEtapa.update({ where: { id: r.id }, data: { leaseAte: new Date(0) } });
      await repo.cancelarExecucao(e.id, pai);
      await repo.reservarEtapa();
      assert.equal((await execucao(e.id)).status, "CANCELADA");
      assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: op.id } })).status, "RESULTADO_INCONCLUSIVO");
      assert.notEqual((await etapa(r.id)).status, "PROCESSANDO");
    });

    await suite.test("valida limites da lease sem consumir tentativas", async () => {
      const e = await nova();
      for (const leaseMs of [29_999, 180_001, 30_000.5, Number.NaN])
        await assert.rejects(repo.reservarEtapa({ leaseMs }), /reserva inválida/);
      assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: e.id, tentativas: { gt: 0 } } }), 0);
      const agora = new Date();
      const curta = await repo.reservarEtapa({ agora, leaseMs: 30_000 }); assert.ok(curta);
      assert.equal(curta.leaseAte?.getTime(), agora.getTime() + 30_000);
      const longa = await repo.reservarEtapa({ agora, leaseMs: 180_000 }); assert.ok(longa);
      assert.equal(longa.leaseAte?.getTime(), agora.getTime() + 180_000);
      assert.notEqual(curta.aplicativoId, longa.aplicativoId);
    });

    await suite.test("falha em comReserva faz rollback de estado e checkpoint juntos", async () => {
      const e = await nova(), r = await reservar();
      await assert.rejects(repo.comReserva(r, async tx => {
        await tx.olistSyncEtapa.update({ where: { id: r.id }, data: { cursorJson: { offset: 999 } } });
        await tx.olistSyncEvento.create({ data: { configuracaoId: config.id, execucaoId: e.id, tipo: "ROLLBACK_TESTE" } });
        throw new Error("Falha depois das duas escritas");
      }), /Falha depois/);
      assert.deepEqual((await etapa(r.id)).cursorJson, {});
      assert.equal((await etapa(r.id)).leaseToken, r.leaseToken);
      assert.equal(await db.olistSyncEvento.count({ where: { execucaoId: e.id } }), 0);
    });

    await suite.test("enfileiramento em transação externa desfaz execução e etapas no rollback", async () => {
      const chave = randomUUID();
      await assert.rejects(db.$transaction(async tx => {
        await repo.enfileirar({ configuracaoId: config.id, modo: "AUDITAR", idempotencia: chave, solicitadoPor: user, origem: "MANUAL", completa: true }, tx);
        throw new Error("Rejeição da decisão atômica");
      }), /decisão atômica/);
      assert.equal(await db.olistSyncExecucao.count({ where: { configuracaoId: config.id } }), 0);
      assert.equal(await db.olistSyncEtapa.count(), 0);
      assert.equal((await nova("AUDITAR", chave)).chaveIdempotencia, chave);
    });

    await suite.test("idempotência continua após conclusão e recusa mudança de contrato", async () => {
      const chave = randomUUID(), e = await nova("AUDITAR", chave);
      await cancelar(e.id);
      assert.equal((await nova("AUDITAR", chave)).id, e.id);
      await assert.rejects(repo.enfileirar({ configuracaoId: config.id, modo: "AUDITAR", idempotencia: chave, solicitadoPor: user, origem: "MANUAL", completa: false }), /idempotência/);
      assert.equal(await db.olistSyncExecucao.count({ where: { configuracaoId: config.id } }), 1);
      assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: e.id } }), 2);
    });

    await suite.test("retries respeitam prazo e encerram na quinta falha consecutiva", async () => {
      const e = await nova(), r = await reservar();
      await db.olistSyncEtapa.updateMany({ where: { execucaoId: e.id, id: { not: r.id } }, data: { status: "CONCLUIDA", ...liberar } });
      let atual = r;
      for (let tentativa = 1; tentativa <= 5; tentativa++) {
        assert.equal(atual.tentativas, tentativa);
        await repo.falharEtapa(atual, "REDE", 60_000);
        assert.equal(await repo.reservarEtapa(), null, "Retry não pode antecipar o prazo");
        if (tentativa < 5) {
          assert.equal((await etapa(r.id)).status, "AGUARDANDO_RETRY");
          await db.olistSyncEtapa.update({ where: { id: r.id }, data: { disponivelEm: new Date(0) } });
          atual = await reservar();
        }
      }
      assert.equal((await etapa(r.id)).status, "FALHOU");
      assert.equal((await repo.concluirExecucaoQuandoPossivel(e.id))?.status, "CONCLUIDA_COM_PENDENCIAS");
    });

    await suite.test("limita duas contas e uma etapa por conta mesmo com três participantes", async () => {
      const terceiro = randomUUID();
      await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'Terceiro',$2)", [terceiro, pai]);
      await db.olistSyncParticipante.create({ data: { configuracaoId: config.id, aplicativoId: terceiro, habilitado: true } });
      await db.olistSyncConfiguracao.update({ where: { id: config.id }, data: { entidades: ["PRODUTO", "CONTATO"] } });
      const e = await nova();
      const reservas = await Promise.all(Array.from({ length: 6 }, () => repo.reservarEtapa()));
      const obtidas = reservas.filter((r): r is ReservaEtapaSync => r !== null);
      while (obtidas.length < 2) {
        const r = await repo.reservarEtapa(); assert.ok(r); obtidas.push(r);
      }
      assert.equal(obtidas.length, 2);
      assert.equal(new Set(obtidas.map(r => r.aplicativoId)).size, 2);
      assert.equal(await repo.reservarEtapa(), null);
      assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: e.id, status: "PROCESSANDO" } }), 2);
      await repo.salvarCheckpoint({ etapaId: obtidas[0].id, leaseToken: obtidas[0].leaseToken, cursor: {}, status: "CONCLUIDA" });
      const proxima = await reservar();
      assert.notEqual(proxima.aplicativoId, obtidas[1].aplicativoId);
    });

    await suite.test("janela de uma conta não impede reservar outra conta disponível", async () => {
      await nova();
      await db.olistSyncParticipante.update({ where: { configuracaoId_aplicativoId: { configuracaoId: config.id, aplicativoId: filhoA } }, data: { proximaChamadaEm: new Date(Date.now() + 60_000) } });
      const r = await reservar();
      assert.equal(r.aplicativoId, filhoB);
      await repo.salvarCheckpoint({ etapaId: r.id, leaseToken: r.leaseToken, cursor: {}, status: "CONCLUIDA" });
      assert.equal(await repo.reservarEtapa(), null);
      assert.equal(await repo.proximaJanelaEtapa({ limiteMs: 12_000 }), null);
    });

    await suite.test("grupo em espera não bloqueia outro grupo com trabalho disponível", async () => {
      await db.olistSyncConfiguracao.update({ where: { id: config.id }, data: { ativo: false } });
      async function grupo(id: string) {
        const paiId = randomUUID(), u = randomUUID(), filhos = [randomUUID(), randomUUID()];
        await sql.query("INSERT INTO aplicativo(id,nome,jobs) VALUES ($1,'Outro pai',$2)", [paiId, jobsPai]);
        await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$3),($2,'B',$3)", [filhos[0], filhos[1], paiId]);
        await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist) VALUES ($1,$2,true)", [u, paiId]);
        await db.olistSyncConfiguracao.create({ data: { id, aplicativoPaiId: paiId, ativo: true, entidades: ["PRODUTO"] } });
        await db.olistSyncParticipante.createMany({ data: filhos.map(aplicativoId => ({ configuracaoId: id, aplicativoId, habilitado: true })) });
        return repo.enfileirar({ configuracaoId: id, modo: "AUDITAR", idempotencia: randomUUID(), solicitadoPor: u, origem: "MANUAL", completa: true });
      }
      const esperando = await grupo("00000000-0000-0000-0000-000000000100");
      const disponivel = await grupo("ffffffff-ffff-ffff-ffff-ffffffffffff");
      await db.olistSyncParticipante.updateMany({ where: { configuracaoId: esperando.configuracaoId }, data: { proximaChamadaEm: new Date(Date.now() + 60_000) } });
      const r = await repo.reservarEtapa();
      assert.ok(r, "A escolha inicial de um grupo em espera não pode interromper a busca global");
      assert.equal(r.execucaoId, disponivel.id);
    });

    await suite.test("COMPARAR e APLICAR aguardam suas fases predecessoras", async () => {
      const e = await nova("AUDITAR_E_APLICAR");
      const comparar = await db.olistSyncEtapa.create({ data: { execucaoId: e.id, entidade: "PRODUTO", fase: "COMPARAR", disponivelEm: new Date(0) } });
      const aplicar = await db.olistSyncEtapa.create({ data: { execucaoId: e.id, entidade: "PRODUTO", aplicativoId: filhoA, fase: "APLICAR", disponivelEm: new Date(0) } });
      const a = await reservar(), b = await reservar();
      assert.equal(a.fase, "LISTAR"); assert.equal(b.fase, "LISTAR");
      await repo.salvarCheckpoint({ etapaId: a.id, leaseToken: a.leaseToken, cursor: {}, status: "CONCLUIDA" });
      assert.equal(await repo.reservarEtapa(), null);
      await repo.salvarCheckpoint({ etapaId: b.id, leaseToken: b.leaseToken, cursor: {}, status: "CONCLUIDA" });
      const c = await reservar(); assert.equal(c.id, comparar.id);
      assert.equal(await repo.reservarEtapa(), null);
      await repo.salvarCheckpoint({ etapaId: c.id, leaseToken: c.leaseToken, cursor: {}, status: "CONCLUIDA" });
      assert.equal((await reservar()).id, aplicar.id);
    });

    await suite.test("cancelamento de outro pai é recusado sem modificar a execução", async () => {
      const e = await nova();
      await assert.rejects(repo.cancelarExecucao(e.id, isolado), /não encontrada/);
      assert.equal((await execucao(e.id)).cancelamentoSolicitado, false);
      assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: e.id, status: "PENDENTE" } }), 2);
    });

    await suite.test("revogação do responsável agendado encerra trabalho pendente", async () => {
      const e = await repo.enfileirar({ configuracaoId: config.id, modo: "AUDITAR", idempotencia: randomUUID(), solicitadoPor: user, origem: "AGENDADA", completa: true });
      await sql.query("UPDATE usuario SET pode_configurar_sincronizacao_olist=false WHERE id=$1", [user]);
      assert.equal(await repo.reservarEtapa(), null);
      assert.equal((await execucao(e.id)).erroCodigo, "AUTORIZACAO_REVOGADA");
      assert.equal(ESTADOS_EXECUCAO_SYNC_ATIVOS.includes((await execucao(e.id)).status), false);
      assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: e.id, tentativas: { gt: 0 } } }), 0);
    });

    await suite.test("retenção exige os gates global e do pai antes de apagar eventos", async () => {
      const antigo = new Date(Date.now() - 400 * 86_400_000);
      const evento = await db.olistSyncEvento.create({ data: { configuracaoId: config.id, tipo: "TECNICO", createdAt: antigo } });
      await db.configuracaoJob.update({ where: { chave: JOBS_SYNC.limpar.chave }, data: { pausado: true } });
      assert.equal((await repo.limparHistorico(config.id)).executada, false);
      assert.ok(await db.olistSyncEvento.findUnique({ where: { id: evento.id } }));
      await db.configuracaoJob.update({ where: { chave: JOBS_SYNC.limpar.chave }, data: { pausado: false } });
      await sql.query("UPDATE aplicativo SET jobs='' WHERE id=$1", [pai]);
      assert.equal((await repo.limparHistorico(config.id)).executada, false);
      assert.ok(await db.olistSyncEvento.findUnique({ where: { id: evento.id } }));
      await sql.query("UPDATE aplicativo SET jobs=$1 WHERE id=$2", [config.aplicativoPai.jobs, pai]);
      assert.equal((await repo.limparHistorico(config.id)).executada, true);
      assert.equal(await db.olistSyncEvento.findUnique({ where: { id: evento.id } }), null);
    });

    await suite.test("retenção reduz payloads terminais e preserva payload, origem e estado incertos", async () => {
      const agora = new Date(), antiga = new Date(agora.getTime() - 400 * 86_400_000), recente = new Date(agora.getTime() - 40 * 86_400_000);
      const e = await db.olistSyncExecucao.create({ data: { configuracaoId: config.id, chaveIdempotencia: randomUUID(), modo: "APLICAR", versaoConfiguracao: 1, status: "CONCLUIDA_COM_PENDENCIAS", finalizadaEm: antiga } });
      const registro = await db.olistSyncRegistro.create({ data: { configuracaoId: config.id, entidade: "PRODUTO", chave: "RETENCAO-INCERTA", aplicativoOrigemId: filhoA, registroOlistOrigemId: "123", origemTipo: "OBSERVADA_PELO_MODULO", origemRegistradaEm: antiga, origemExecucaoId: e.id } });
      const estado = await db.olistSyncEstado.create({ data: { configuracaoId: config.id, registroId: registro.id, aplicativoId: filhoA, entidade: "PRODUTO", remoteId: "123", dadosCriptografados: "estado-cifrado", ultimaExecucaoId: e.id } });
      const incerta = await db.olistSyncOperacao.create({ data: { configuracaoId: config.id, registroId: registro.id, execucaoId: e.id, sourceAppId: filhoA, destinoAppId: filhoB, acao: "CRIAR", revisao: 1, status: "RESULTADO_INCONCLUSIVO", payloadCriptografado: "payload-incerto", resultadoCriptografado: "resposta-incerta", updatedAt: antiga } });
      const terminal = await db.olistSyncOperacao.create({ data: { configuracaoId: config.id, registroId: registro.id, execucaoId: e.id, sourceAppId: filhoA, destinoAppId: filhoB, acao: "ATUALIZAR", revisao: 2, status: "CONFIRMADA", payloadCriptografado: "payload-terminal", resultadoCriptografado: "resposta-terminal", updatedAt: recente } });
      await repo.limparHistorico(config.id, agora);
      const preservada = await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: incerta.id } });
      assert.equal(preservada.payloadCriptografado, "payload-incerto");
      assert.equal(preservada.resultadoCriptografado, "resposta-incerta");
      const reduzida = await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: terminal.id } });
      assert.equal(reduzida.payloadCriptografado, null); assert.equal(reduzida.resultadoCriptografado, null);
      assert.equal((await db.olistSyncRegistro.findUniqueOrThrow({ where: { id: registro.id } })).aplicativoOrigemId, filhoA);
      assert.equal((await db.olistSyncEstado.findUniqueOrThrow({ where: { id: estado.id } })).dadosCriptografados, "estado-cifrado");
      assert.ok(await db.olistSyncExecucao.findUnique({ where: { id: e.id } }));
    });
  });
});
