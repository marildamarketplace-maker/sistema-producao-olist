import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { criarOlistSyncRepository, JOBS_SYNC } from "../src/repositories/olist-sync-repository";
import { criarServicoOlistSync } from "../src/services/olist-sync-service";
import { resolverPendenciaSync } from "../src/services/olist-sync-review-service";
import { criarClienteSync, type RequisicaoSync, type RespostaHttpSync } from "../src/lib/olist-sync/cliente";
import { criarCriptografiaSync } from "../src/lib/olist-sync/cripto";
import { gerarHashesCampos, observarRegistro } from "../src/lib/olist-sync/dominio";
import type { CamposSync } from "../src/lib/olist-sync/contrato";

const url = process.env.OLIST_SYNC_SERVICE_TEST_DATABASE_URL;
test("Olist sync: consumidor completo com PostgreSQL real e provedor simulado", { skip: !url, timeout: 180_000 }, async t => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname));
  assert.match(endereco.pathname, /^\/olist_sync_test_service$/);
  const sql = new Client({ connectionString: url! }); await sql.connect(); t.after(() => sql.end());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) }); t.after(() => db.$disconnect());
  assert.equal((await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'")).rows[0].total, 0);
  await sql.query(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL,jobs text NOT NULL DEFAULT '',aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),ativo boolean NOT NULL DEFAULT true);
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY,pausado boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),termos_ignorados_nome_arquivo text[] DEFAULT '{}',variantes_permitidas text[] DEFAULT '{}');
    CREATE TABLE integracao_olist_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;`);
  const pai = "00000000-0000-0000-0000-000000000002", a = "00000000-0000-0000-0000-000000000004", b = "00000000-0000-0000-0000-000000000005", terceiro = "00000000-0000-0000-0000-000000000006", usuario = randomUUID();
  await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Pai')", [pai]);
  await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$4),($2,'B',$4),($3,'C',$4)", [a,b,terceiro,pai]);
  await sql.query(await readFile(new URL("../prisma/migrations/20261116000100_olist_sync_multiempresa/migration.sql", import.meta.url), "utf8"));
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist,pode_configurar_sincronizacao_olist) VALUES ($1,$2,true,true)", [usuario,pai]);
  const repo = criarOlistSyncRepository(db), config = await repo.obterConfiguracao(pai); assert.ok(config);
  await db.olistSyncParticipante.create({ data: { configuracaoId:config.id, aplicativoId:terceiro, habilitado:false } });
  const cripto = criarCriptografiaSync({ OLIST_SYNC_DATA_KEY:Buffer.alloc(32,1).toString("base64"), OLIST_SYNC_HMAC_KEY:Buffer.alloc(32,2).toString("base64") });
  let agora = Date.now();
  const contas = new Map<string, Map<string, CamposSync>>();
  const chamadas:RequisicaoSync[] = [];
  const credenciaisSolicitadas:string[] = [];
  let proximoId = 1000;
  let postIncerto = false;
  let post429 = false;
  let rejeitarDestino:string|null = null;
  let interceptar:((r:RequisicaoSync,app:string)=>Promise<void>)|null = null;
  let responder:((r:RequisicaoSync,app:string)=>Promise<RespostaHttpSync|undefined>)|null = null;
  const docs = new Map([[a,"04252011000110"],[b,"11222333000181"],[terceiro,"12ABC34501DE35"]]);
  const cliente = criarClienteSync({
    async configurar() { return { apiBaseUrl:"https://api.tiny.com.br/public-api/v3" }; },
    async token(app) { credenciaisSolicitadas.push(app); return app; },
    async http(r) {
      chamadas.push(r); const app = r.token, conta = contas.get(app)!; const caminho = new URL(r.url);
      if (interceptar) await interceptar(r,app);
      if(responder) {const resposta=await responder(r,app);if(resposta)return resposta;}
      if (caminho.pathname.endsWith("/info")) return { status:200, dados:{cpfCnpj:docs.get(app),razaoSocial:`Conta ${app}`} };
      if (["/produtos","/formas-pagamento","/contatos"].some(recurso=>caminho.pathname.endsWith(recurso)) && r.metodo==="GET") {
        const codigo=caminho.searchParams.get("codigo"), offset=Number(caminho.searchParams.get("offset")??0), limit=Number(caminho.searchParams.get("limit")??100);
        const itens=[...conta.values()].filter(item=>!codigo||item.sku===codigo);
        return { status:200,dados:{itens:itens.slice(offset,offset+limit),paginacao:{total:itens.length,offset,limit}} };
      }
      const id=caminho.pathname.split("/").at(-1)!;
      if(r.metodo==="GET") return conta.has(id)?{status:200,dados:conta.get(id)}:{status:404,dados:{}};
      assert.ok(r.payload && !Array.isArray(r.payload) && typeof r.payload==="object");
      for(const campo of ["estoque","precos","custos","tributacao","ncm"]) assert.equal(campo in r.payload,false,`Campo protegido enviado: ${campo}`);
      if (app===rejeitarDestino) return {status:422,dados:{}};
      if(r.metodo==="POST") {
        if(post429) {post429=false;return {status:429,dados:{},retryAfter:"60"};}
        const criado=String(proximoId++);conta.set(criado,{id:Number(criado),situacao:"A",...r.payload});
        if(postIncerto) {postIncerto=false;throw new Error("Resposta perdida depois do commit remoto");}
        return {status:200,dados:{id:Number(criado)}};
      }
      conta.set(id,{...conta.get(id),...r.payload});return {status:204,dados:null};
    },
  });
  const servico=criarServicoOlistSync(db,cliente,{agora:()=>new Date(agora),cripto,aguardar:async ms=>{agora+=ms;}});
  const produto=(id:number,sku="001-A",descricao="Toalha"):CamposSync=>({id,sku,descricao,tipo:"S",situacao:"A",estoque:{saldo:10},precos:{preco:50},ncm:"1234"});
  async function reset() {
    await sql.query("TRUNCATE olist_sync_registro,olist_sync_execucao CASCADE");
    await db.configuracaoJob.updateMany({data:{pausado:false}});
    await db.olistSyncConfiguracao.update({where:{id:config!.id},data:{ativo:true,autorizadoPor:usuario,entidades:["PRODUTO"],limiteAlteracoes:100,aplicativosBloqueados:config!.aplicativosBloqueados,proximaExecucaoEm:new Date(Date.now()+86_400_000),readinessJson:{sincronizacaoNativaCompativel:true,semanticaPutValidada:true}}});
    await db.olistSyncParticipante.updateMany({where:{configuracaoId:config!.id},data:{contaIdentidade:null,proximaChamadaEm:null}});
    await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config!.id,aplicativoId:terceiro}},data:{habilitado:false}});
    await sql.query("UPDATE usuario SET ativo=true,pode_executar_sincronizacao_olist=true WHERE id=$1",[usuario]);
    contas.clear(); for(const app of [a,b,terceiro])contas.set(app,new Map()); chamadas.length=0;credenciaisSolicitadas.length=0;postIncerto=false;post429=false;rejeitarDestino=null;interceptar=null;responder=null;agora=Date.now()+1000;proximoId=1000;
    docs.set(b,"11222333000181");
  }
  async function enfileirar(modo:"AUDITAR"|"AUDITAR_E_APLICAR"|"APLICAR"="AUDITAR_E_APLICAR") {
    return repo.enfileirar({configuracaoId:config!.id,modo,idempotencia:randomUUID(),solicitadoPor:usuario,origem:"MANUAL",completa:true});
  }
  async function passo() {
    agora+=6_001;
    const reserva=await repo.reservarEtapa({agora:new Date(agora)});
    if(reserva)await servico.processar(reserva);
    return reserva;
  }
  async function terminar(id:string,max=160) {
    for(let i=0;i<max;i++) {
      const e=await db.olistSyncExecucao.findUniqueOrThrow({where:{id},select:{status:true}});
      if(["CONCLUIDA","CONCLUIDA_COM_PENDENCIAS","CANCELADA","FALHOU"].includes(e.status))return e;
      await passo();
    }
    assert.fail(`Execução não terminou: ${JSON.stringify(await db.olistSyncEtapa.findMany({where:{execucaoId:id},select:{fase:true,status:true,cursorJson:true,erroCodigo:true}}))}`);
  }
  async function avancarAte(condicao:()=>Promise<boolean>,descricao:string,max=120) {
    for(let i=0;i<max;i++) {if(await condicao())return;await passo();}
    assert.fail(`Condição não atingida após ${max} passos: ${descricao}`);
  }
  async function habilitarTerceiro() {
    await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config!.id,aplicativoId:terceiro}},data:{habilitado:true}});
  }
  async function adiarDestino(execucaoId:string,app:string) {
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId,aplicativoId:app,fase:"APLICAR"}})>0,"etapa de aplicação criada");
    await db.olistSyncEtapa.updateMany({where:{execucaoId,aplicativoId:app,fase:"APLICAR"},data:{disponivelEm:new Date(agora+3_600_000)}});
  }
  async function liberarDestino(execucaoId:string,app:string) {
    await db.olistSyncEtapa.updateMany({where:{execucaoId,aplicativoId:app,fase:"APLICAR"},data:{disponivelEm:new Date(0)}});
  }
  async function aguardarConfirmacao(execucaoId:string,app:string) {
    await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId,destinoAppId:app,status:"CONFIRMADA"}})>0,`confirmação do destino ${app}`);
  }
  async function aguardarEscrita(execucaoId:string,app=b) {
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId,aplicativoId:app,fase:"APLICAR",status:"PENDENTE",cursorJson:{path:["fase"],equals:"ESCREVER"}}})>0,"pré-condições verificadas antes da escrita");
    assert.equal(escritas().length,0);
  }
  async function reservarEscrita(execucaoId:string,app=b) {
    for(let i=0;i<20;i++) {
      agora+=6_001;
      const reserva=await repo.reservarEtapa({agora:new Date(agora)});
      if(!reserva)continue;
      if(reserva.execucaoId===execucaoId&&reserva.aplicativoId===app&&reserva.fase==="APLICAR")return reserva;
      await servico.processar(reserva);
    }
    assert.fail("Não foi possível reservar a etapa anterior à escrita.");
  }
  const escritas=()=>chamadas.filter(r=>r.metodo!=="GET");

  await t.test("aceite durável executa LISTAR→DETALHAR→COMPARAR→APLICAR→verificar sem tocar campos protegidos",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
    assert.equal(escritas().length,0);assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id}}),2);
    assert.equal((await terminar(e.id)).status,"CONCLUIDA");assert.equal(escritas().length,1);
    const op=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(op.status,"CONFIRMADA");assert.equal(op.destinoAppId,b);
    const registro=await db.olistSyncRegistro.findFirstOrThrow();assert.equal(registro.aplicativoOrigemId,a);assert.equal(registro.origemTipo,"OBSERVADA_PELO_MODULO");assert.ok(Object.keys(registro.hashesBaseJson as object).length);
    const execucao=await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}});assert.deepEqual(execucao.contadoresJson,{listados:1,analisados:1,criados:1});
    assert.equal(contas.get(b)!.size,1);assert.ok(chamadas.some(r=>r.metodo==="GET"&&r.url.endsWith(`/produtos/${op.remoteId}`)));
  });
  await t.test("convergência confirma todas as réplicas, inclusive a fonte, sem exigir nova auditoria",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar()).id);
    const aposCriacao=await db.olistSyncEstado.findMany({select:{aplicativoId:true,status:true}});
    assert.equal(aposCriacao.length,2);
    assert.ok(aposCriacao.every(estado=>estado.status==="SINCRONIZADO"),"A fonte também participa da base comum confirmada.");
    const replica=[...contas.get(b)!.values()][0];replica.descricao="Atualização da antiga réplica";
    await terminar((await enfileirar()).id);
    const aposAtualizacao=await db.olistSyncEstado.findMany({select:{aplicativoId:true,status:true}});
    assert.equal(aposAtualizacao.length,2);assert.ok(aposAtualizacao.every(estado=>estado.status==="SINCRONIZADO"));
    assert.equal(contas.get(a)!.get("10")!.descricao,"Atualização da antiga réplica");
    assert.equal(escritas().length,2);
  });
  await t.test("POST com resposta perdida reconcilia por chave sem reenviar nem duplicar",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));postIncerto=true;const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"CONFIRMADA");
    assert.ok(chamadas.filter(r=>new URL(r.url).searchParams.has("codigo")).length>=2);
  });
  await t.test("429 explicitamente rejeitado respeita backoff e refaz precondições antes de nova escrita",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));post429=true;const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,2);assert.equal(contas.get(b)!.size,1);assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"CONFIRMADA");
    assert.ok(chamadas.filter(r=>new URL(r.url).searchParams.has("codigo")).length>=2);
  });
  await t.test("aplicação pausada encerra auditoria com proposta e permite nova auditoria",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await db.configuracaoJob.update({where:{chave:JOBS_SYNC.aplicar.chave},data:{pausado:true}});
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA_COM_PENDENCIAS");assert.equal(escritas().length,0);
    const segunda=await enfileirar("AUDITAR");await terminar(segunda.id);assert.equal(escritas().length,0);
  });
  await t.test("duplicidade de SKU mantém observações e bloqueia criação",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));contas.get(a)!.set("11",produto(11));const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,0);assert.equal(await db.olistSyncEstado.count(),2);assert.ok(await db.olistSyncPendencia.count({where:{status:"AGUARDANDO_REVISAO"}}));
  });
  await t.test("sem base não escolhe vencedor; após base propaga unilateral preservando origem desconhecida",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));contas.get(b)!.set("20",produto(20));await terminar((await enfileirar()).id);
    const registro=await db.olistSyncRegistro.findFirstOrThrow();assert.equal(registro.origemTipo,"DESCONHECIDA");assert.equal(escritas().length,0);
    contas.get(a)!.get("10")!.descricao="Toalha nova";await terminar((await enfileirar()).id);
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.get("20")!.descricao,"Toalha nova");
    assert.equal((await db.olistSyncRegistro.findFirstOrThrow()).origemTipo,"DESCONHECIDA");
    assert.deepEqual(contas.get(b)!.get("20")!.estoque,{saldo:10});assert.deepEqual(contas.get(b)!.get("20")!.precos,{preco:50});
  });
  await t.test("inativação da fonte entre auditoria e aplicação bloqueia mesmo sem mudar hashes",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
    await avancarAte(async()=>await db.olistSyncOperacao.count()>0,"proposta produzida");
    contas.get(a)!.get("10")!.situacao="I";await terminar(e.id);assert.equal(escritas().length,0);
  });
  await t.test("revogação do usuário após reservar impede chamada remota",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();agora+=6_001;
    const r=await repo.reservarEtapa({agora:new Date(agora)});assert.ok(r);
    await sql.query("UPDATE usuario SET pode_executar_sincronizacao_olist=false WHERE id=$1",[usuario]);
    await servico.processar(r);assert.equal(chamadas.length,0);await terminar(e.id);
  });
  await t.test("bloqueio persistido depois do lease impede consulta mesmo sem mudar a versão",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await enfileirar();agora+=6_001;
    const reserva=await repo.reservarEtapa({agora:new Date(agora)});assert.ok(reserva);assert.ok(reserva.aplicativoId);
    const antes=await db.olistSyncConfiguracao.findUniqueOrThrow({where:{id:config.id},select:{versao:true}});
    await db.olistSyncConfiguracao.update({where:{id:config.id},data:{aplicativosBloqueados:[...config.aplicativosBloqueados,reserva.aplicativoId]}});
    await servico.processar(reserva);
    assert.equal(chamadas.length,0,"A reserva antiga não autoriza usar uma conta agora bloqueada.");
    assert.equal(credenciaisSolicitadas.length,0);
    assert.equal((await db.olistSyncConfiguracao.findUniqueOrThrow({where:{id:config.id},select:{versao:true}})).versao,antes.versao);
    assert.equal((await db.olistSyncEtapa.findUniqueOrThrow({where:{id:reserva.id},select:{erroCodigo:true}})).erroCodigo,"ESCOPO_ALTERADO");
  });
  await t.test("origem histórica bloqueada é preservada sem obter credenciais nem executar chamadas nessa conta",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar()).id);
    const registro=await db.olistSyncRegistro.findFirstOrThrow();
    await db.olistSyncConfiguracao.update({where:{id:config.id},data:{aplicativosBloqueados:[...config.aplicativosBloqueados,terceiro]}});
    await db.olistSyncRegistro.update({where:{id:registro.id},data:{aplicativoOrigemId:terceiro,registroOlistOrigemId:"HISTORICO",origemTipo:"DECLARADA_POR_USUARIO",origemRegistradaEm:new Date()}});
    contas.get(a)!.get("10")!.descricao="Atualização permitida";
    await terminar((await enfileirar()).id);
    const atual=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});
    assert.equal(atual.aplicativoOrigemId,terceiro);assert.equal(atual.registroOlistOrigemId,"HISTORICO");assert.equal(atual.origemTipo,"DECLARADA_POR_USUARIO");
    assert.equal([...contas.get(b)!.values()][0].descricao,"Atualização permitida");
    assert.ok(credenciaisSolicitadas.every(app=>[a,b].includes(app)),"O histórico não deve conceder sequer a leitura das credenciais.");
    assert.ok(chamadas.every(chamada=>[a,b].includes(chamada.token)),"Proveniência não concede acesso à conta excluída.");
  });
  await t.test("uma confirmação parcial não avança a base se outro destino da revisão falhou",async()=>{
    await reset();await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:terceiro}},data:{habilitado:true}});
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),produto(id));
    await terminar((await enfileirar()).id);const antes=await db.olistSyncRegistro.findFirstOrThrow();
    contas.get(a)!.get("10")!.descricao="Mudança parcial";rejeitarDestino=b;await terminar((await enfileirar()).id);
    const depois=await db.olistSyncRegistro.findFirstOrThrow();assert.deepEqual(depois.hashesBaseJson,antes.hashesBaseJson);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),1);assert.equal(await db.olistSyncOperacao.count({where:{status:"FALHA_PERMANENTE"}}),1);
  });
  await t.test("lease perdido após POST não grava sucesso falso nem reenvia na recuperação",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));let expirou=false;
    interceptar=async r=>{if(r.metodo==="POST"&&!expirou){expirou=true;await db.olistSyncEtapa.updateMany({where:{fase:"APLICAR",status:"PROCESSANDO"},data:{leaseAte:new Date(0)}});}};
    const e=await enfileirar();await terminar(e.id);assert.equal(expirou,true);assert.equal(escritas().length,1);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"CONFIRMADA");assert.equal(contas.get(b)!.size,1);
  });
  await t.test("lease expirado antes da consulta impede qualquer chamada remota",async()=>{
    await reset();const e=await enfileirar();agora+=6_001;const r=await repo.reservarEtapa({agora:new Date(agora)});assert.ok(r);
    await db.olistSyncEtapa.update({where:{id:r.id},data:{leaseAte:new Date(0)}});await servico.processar(r);assert.equal(chamadas.length,0);await terminar(e.id);
  });
  await t.test("conta reconectada durante a execução bloqueia aplicação em tenant diferente",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await avancarAte(async()=>await db.olistSyncOperacao.count()>0,"proposta produzida");
    docs.set(b,"12ABC34501DE35");await terminar(e.id);assert.equal(escritas().length,0);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).erroCodigo,"CONTA_ALTERADA");
  });
  await t.test("conflito ignorado permanece ignorado enquanto o conteúdo não mudar",async()=>{
    await reset();contas.get(a)!.set("10",produto(10,"001-A","Texto A"));contas.get(b)!.set("20",produto(20,"001-A","Texto B"));await terminar((await enfileirar()).id);
    const pendencia=await db.olistSyncPendencia.findFirstOrThrow();await db.olistSyncPendencia.update({where:{id:pendencia.id},data:{status:"IGNORADA",decididoPor:usuario,decididoEm:new Date()}});
    await terminar((await enfileirar()).id);assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendencia.id}})).status,"IGNORADA");
    contas.get(a)!.get("10")!.descricao="Texto A alterado";await terminar((await enfileirar()).id);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendencia.id}})).status,"AGUARDANDO_REVISAO");assert.equal(escritas().length,0);
  });
  await t.test("vínculo manual de formas persiste em auditorias e permite comparação sem escrita",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["FORMA_PAGAMENTO"]}});
    contas.get(a)!.set("1",{id:1,nome:"Pix",situacao:1});contas.get(b)!.set("2",{id:2,nome:"Pix",situacao:1});await terminar((await enfileirar("AUDITAR")).id);
    const registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:"FORMA_PAGAMENTO",chave:`manual:${randomUUID()}`,nome:"Pix"}});
    await db.olistSyncEstado.updateMany({data:{registroId:registro.id,chave:registro.chave,metadadosJson:{completo:true,vinculoManual:true}}});
    await terminar((await enfileirar("AUDITAR")).id);
    const estados=await db.olistSyncEstado.findMany();assert.equal(estados.length,2);
    assert.ok(estados.every(estado=>estado.registroId===registro.id&&estado.chave===registro.chave&&estado.status==="SINCRONIZADO"));assert.equal(escritas().length,0);
  });
  await t.test("vínculo manual de contatos sobrevive à reauditoria sem liberar escrita sem documento",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    for(const [app,id] of [[a,10],[b,20]] as const)contas.get(app)!.set(String(id),{id,nome:"Contato equivalente",cpfCnpj:"",tipoPessoa:"F",situacao:"B"});
    await terminar((await enfileirar("AUDITAR")).id);
    const pendencia=await db.olistSyncPendencia.findFirstOrThrow({where:{configuracaoId:config.id,entidade:"CONTATO",chaveDedupe:cripto.hash(`sem-chave:${a}:CONTATO:10`,`${config.id}:pendencia`)}});
    const atualConfig=await repo.obterConfiguracao(pai);assert.ok(atualConfig);
    const antigas={data:process.env.OLIST_SYNC_DATA_KEY,hmac:process.env.OLIST_SYNC_HMAC_KEY};
    try {
      process.env.OLIST_SYNC_DATA_KEY=Buffer.alloc(32,1).toString("base64");process.env.OLIST_SYNC_HMAC_KEY=Buffer.alloc(32,2).toString("base64");
      await resolverPendenciaSync(db,atualConfig,usuario,pendencia.id,{versao:pendencia.versao,acao:"VINCULAR",motivo:"Equivalência de contatos conferida nas duas empresas",vinculos:[{aplicativoId:a,registroOlistId:"10"},{aplicativoId:b,registroOlistId:"20"}]});
    } finally {
      if(antigas.data===undefined)delete process.env.OLIST_SYNC_DATA_KEY;else process.env.OLIST_SYNC_DATA_KEY=antigas.data;
      if(antigas.hmac===undefined)delete process.env.OLIST_SYNC_HMAC_KEY;else process.env.OLIST_SYNC_HMAC_KEY=antigas.hmac;
    }
    const registro=await db.olistSyncRegistro.findFirstOrThrow();
    await terminar((await enfileirar()).id);
    const estados=await db.olistSyncEstado.findMany({where:{entidade:"CONTATO"}});
    assert.equal(estados.length,2);assert.ok(estados.every(estado=>estado.registroId===registro.id&&estado.chave===registro.chave&&estado.status==="SINCRONIZADO"));
    assert.equal(await db.olistSyncRegistro.count(),1);assert.equal(escritas().length,0);
    contas.get(a)!.get("10")!.nome="Contato alterado sem documento";
    await terminar((await enfileirar()).id);
    assert.equal(escritas().length,0,"Vínculo manual não libera o contrato de escrita sem CPF/CNPJ válido.");
    assert.equal(contas.get(b)!.get("20")!.nome,"Contato equivalente");
    assert.equal(await db.olistSyncRegistro.count(),1);
  });
  await t.test("falhas transitórias de detalhe esgotam tentativas sem criação parcial",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));interceptar=async r=>{if(r.metodo==="GET"&&r.url.endsWith("/produtos/10"))throw new Error("indisponível");};
    const e=await enfileirar();await terminar(e.id,400);assert.equal(escritas().length,0);
    assert.equal(chamadas.filter(r=>r.url.endsWith("/produtos/10")).length,5);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,status:"FALHOU"}}),1);
  });
  await t.test("duplicidade descoberta numa nova auditoria invalida a proposta anterior antes de escrever",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar("AUDITAR")).id);
    const anterior=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(anterior.status,"AUTORIZADA");
    contas.get(a)!.set("11",produto(11));const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,0,"Uma proposta antiga não pode contornar a duplicidade recém-detectada.");
    assert.equal(contas.get(b)!.size,0);
    assert.notEqual((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:anterior.id}})).status,"AUTORIZADA");
    assert.ok(await db.olistSyncPendencia.count({where:{execucaoId:e.id,status:"AGUARDANDO_REVISAO"}}));
  });
  await t.test("três contas convergem quando um destino só inicia após a confirmação do outro",async()=>{
    await reset();await habilitarTerceiro();
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),produto(id));
    await terminar((await enfileirar()).id);const base=await db.olistSyncRegistro.findFirstOrThrow();
    contas.get(a)!.get("10")!.descricao="Mudança para todas";const e=await enfileirar();
    // Adia apenas a etapa de C: B continua autorizado a consultar a conta C.
    await adiarDestino(e.id,terceiro);await aguardarConfirmacao(e.id,b);await liberarDestino(e.id,terceiro);await terminar(e.id);
    assert.equal(contas.get(b)!.get("20")!.descricao,"Mudança para todas");
    assert.equal(contas.get(terceiro)!.get("30")!.descricao,"Mudança para todas");
    assert.equal(await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"CONFIRMADA"}}),2);
    assert.notDeepEqual((await db.olistSyncRegistro.findFirstOrThrow()).hashesBaseJson,base.hashesBaseJson);
    assert.equal(escritas().length,2);
  });
  await t.test("alteração externa após uma confirmação não é aceita como avanço da mesma proposta",async()=>{
    await reset();await habilitarTerceiro();
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),produto(id));
    await terminar((await enfileirar()).id);const base=await db.olistSyncRegistro.findFirstOrThrow();
    contas.get(a)!.get("10")!.descricao="Alteração autorizada";
    const e=await enfileirar();await adiarDestino(e.id,terceiro);await aguardarConfirmacao(e.id,b);
    assert.equal(contas.get(b)!.get("20")!.descricao,"Alteração autorizada");
    contas.get(b)!.get("20")!.descricao="Edição externa posterior à confirmação";
    await liberarDestino(e.id,terceiro);await terminar(e.id);
    assert.equal(contas.get(terceiro)!.get("30")!.descricao,"Toalha");
    assert.equal(contas.get(b)!.get("20")!.descricao,"Edição externa posterior à confirmação");
    assert.equal(escritas().length,1);
    const bloqueada=await db.olistSyncOperacao.findFirstOrThrow({where:{execucaoId:e.id,destinoAppId:terceiro}});
    assert.notEqual(bloqueada.status,"CONFIRMADA");assert.equal(bloqueada.erroCodigo,"FONTE_ALTERADA");
    assert.deepEqual((await db.olistSyncRegistro.findFirstOrThrow()).hashesBaseJson,base.hashesBaseJson);
  });
  await t.test("merge de campos independentes converge mesmo com aplicações em ordem forçada",async()=>{
    await reset();
    contas.get(a)!.set("10",{...produto(10),descricaoComplementar:"Complemento inicial"});
    contas.get(b)!.set("20",{...produto(20),descricaoComplementar:"Complemento inicial"});
    await terminar((await enfileirar()).id);
    contas.get(a)!.get("10")!.descricao="Descrição nova";
    contas.get(b)!.get("20")!.descricaoComplementar="Complemento novo";
    const e=await enfileirar();await adiarDestino(e.id,b);await aguardarConfirmacao(e.id,a);await liberarDestino(e.id,b);await terminar(e.id);
    for(const [app,id] of [[a,"10"],[b,"20"]] as const) {
      assert.equal(contas.get(app)!.get(id)!.descricao,"Descrição nova");
      assert.equal(contas.get(app)!.get(id)!.descricaoComplementar,"Complemento novo");
      assert.deepEqual(contas.get(app)!.get(id)!.estoque,{saldo:10});
    }
    assert.equal(await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"CONFIRMADA"}}),2);
  });
  await t.test("última fonte identifica quem alterou o campo, sem inferir origem entre três contas preexistentes",async()=>{
    await reset();await habilitarTerceiro();
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),{...produto(id),garantia:"3 meses"});
    await terminar((await enfileirar()).id);contas.get(b)!.get("20")!.garantia="12 meses";
    const e=await enfileirar();await adiarDestino(e.id,a);await aguardarConfirmacao(e.id,terceiro);
    assert.equal(contas.get(terceiro)!.get("30")!.garantia,"12 meses");
    const op=await db.olistSyncOperacao.findFirstOrThrow({where:{execucaoId:e.id,destinoAppId:terceiro}});
    const registro=await db.olistSyncRegistro.findFirstOrThrow();
    assert.equal(op.sourceAppId,b,"Campos inalterados de A não tornam A a fonte da alteração feita por B.");
    assert.equal(registro.ultimaFonteAppId,b);
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({where:{aplicativoId:terceiro}})).ultimaFonteAppId,b);
    assert.equal(registro.origemTipo,"DESCONHECIDA");assert.equal(registro.aplicativoOrigemId,null);
    await repo.cancelarExecucao(e.id,pai);
  });
  await t.test("origem observada permanece estável quando uma réplica se torna a última fonte",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar()).id);
    const inicial=await db.olistSyncRegistro.findFirstOrThrow(), replica=[...contas.get(b)!.values()][0];
    assert.equal(inicial.aplicativoOrigemId,a);assert.equal(inicial.registroOlistOrigemId,"10");
    replica.descricao="Atualização feita na réplica";const e=await enfileirar();await terminar(e.id);
    const final=await db.olistSyncRegistro.findFirstOrThrow();
    assert.equal(contas.get(a)!.get("10")!.descricao,"Atualização feita na réplica");assert.equal(final.ultimaFonteAppId,b);
    assert.equal(final.aplicativoOrigemId,a);assert.equal(final.registroOlistOrigemId,"10");assert.equal(final.origemTipo,"OBSERVADA_PELO_MODULO");
    assert.equal(final.origemExecucaoId,inicial.origemExecucaoId);assert.deepEqual(final.origemRegistradaEm,inicial.origemRegistradaEm);
    assert.equal(escritas().length,2);
  });
  await t.test("página curta com total maior não autoriza cobertura completa nem origem observada prematura",async()=>{
    await reset();for(let id=1;id<=3;id++)contas.get(a)!.set(String(id),produto(id,`SKU-${id}`,`Produto ${id}`));
    responder=async(r,app)=>{
      const u=new URL(r.url);if(app!==a||r.metodo!=="GET"||!u.pathname.endsWith("/produtos"))return undefined;
      const offset=Number(u.searchParams.get("offset")??0);
      return {status:200,dados:{itens:[...contas.get(a)!.values()].slice(offset,offset+1),paginacao:{offset,limit:100,total:3}}};
    };
    const e=await enfileirar("AUDITAR");await terminar(e.id);
    const observados=await db.olistSyncEstado.count({where:{aplicativoId:a,ultimaExecucaoId:e.id}});
    const falhas=await db.olistSyncEtapa.count({where:{execucaoId:e.id,status:"FALHOU"}});
    assert.ok(observados===3||falhas>0,"O consumidor deve buscar as páginas restantes ou rejeitar a cobertura incompleta.");
    if(observados<3) {
      assert.equal(await db.olistSyncOperacao.count({where:{execucaoId:e.id}}),0);
      assert.equal(await db.olistSyncRegistro.count({where:{origemTipo:"OBSERVADA_PELO_MODULO"}}),0);
    }
    assert.equal(escritas().length,0);
  });
  await t.test("página vazia com total positivo não comprova ausência nem autoriza origem ou criação",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));contas.get(b)!.set("20",produto(20));
    responder=async(r,app)=>app===a&&r.metodo==="GET"&&new URL(r.url).pathname.endsWith("/produtos")
      ?{status:200,dados:{itens:[],paginacao:{offset:0,limit:100,total:1}}}:undefined;
    const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,0);assert.equal(contas.get(a)!.size,1);assert.equal(contas.get(b)!.size,1);
    assert.equal(await db.olistSyncOperacao.count({where:{execucaoId:e.id}}),0);
    assert.equal(await db.olistSyncRegistro.count({where:{origemTipo:"OBSERVADA_PELO_MODULO"}}),0);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,aplicativoId:a,status:"FALHOU"}}),1);
  });
  await t.test("paginação de 101 produtos por conta preserva todos os detalhes sem chamadas de escrita",async()=>{
    await reset();for(let id=1;id<=101;id++) {
      contas.get(a)!.set(String(id),produto(id,`SKU-${id}`,`Produto ${id}`));
      contas.get(b)!.set(String(1000+id),produto(1000+id,`SKU-${id}`,`Produto ${id}`));
    }
    const e=await enfileirar("AUDITAR");assert.equal((await terminar(e.id,400)).status,"CONCLUIDA");
    assert.equal(await db.olistSyncEstado.count({where:{ultimaExecucaoId:e.id}}),202);assert.equal(await db.olistSyncRegistro.count(),101);
    for(const app of [a,b]) {
      const paginas=chamadas.filter(r=>r.token===app&&new URL(r.url).pathname.endsWith("/produtos"));
      assert.deepEqual(paginas.map(r=>Number(new URL(r.url).searchParams.get("offset"))),[0,100]);
      assert.ok(paginas.every(r=>new URL(r.url).searchParams.get("limit")==="100"));
    }
    assert.equal(escritas().length,0);assert.equal(chamadas.filter(r=>/\/produtos\/\d+$/.test(r.url)).length,202);
  });
  await t.test("retomar execução cancelada reconcilia a escrita já aceita sem reenviá-la",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
    await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"VERIFICANDO"}})>0,"escrita aguardando verificação");
    const operacao=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(escritas().length,1);
    await repo.cancelarExecucao(e.id,pai);const retomada=await repo.retomarExecucao(e.id,pai,usuario,randomUUID());
    assert.notEqual(retomada.id,e.id);await terminar(retomada.id);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}})).status,"CONFIRMADA");
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
  });
  await t.test("confirmar operação antiga preserva a base de uma revisão posterior",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
    await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"VERIFICANDO"}})>0,"operação antiga aguardando confirmação");
    const operacao=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(escritas().length,1);
    const novaRevisao=operacao.revisao+1;
    const novosCampos=observarRegistro("PRODUTO",produto(10,"001-A","Conteúdo de revisão posterior"),{completo:true}).campos;
    const novaBase=gerarHashesCampos(novosCampos,v=>cripto.hash(v,`${config.id}:campo`));
    // Simula uma revisão posterior já persistida enquanto a confirmação antiga
    // estava interrompida; a leitura remota continua sendo do efeito antigo.
    await db.olistSyncRegistro.update({where:{id:operacao.registroId},data:{revisao:novaRevisao,hashesBaseJson:novaBase}});
    await terminar(e.id);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}})).status,"CONFIRMADA");
    const atual=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:operacao.registroId}});
    assert.equal(atual.revisao,novaRevisao);assert.deepEqual(atual.hashesBaseJson,novaBase);
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
  });
  await t.test("reconciliar efeito antigo após nova duplicidade preserva o conflito e os estados atuais",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const primeira=await enfileirar();
    await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId:primeira.id,status:"VERIFICANDO"}})>0,"efeito antigo persistido sem confirmação");
    const operacao=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(escritas().length,1);
    await repo.cancelarExecucao(primeira.id,pai);
    contas.get(a)!.set("11",produto(11));const auditoria=await enfileirar("AUDITAR");await terminar(auditoria.id);
    const registro=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:operacao.registroId}});
    assert.ok(registro.revisao>operacao.revisao,"Uma nova decisão de conflito deve invalidar a geração anterior.");
    const pendencia=await db.olistSyncPendencia.findFirstOrThrow({where:{registroId:registro.id,status:"AGUARDANDO_REVISAO",tipo:{contains:"DUPLIC"}}});
    const estados=await db.olistSyncEstado.findMany({where:{registroId:registro.id},orderBy:{id:"asc"},select:{id:true,status:true,ultimaExecucaoId:true,hashesJson:true,dadosCriptografados:true}});
    assert.ok(estados.every(estado=>estado.status==="AGUARDANDO_REVISAO"));
    await terminar((await enfileirar("APLICAR")).id);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}})).status,"CONFIRMADA");
    const atual=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});
    assert.equal(atual.revisao,registro.revisao);assert.deepEqual(atual.hashesBaseJson,registro.hashesBaseJson);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendencia.id}})).status,"AGUARDANDO_REVISAO");
    assert.deepEqual(await db.olistSyncEstado.findMany({where:{registroId:registro.id},orderBy:{id:"asc"},select:{id:true,status:true,ultimaExecucaoId:true,hashesJson:true,dadosCriptografados:true}}),estados);
    assert.equal(escritas().length,1);assert.equal(contas.get(a)!.size,2);assert.equal(contas.get(b)!.size,1);
  });
  await t.test("expiração da última lease na quinta tentativa encerra a execução e libera nova auditoria",async()=>{
    await reset();const e=await enfileirar("AUDITAR");const etapa=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id}});
    await db.olistSyncEtapa.updateMany({where:{execucaoId:e.id},data:{status:"CONCLUIDA"}});
    await db.olistSyncEtapa.update({where:{id:etapa.id},data:{status:"PROCESSANDO",tentativas:5,leaseToken:randomUUID(),leaseAte:new Date(0)}});
    await db.olistSyncExecucao.update({where:{id:e.id},data:{status:"AUDITANDO"}});
    for(let i=0;i<3;i++)await repo.reservarEtapa({agora:new Date(agora)});
    assert.equal((await db.olistSyncEtapa.findUniqueOrThrow({where:{id:etapa.id}})).status,"FALHOU");
    const final=await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}});
    assert.ok(["FALHOU","CONCLUIDA_COM_PENDENCIAS"].includes(final.status),"Uma execução sem etapas retomáveis não pode manter a trava de execução ativa.");
    const nova=await enfileirar("AUDITAR");await terminar(nova.id);assert.equal(chamadas.filter(r=>r.metodo!=="GET").length,0);
  });
  await t.test("revogação após reservar a escrita impede POST mesmo com precondições remotas válidas",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    const reserva=await reservarEscrita(e.id), consultas=chamadas.length;
    await sql.query("UPDATE usuario SET pode_executar_sincronizacao_olist=false WHERE id=$1",[usuario]);
    await servico.processar(reserva);await terminar(e.id);
    assert.equal(chamadas.length,consultas);assert.equal(escritas().length,0);assert.equal(contas.get(b)!.size,0);
  });
  await t.test("mudança da versão da configuração após reservar a escrita impede usar a proposta antiga",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    const reserva=await reservarEscrita(e.id);
    await db.olistSyncConfiguracao.update({where:{id:config.id},data:{versao:{increment:1}}});await servico.processar(reserva);await terminar(e.id);
    assert.equal(escritas().length,0);assert.equal(contas.get(b)!.size,0);
    assert.equal(await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"CONFIRMADA"}}),0);
  });
  await t.test("troca da conta remota depois das precondições não pode escrever no novo tenant",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    const reserva=await reservarEscrita(e.id);docs.set(b,"12ABC34501DE35");
    await servico.processar(reserva);await terminar(e.id);
    assert.equal(escritas().length,0,"A identidade vinculada à proposta precisa continuar válida no momento da escrita.");
    assert.equal(contas.get(b)!.size,0);
  });
  for(const alteracao of ["revogar usuário","cancelar execução","expirar lease","avançar revisão","bloquear participante"] as const) {
    await t.test(`guard após /info impede escrita ao ${alteracao}`,async()=>{
      await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
      const reserva=await reservarEscrita(e.id), operacao=await db.olistSyncOperacao.findFirstOrThrow();
      let mudou=false;
      interceptar=async(r,app)=>{
        if(mudou||app!==b||r.metodo!=="GET"||!new URL(r.url).pathname.endsWith("/info"))return;
        mudou=true;
        if(alteracao==="revogar usuário")await sql.query("UPDATE usuario SET pode_executar_sincronizacao_olist=false WHERE id=$1",[usuario]);
        else if(alteracao==="cancelar execução")await repo.cancelarExecucao(e.id,pai);
        else if(alteracao==="expirar lease")await db.olistSyncEtapa.update({where:{id:reserva.id},data:{leaseAte:new Date(0)}});
        else if(alteracao==="bloquear participante")await db.olistSyncConfiguracao.update({where:{id:config.id},data:{aplicativosBloqueados:[...config.aplicativosBloqueados,b]}});
        else await db.olistSyncRegistro.update({where:{id:operacao.registroId},data:{revisao:{increment:1}}});
      };
      await servico.processar(reserva);
      assert.equal(mudou,true,"A mudança deve ocorrer durante a consulta final de identidade.");
      assert.equal(escritas().length,0);assert.equal(contas.get(b)!.size,0);
      const atual=await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}});
      assert.equal(atual.tentativas,0,"O guard deve bloquear antes de marcar ou enviar a escrita.");
      assert.equal(["EM_APLICACAO","VERIFICANDO","CONFIRMADA"].includes(atual.status),false);
      if(alteracao==="bloquear participante") {
        assert.equal(atual.erroCodigo,"ESCOPO_ALTERADO","A liberação da janela não pode mascarar a recusa de elegibilidade.");
        const participante=await db.olistSyncParticipante.findUniqueOrThrow({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:b}},select:{proximaChamadaEm:true}});
        assert.ok(participante.proximaChamadaEm && participante.proximaChamadaEm.getTime()<=agora+18_000,"O finally precisa liberar a reserva longa da conta bloqueada.");
      }
    });
  }
  await t.test("reconciliação recusa outra conta antes de consultar o cadastro ou confirmar efeito",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
    await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"VERIFICANDO"}})>0,"efeito aguardando leitura de confirmação");
    const operacao=await db.olistSyncOperacao.findFirstOrThrow(), registro=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:operacao.registroId}});
    const estados=await db.olistSyncEstado.findMany({where:{registroId:registro.id},orderBy:{id:"asc"},select:{id:true,status:true,ultimaExecucaoId:true,hashesJson:true,dadosCriptografados:true}});
    const inicio=chamadas.length;docs.set(b,"12ABC34501DE35");await terminar(e.id);
    const atual=await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}});
    assert.equal(atual.status,"RESULTADO_INCONCLUSIVO");assert.equal(atual.erroCodigo,"CONTA_ALTERADA");
    assert.equal(escritas().length,1);
    assert.ok(chamadas.slice(inicio).some(r=>r.token===b&&new URL(r.url).pathname.endsWith("/info")));
    assert.equal(chamadas.slice(inicio).some(r=>r.token===b&&new URL(r.url).pathname.includes("/produtos")),false);
    const depois=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});
    assert.equal(depois.revisao,registro.revisao);assert.deepEqual(depois.hashesBaseJson,registro.hashesBaseJson);
    assert.deepEqual(await db.olistSyncEstado.findMany({where:{registroId:registro.id},orderBy:{id:"asc"},select:{id:true,status:true,ultimaExecucaoId:true,hashesJson:true,dadosCriptografados:true}}),estados);
  });
  await t.test("falha persistente de /info respeita limites de tentativas e janela sem enviar POST",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    const reserva=await reservarEscrita(e.id);let consultas=0;
    responder=async(r,app)=>{
      if(app!==b||r.metodo!=="GET"||!new URL(r.url).pathname.endsWith("/info"))return undefined;
      consultas++;return {status:500,dados:{}};
    };
    await servico.processar(reserva);assert.equal((await terminar(e.id,400)).status,"CONCLUIDA_COM_PENDENCIAS");
    const etapa=await db.olistSyncEtapa.findUniqueOrThrow({where:{id:reserva.id}});
    assert.ok(consultas>=1&&consultas<=5,"Falhas de identidade nunca geram retry sem limite.");
    assert.equal(escritas().length,0);assert.equal(contas.get(b)!.size,0);
    const operacao=await db.olistSyncOperacao.findFirstOrThrow();
    if(etapa.status==="FALHOU")assert.equal(etapa.tentativas,5);
    else {assert.equal(operacao.status,"OBSOLETA");assert.equal(operacao.erroCodigo,"JANELA_VALIDACAO_EXCEDIDA");}
    assert.equal(operacao.tentativas,0);assert.equal(["EM_APLICACAO","VERIFICANDO","RESULTADO_INCONCLUSIVO","CONFIRMADA"].includes(operacao.status),false);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,status:{in:["PENDENTE","PROCESSANDO","AGUARDANDO_RETRY"]}}}),0);
    const chamadasEncerradas=chamadas.length, repetida=await servico.executar(agora+240_000);
    assert.equal(repetida.etapas,0);assert.equal(chamadas.length,chamadasEncerradas);
  });
  await t.test("aceites concorrentes com a mesma chave retornam um trabalho e um único efeito",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const idempotencia=randomUUID();
    const entrada={configuracaoId:config.id,modo:"AUDITAR_E_APLICAR",idempotencia,solicitadoPor:usuario,origem:"MANUAL",completa:true} as const;
    const [primeira,segunda]=await Promise.all([repo.enfileirar(entrada),repo.enfileirar(entrada)]);
    assert.equal(primeira.id,segunda.id);assert.equal(await db.olistSyncExecucao.count(),1);
    await terminar(primeira.id);assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
    assert.equal((await repo.enfileirar(entrada)).id,primeira.id);assert.equal(await db.olistSyncExecucao.count(),1);
  });
  await t.test("nova auditoria de uma sincronização confirmada não recria nem reescreve a réplica",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar()).id);
    const registro=await db.olistSyncRegistro.findFirstOrThrow(), e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,1);assert.equal(await db.olistSyncOperacao.count(),1);assert.equal(contas.get(b)!.size,1);
    assert.equal(await db.olistSyncEstado.count({where:{status:"SINCRONIZADO"}}),2);
    const atualizado=await db.olistSyncRegistro.findFirstOrThrow();assert.equal(atualizado.aplicativoOrigemId,registro.aplicativoOrigemId);
    assert.equal(atualizado.origemExecucaoId,registro.origemExecucaoId);
  });
  await t.test("429 persistente esgota cinco tentativas sem criar o recurso nem reenviar após o limite",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));
    responder=async r=>r.metodo==="POST"?{status:429,dados:{},retryAfter:"60"}:undefined;
    const e=await enfileirar();await terminar(e.id,400);
    const operacao=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(operacao.status,"FALHA_PERMANENTE");assert.equal(operacao.tentativas,5);
    assert.equal(escritas().length,5);assert.equal(contas.get(b)!.size,0);
    await terminar((await enfileirar("APLICAR")).id);assert.equal(escritas().length,5);
  });
  await t.test("PUT com resposta perdida após commit é reconciliado por leitura e não repetido",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));contas.get(b)!.set("20",produto(20));await terminar((await enfileirar()).id);
    contas.get(a)!.get("10")!.descricao="Descrição após PUT";let respostaPerdida=false;
    responder=async(r,app)=>{
      if(r.metodo!=="PUT"||respostaPerdida)return undefined;
      assert.ok(r.payload&&typeof r.payload==="object"&&!Array.isArray(r.payload));respostaPerdida=true;
      const id=new URL(r.url).pathname.split("/").at(-1)!;contas.get(app)!.set(id,{...contas.get(app)!.get(id),...r.payload});
      throw new Error("Timeout após atualização remota confirmada pelo provedor simulado");
    };
    const e=await enfileirar();await terminar(e.id);
    assert.equal(respostaPerdida,true);assert.equal(escritas().length,1);assert.equal(escritas()[0].metodo,"PUT");
    assert.equal(contas.get(b)!.get("20")!.descricao,"Descrição após PUT");assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"CONFIRMADA");
    assert.deepEqual(contas.get(b)!.get("20")!.estoque,{saldo:10});
  });
  await t.test("POST sem resposta nem efeito fica em quarentena em novas auditorias e aplicações",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));
    responder=async r=>{if(r.metodo==="POST")throw new Error("Conexão perdida sem confirmação de recebimento");return undefined;};
    await terminar((await enfileirar()).id);const operacao=await db.olistSyncOperacao.findFirstOrThrow();
    assert.equal(operacao.status,"RESULTADO_INCONCLUSIVO");assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,0);
    responder=null;await terminar((await enfileirar()).id);await terminar((await enfileirar("APLICAR")).id);
    assert.equal(escritas().length,1);assert.equal(await db.olistSyncOperacao.count(),1);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}})).status,"RESULTADO_INCONCLUSIVO");
  });
  await t.test("vinte filhos convergem sem expirar a validação devido às esperas obrigatórias",async()=>{
    await reset();await habilitarTerceiro();
    const extras:string[]=[], apps=[a,b,terceiro];
    // Documentos sintéticos válidos: contas distintas precisam de identidades
    // verificáveis, mas a fixture nunca consulta o provedor real.
    const documento=(base:string)=>{
      const digito=(texto:string)=>{
        const soma=[...texto].reduce((total,n,i)=>total+Number(n)*(texto.length+1-i),0),resto=(soma*10)%11;
        return String(resto===10?0:resto);
      };
      const primeiro=base+digito(base);return primeiro+digito(primeiro);
    };
    async function consumirAteFinal(id:string) {
      for(let i=0;i<10;i++) {
        const resultado=await servico.executar(agora+900_000);
        const estado=await db.olistSyncExecucao.findUniqueOrThrow({where:{id},select:{status:true}});
        if(["CONCLUIDA","CONCLUIDA_COM_PENDENCIAS","FALHOU","CANCELADA"].includes(estado.status))return estado;
        assert.ok(resultado.etapas>0,"A execução ficou sem progresso entre invocações.");
      }
      assert.fail("A execução com vinte filhos não terminou no limite da fixture.");
    }
    try {
      for(let indice=0;indice<17;indice++) {
        const app=randomUUID();extras.push(app);apps.push(app);
        await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,$2,$3)",[app,`Empresa teste ${indice}`,pai]);
        await db.olistSyncParticipante.create({data:{configuracaoId:config.id,aplicativoId:app,habilitado:true}});
        contas.set(app,new Map());docs.set(app,documento(String(100000000+indice)));
      }
      for(const [indice,app] of apps.entries())contas.get(app)!.set(String(indice+10),produto(indice+10));
      assert.equal((await consumirAteFinal((await enfileirar("AUDITAR")).id)).status,"CONCLUIDA");
      // Dezenove réplicas têm a mesma mudança, apenas B precisa de PUT. Isso
      // exige validar 19 fontes sem inflar o teste com 19 aplicações diferentes.
      for(const app of apps.filter(app=>app!==b))for(const produto of contas.get(app)!.values())produto.descricao="Descrição compartilhada atualizada";
      await consumirAteFinal((await enfileirar("AUDITAR")).id);
      const proposta=await db.olistSyncOperacao.findFirstOrThrow({where:{status:"AUTORIZADA"}});
      assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),1);
      assert.equal(proposta.destinoAppId,b);
      const inicio=agora, execucao=await enfileirar("APLICAR");
      // Usa apenas o relógio virtual de executar()/aguardar(), sem avançar 6s
      // artificialmente entre etapas pelo helper passo().
      assert.equal((await consumirAteFinal(execucao.id)).status,"CONCLUIDA");
      assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:proposta.id}})).status,"CONFIRMADA");
      assert.equal(escritas().length,1);assert.equal(escritas()[0].metodo,"PUT");
      assert.equal(contas.get(b)!.get("11")!.descricao,"Descrição compartilhada atualizada");
      assert.equal(await db.olistSyncEstado.count({where:{status:"SINCRONIZADO"}}),20);
      assert.ok(agora-inicio>120_000,"O cenário precisa atravessar a antiga janela fixa.");
    } finally {
      await reset();
      await db.olistSyncParticipante.deleteMany({where:{configuracaoId:config.id,aplicativoId:{in:extras}}});
      await db.aplicativo.deleteMany({where:{id:{in:extras}}});
      for(const app of extras)docs.delete(app);
    }
  });
  await t.test("30/min retoma auditoria antiga sem relistar nem repetir detalhes já persistidos",async()=>{
    await reset();for(let i=0;i<12;i++)contas.get(a)!.set(String(100+i),produto(100+i,`SKU-${i}`,`Produto ${i}`));
    const e=await enfileirar("AUDITAR");
    await avancarAte(async()=>await db.olistSyncEstado.count({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}})===1,"um detalhe foi persistido");
    const salvo=await db.olistSyncEstado.findFirstOrThrow({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}});
    assert.deepEqual((await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:a}})).cursorJson,{});
    await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:a}},data:{proximaChamadaEm:new Date(agora+6_000)}});
    chamadas.length=0;
    const horarios:number[]=[];
    interceptar=async(r,app)=>{if(app===a&&/\/produtos\/\d+$/.test(new URL(r.url).pathname))horarios.push(agora);};
    const consumidor=criarServicoOlistSync(db,cliente,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{agora+=ms;}});
    await consumidor.executar(agora+240_000);
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(chamadas.filter(r=>/\/produtos\/\d+$/.test(new URL(r.url).pathname)).length,11);
    assert.ok(!chamadas.some(r=>new URL(r.url).pathname.endsWith("/produtos")||r.url.endsWith("/info")));
    assert.equal((await db.olistSyncEstado.findUniqueOrThrow({where:{id:salvo.id}})).dadosCriptografados,salvo.dadosCriptografados);
    for(let i=1;i<horarios.length;i++)assert.ok(horarios[i]-horarios[i-1]>=2_000&&horarios[i]-horarios[i-1]<6_000);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,status:{not:"CONCLUIDA"}}}),0);
    assert.equal(escritas().length,0);
  });
  await t.test("headers persistem a cota e adiam a próxima leitura sem perder o detalhe",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar("AUDITAR");
    responder=async(r,app)=>app===a&&new URL(r.url).pathname.endsWith("/produtos/10")
      ? {status:200,dados:contas.get(a)!.get("10"),cotaLeitura:{limite:60,restante:2,resetSegundos:40}}:undefined;
    await avancarAte(async()=>await db.olistSyncEstado.count({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}})===1,"detalhe com cota reduzida");
    const etapa=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:a}});
    const cursor=etapa.cursorJson as {cotaLeitura:{limite:number;restante:number}};
    assert.equal(cursor.cotaLeitura.limite,60);assert.equal(cursor.cotaLeitura.restante,2);
    const participante=await db.olistSyncParticipante.findUniqueOrThrow({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:a}}});
    assert.ok(participante.proximaChamadaEm!.getTime()>=agora+40_250);
    const antes=chamadas.length;await passo();assert.equal(chamadas.length,antes);
  });
  for(const latencia of [1_500,3_500])await t.test(`retoma detalhes com headers e latência de ${latencia}ms sem acrescentar 2s por resposta`,async()=>{
    await reset();
    const quantidade=latencia===1_500?32:12;
    for(let i=0;i<quantidade;i++)contas.get(a)!.set(String(10+i),produto(10+i,`LATENCIA-${i}`));
    const e=await enfileirar("AUDITAR");
    await avancarAte(async()=>await db.olistSyncEstado.count({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}})===1,"primeiro detalhe persistido pela versão anterior");
    const salvo=await db.olistSyncEstado.findFirstOrThrow({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}});
    const horarios:number[]=[];
    chamadas.length=0;
    responder=async(r,app)=>{
      if(app!==a||!/\/produtos\/\d+$/.test(new URL(r.url).pathname))return;
      horarios.push(agora);agora+=latencia;
      return {status:200,dados:contas.get(app)!.get(new URL(r.url).pathname.split("/").at(-1)!),
        cotaLeitura:{limite:60,restante:59-horarios.length,resetSegundos:Math.max(0,60-horarios.length*2)}};
    };
    const resultado=await servico.executar(agora+240_000);
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(horarios.length,quantidade-1);assert.ok(resultado.etapas>=quantidade-1);
    for(let i=1;i<horarios.length;i++)assert.equal(horarios[i]-horarios[i-1],Math.max(2_000,latencia));
    assert.equal((await db.olistSyncEstado.findUniqueOrThrow({where:{id:salvo.id}})).dadosCriptografados,salvo.dadosCriptografados);
    assert.ok(!chamadas.some(r=>r.url.endsWith("/info")||new URL(r.url).pathname.endsWith("/produtos")));
    assert.equal(escritas().length,0);
    const contadores=(await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).contadoresJson;
    assert.ok(contadores&&typeof contadores==="object"&&!Array.isArray(contadores));
    assert.equal(contadores.listados,quantidade);assert.equal(contadores.analisados,quantidade);
  });
  await t.test("429 na auditoria mantém checkpoint e a conta bloqueada pelo Retry-After",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar("AUDITAR");
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId:e.id,fase:"DETALHAR"}})===2,"listagem encerrada");
    responder=async(r,app)=>app===a&&new URL(r.url).pathname.endsWith("/produtos/10")
      ? {status:429,dados:{},retryAfter:"180",cotaLeitura:{limite:60,restante:0,resetSegundos:60}}:undefined;
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId:e.id,erroCodigo:"OLIST_429"}})>0,"429 registrado");
    const participante=await db.olistSyncParticipante.findUniqueOrThrow({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:a}}});
    assert.ok(participante.proximaChamadaEm!.getTime()>=agora+180_000);
    assert.equal(await db.olistSyncEstado.count({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}}),0);
    responder=null;agora+=180_001;await terminar(e.id);
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA_COM_PENDENCIAS");assert.equal(escritas().length,0);
  });
  await t.test("dois schedulers para o mesmo horário criam uma única execução durável",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{proximaExecucaoEm:new Date(agora-60_000)}});
    await Promise.all([servico.agendar(),servico.agendar()]);assert.equal(await db.olistSyncExecucao.count(),1);
    assert.ok((await db.olistSyncConfiguracao.findUniqueOrThrow({where:{id:config.id}})).proximaExecucaoEm!.getTime()>agora);
    assert.equal(escritas().length,0);
  });
  await t.test("uma invocação audita a 30/min e preserva as janelas de aplicação",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
    const esperas:number[]=[],horarios:{app:string;metodo:string;quando:number}[]=[];
    interceptar=async(r,app)=>{horarios.push({app,metodo:r.metodo,quando:agora});};
    const consumidor=criarServicoOlistSync(db,cliente,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{esperas.push(ms);agora+=ms;}});
    const resultado=await consumidor.executar(agora+240_000);
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA");
    assert.equal(escritas().length,1);assert.ok(resultado.etapas>10);assert.ok(esperas.length>1);assert.ok(esperas.includes(12_000));
    assert.ok(esperas.every(ms=>ms>0&&ms<=12_000));
    for(const app of [a,b]) {
      const conta=horarios.filter(h=>h.app===app);
      for(let i=1;i<conta.length;i++)assert.ok(conta[i].quando-conta[i-1].quando>=(conta[i-1].metodo==="GET"?2_000:12_000),"Preserva o intervalo da conta entre consultas/escritas.");
    }
  });
  await t.test("pausar durante a espera encerra a invocação sem polling nem nova chamada",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await enfileirar("AUDITAR");const esperas:number[]=[];
    const consumidor=criarServicoOlistSync(db,cliente,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{
      esperas.push(ms);agora+=ms;await db.configuracaoJob.update({where:{chave:JOBS_SYNC.auditar.chave},data:{pausado:true}});
    }});
    await consumidor.executar(agora+240_000);assert.equal(esperas.length,1);assert.equal(chamadas.length,2);assert.ok(chamadas.every(r=>r.url.endsWith("/info")));
  });
  await t.test("fila vazia, retry longo e orçamento curto encerram sem aguardar",async()=>{
    await reset();let esperas=0;
    const consumidor=criarServicoOlistSync(db,cliente,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{esperas++;agora+=ms;}});
    await consumidor.executar(agora+240_000);assert.equal(esperas,0);
    const e=await enfileirar("AUDITAR");await db.olistSyncEtapa.updateMany({where:{execucaoId:e.id},data:{disponivelEm:new Date(agora+60_000)}});
    await consumidor.executar(agora+240_000);assert.equal(esperas,0);assert.equal(chamadas.length,0);
    await db.olistSyncEtapa.updateMany({where:{execucaoId:e.id},data:{disponivelEm:new Date(agora+10_000)}});
    await consumidor.executar(agora+125_000);assert.equal(esperas,0);assert.equal(chamadas.length,0);
  });
});
