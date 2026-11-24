import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { aplicarMigrationsOlistSync } from "./fixtures/olist-sync-migrations";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { criarOlistSyncRepository, JOBS_SYNC } from "../src/repositories/olist-sync-repository";
import { criarServicoOlistSync } from "../src/services/olist-sync-service";
import { resolverPendenciaSync } from "../src/services/olist-sync-review-service";
import { criarClienteSync, type DependenciasClienteSync, type RequisicaoSync, type RespostaHttpSync } from "../src/lib/olist-sync/cliente";
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
  await aplicarMigrationsOlistSync(sql);
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist,pode_configurar_sincronizacao_olist) VALUES ($1,$2,true,true)", [usuario,pai]);
  const repo = criarOlistSyncRepository(db), config = await repo.obterConfiguracao(pai); assert.ok(config);
  await db.olistSyncParticipante.create({ data: { configuracaoId:config.id, aplicativoId:terceiro, habilitado:false } });
  const cripto = criarCriptografiaSync({ OLIST_SYNC_DATA_KEY:Buffer.alloc(32,1).toString("base64"), OLIST_SYNC_HMAC_KEY:Buffer.alloc(32,2).toString("base64") });
  let agora = Date.now();
  const contas = new Map<string, Map<string, CamposSync>>();
  const tipos = new Map<string, Array<{id:number;nome:string;perfilContato:number}>>();
  const chamadas:RequisicaoSync[] = [];
  const credenciaisSolicitadas:string[] = [];
  let proximoId = 1000;
  let postIncerto = false;
  let post429 = false;
  let rejeitarDestino:string|null = null;
  let interceptar:((r:RequisicaoSync,app:string)=>Promise<void>)|null = null;
  let responder:((r:RequisicaoSync,app:string)=>Promise<RespostaHttpSync|undefined>)|null = null;
  const docs = new Map([[a,"04252011000110"],[b,"11222333000181"],[terceiro,"12ABC34501DE35"]]);
  const transporte: DependenciasClienteSync = {
    agora:()=>agora,
    async configurar() { return { apiBaseUrl:"https://api.tiny.com.br/public-api/v3" }; },
    async token(app) { credenciaisSolicitadas.push(app); return app; },
    async http(r) {
      chamadas.push(r); const app = r.token, conta = contas.get(app)!; const caminho = new URL(r.url);
      if (interceptar) await interceptar(r,app);
      if(responder) {const resposta=await responder(r,app);if(resposta)return resposta;}
      if (caminho.pathname.endsWith("/info")) return { status:200, dados:{cpfCnpj:docs.get(app),razaoSocial:`Conta ${app}`} };
      if (caminho.pathname.endsWith("/contatos/tipos")) {
        const itens=tipos.get(app)??[], offset=Number(caminho.searchParams.get("offset")), limit=Number(caminho.searchParams.get("limit"));
        return {status:200,dados:{itens:itens.slice(offset,offset+limit),paginacao:{total:itens.length,offset,limit}}};
      }
      if (["/produtos","/formas-pagamento","/contatos"].some(recurso=>caminho.pathname.endsWith(recurso)) && r.metodo==="GET") {
        const codigo=caminho.searchParams.get("codigo"), offset=Number(caminho.searchParams.get("offset")??0), limit=Number(caminho.searchParams.get("limit")??100);
        const nome=caminho.searchParams.get("nome");
        const normalizarNome=(valor:string)=>valor.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("pt-BR");
        const itens=[...conta.values()].filter(item=>(!codigo||item.sku===codigo)&&(!nome||normalizarNome(String(item.nome??"")).includes(normalizarNome(nome))));
        return { status:200,dados:{itens:itens.slice(offset,offset+limit),paginacao:{total:itens.length,offset,limit}} };
      }
      const expandirProducao=(valor:unknown):CamposSync=>{
        const producao=valor as {produtos:Array<{produto:{id:number};quantidade:number}>;etapas:string[]};
        return {etapas:producao.etapas,produtos:producao.produtos.map(item=>({produto:conta.get(String(item.produto.id))??item.produto,quantidade:item.quantidade}))};
      };
      if(caminho.pathname.endsWith("/fabricado")) {
        const produtoId=caminho.pathname.split("/").at(-2)!;
        assert.equal(r.metodo,"PUT");assert.ok(conta.has(produtoId));
        conta.set(produtoId,{...conta.get(produtoId),producao:expandirProducao(r.payload)});
        return {status:204,dados:null};
      }
      const id=caminho.pathname.split("/").at(-1)!;
      if(r.metodo==="GET") return conta.has(id)?{status:200,dados:conta.get(id)}:{status:404,dados:{}};
      assert.ok(r.payload && !Array.isArray(r.payload) && typeof r.payload==="object");
      for(const campo of ["estoque","precos","custos","tributacao","ncm"]) assert.equal(campo in r.payload,false,`Campo protegido enviado: ${campo}`);
      if (app===rejeitarDestino) return {status:422,dados:{}};
      const payloadProduto=r.payload.producao?{...r.payload,producao:expandirProducao(r.payload.producao)}:r.payload;
      const dadosContato=caminho.pathname.includes("/contatos") && Array.isArray(r.payload.tipos)
        ? {...r.payload,tipos:r.payload.tipos.map(id=>({id,descricao:tipos.get(app)?.find(tipo=>tipo.id===id)?.nome??null}))}:payloadProduto;
      if(r.metodo==="POST") {
        if(post429) {post429=false;return {status:429,dados:{},retryAfter:"60"};}
        const criado=String(proximoId++);conta.set(criado,{id:Number(criado),situacao:"A",...dadosContato});
        if(postIncerto) {postIncerto=false;throw new Error("Resposta perdida depois do commit remoto");}
        return {status:200,dados:{id:Number(criado)}};
      }
      conta.set(id,{...conta.get(id),...dadosContato});return {status:204,dados:null};
    },
  };
  const cliente = criarClienteSync(transporte);
  const servico=criarServicoOlistSync(db,cliente,{agora:()=>new Date(agora),cripto,aguardar:async ms=>{agora+=ms;}});
  const produto=(id:number,sku="001-A",descricao="Ref Toalha"):CamposSync=>({id,sku,descricao:descricao.startsWith("Ref ")?descricao:`Ref ${descricao}`,tipo:"S",situacao:"A",estoque:{saldo:10},precos:{preco:50},ncm:"1234"});
  async function reset() {
    await sql.query("TRUNCATE olist_sync_registro,olist_sync_execucao CASCADE");
    await db.configuracaoJob.updateMany({data:{pausado:false}});
    await db.olistSyncConfiguracao.update({where:{id:config!.id},data:{ativo:true,autorizadoPor:usuario,entidades:["PRODUTO"],limiteAlteracoes:100,aplicativosBloqueados:config!.aplicativosBloqueados,proximaExecucaoEm:new Date(Date.now()+86_400_000),readinessJson:{sincronizacaoNativaCompativel:true,semanticaPutValidada:true}}});
    await db.olistSyncParticipante.updateMany({where:{configuracaoId:config!.id},data:{contaIdentidade:null,proximaChamadaEm:null}});
    await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config!.id,aplicativoId:terceiro}},data:{habilitado:false}});
    await sql.query("UPDATE usuario SET ativo=true,pode_executar_sincronizacao_olist=true WHERE id=$1",[usuario]);
    tipos.clear();contas.clear(); for(const app of [a,b,terceiro])contas.set(app,new Map()); chamadas.length=0;credenciaisSolicitadas.length=0;postIncerto=false;post429=false;rejeitarDestino=null;interceptar=null;responder=null;agora=Date.now()+1000;proximoId=1000;
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
    const execucao=await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}});assert.deepEqual(execucao.contadoresJson,{listados:1,analisados:1,criados:1,alterados:1,comparados:1,detalhados:1});
    assert.equal(contas.get(b)!.size,1);assert.ok(chamadas.some(r=>r.metodo==="GET"&&r.url.endsWith(`/produtos/${op.remoteId}`)));
  });
  await t.test("convergência confirma todas as réplicas, inclusive a fonte, sem exigir nova auditoria",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar()).id);
    const aposCriacao=await db.olistSyncEstado.findMany({select:{aplicativoId:true,status:true}});
    assert.equal(aposCriacao.length,2);
    assert.ok(aposCriacao.every(estado=>estado.status==="SINCRONIZADO"),"A fonte também participa da base comum confirmada.");
    const replica=[...contas.get(b)!.values()][0];replica.descricao="Ref Atualização da antiga réplica";
    await terminar((await enfileirar()).id);
    const aposAtualizacao=await db.olistSyncEstado.findMany({select:{aplicativoId:true,status:true}});
    assert.equal(aposAtualizacao.length,2);assert.ok(aposAtualizacao.every(estado=>estado.status==="SINCRONIZADO"));
    assert.equal(contas.get(a)!.get("10")!.descricao,"Ref Atualização da antiga réplica");
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
    contas.get(a)!.get("10")!.descricao="Ref Toalha nova";await terminar((await enfileirar()).id);
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.get("20")!.descricao,"Ref Toalha nova");
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
    contas.get(a)!.get("10")!.descricao="Ref Atualização permitida";
    await terminar((await enfileirar()).id);
    const atual=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});
    assert.equal(atual.aplicativoOrigemId,terceiro);assert.equal(atual.registroOlistOrigemId,"HISTORICO");assert.equal(atual.origemTipo,"DECLARADA_POR_USUARIO");
    assert.equal([...contas.get(b)!.values()][0].descricao,"Ref Atualização permitida");
    assert.ok(credenciaisSolicitadas.every(app=>[a,b].includes(app)),"O histórico não deve conceder sequer a leitura das credenciais.");
    assert.ok(chamadas.every(chamada=>[a,b].includes(chamada.token)),"Proveniência não concede acesso à conta excluída.");
  });
  await t.test("uma confirmação parcial não avança a base se outro destino da revisão falhou",async()=>{
    await reset();await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:terceiro}},data:{habilitado:true}});
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),produto(id));
    await terminar((await enfileirar()).id);const antes=await db.olistSyncRegistro.findFirstOrThrow();
    contas.get(a)!.get("10")!.descricao="Ref Mudança parcial";rejeitarDestino=b;await terminar((await enfileirar()).id);
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
    contas.get(a)!.get("10")!.descricao="Ref Texto A alterado";await terminar((await enfileirar()).id);
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
  for(const retorno of ["E","404"] as const)await t.test(`contato sem documento excluído (${retorno}) encerra só sua pendência e reabre se restaurado`,async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    const contato={id:10,nome:"J******e",cpfCnpj:"",tipoPessoa:"F",situacao:"B"};
    contas.get(a)!.set("10",contato);contas.get(b)!.set("20",{...contato,id:20});
    await terminar((await enfileirar("AUDITAR")).id);
    const chaveDedupe=cripto.hash(`sem-chave:${a}:CONTATO:10`,`${config.id}:pendencia`);
    const p=await db.olistSyncPendencia.findUniqueOrThrow({where:{configuracaoId_chaveDedupe:{configuracaoId:config.id,chaveDedupe}}});
    const outra=await db.olistSyncPendencia.findFirstOrThrow({where:{aplicativoId:b}});
    const falha=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,aplicativoId:a,entidade:"CONTATO",tipo:"OLIST_400",severidade:"ALTA",chaveDedupe:"outra-falha-na-mesma-conta"}});
    if(retorno==="E")contas.get(a)!.set("10",{...contato,situacao:"E"});else contas.get(a)!.delete("10");
    await terminar((await enfileirar()).id);
    const resolvida=await db.olistSyncPendencia.findUniqueOrThrow({where:{id:p.id}});
    assert.equal(resolvida.status,"RESOLVIDA");assert.equal(resolvida.versao,p.versao+1);assert.ok(resolvida.decididoEm);
    assert.deepEqual(resolvida.decisaoJson,{acao:"ENCERRAR_CONTATO_REMOVIDO",origem:"AUDITORIA_OLIST"});
    const estado=await db.olistSyncEstado.findFirstOrThrow({where:{aplicativoId:a,remoteId:"10"}});
    assert.equal(estado.presente,false);assert.equal(estado.status,"INATIVO_EXCLUIDO");assert.equal(estado.detalhePendente,false);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:outra.id}})).status,"AGUARDANDO_REVISAO");
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:falha.id}})).status,"AGUARDANDO_REVISAO");
    await terminar((await enfileirar()).id);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:p.id}})).versao,resolvida.versao,"Exclusão repetida é idempotente");
    contas.get(a)!.set("10",contato);await terminar((await enfileirar()).id);
    const reaberta=await db.olistSyncPendencia.findUniqueOrThrow({where:{id:p.id}});
    assert.equal(reaberta.status,"AGUARDANDO_REVISAO");assert.equal(reaberta.decididoEm,null);
    assert.equal((await db.olistSyncEstado.findUniqueOrThrow({where:{id:estado.id}})).presente,true);
    assert.equal(escritas().length,0,"Não recria nem altera contatos na Olist");
  });
  for(const retorno of ["I","503"] as const)await t.test(`contato sem documento com ${retorno} não encerra pendência como se excluído`,async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    contas.get(a)!.set("10",{id:10,nome:"A******a",cpfCnpj:"",tipoPessoa:"F",situacao:"B"});
    await terminar((await enfileirar("AUDITAR")).id);
    const pendencia=await db.olistSyncPendencia.findFirstOrThrow({where:{aplicativoId:a}});
    if(retorno==="I")contas.get(a)!.get("10")!.situacao="I";
    else responder=async(r,app)=>app===a&&new URL(r.url).pathname.endsWith("/contatos/10")?{status:503,dados:{}}:undefined;
    await terminar((await enfileirar("AUDITAR")).id);
    const atual=await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendencia.id}});
    assert.equal(atual.status,"AGUARDANDO_REVISAO");assert.equal(atual.decididoEm,null);
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({where:{aplicativoId:a,remoteId:"10"}})).presente,true);
    assert.equal(escritas().length,0);
  });
  for(const respostaPerdida of [false,true])await t.test(`contato sem documento cria por nome e não duplica em retomada (resposta perdida: ${respostaPerdida})`,async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    const origem={id:10,nome:"Eva do Pilar Santos Melo",cpfCnpj:null,tipoPessoa:"F",situacao:"B",tipos:[]};
    contas.get(a)!.set("10",origem);
    const observada=observarRegistro("CONTATO",origem,{completo:true});
    const antiga={id:observada.id,nome:observada.nome,situacao:observada.situacao,campos:observada.campos,alteradoEm:null,completo:true,chave:null,pendencias:["IDENTIDADE_AUSENTE_OU_INVALIDA"]};
    await db.olistSyncEstado.create({data:{configuracaoId:config.id,aplicativoId:a,entidade:"CONTATO",remoteId:"10",chave:null,metadadosJson:{completo:true},dadosCriptografados:cripto.cifrar(antiga,`${config.id}:estado:${a}:CONTATO:10`)}});
    const chaveDedupe=cripto.hash(`sem-chave:${a}:CONTATO:10`,`${config.id}:pendencia`);
    const pendente=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,aplicativoId:a,entidade:"CONTATO",tipo:"IDENTIDADE_REQUER_REVISAO",severidade:"ALTA",chaveDedupe}});
    postIncerto=respostaPerdida;const execucao=await enfileirar();
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId:execucao.id,aplicativoId:b,cursorJson:{path:["fase"],equals:"FONTES_NOME"}}})>0,"busca de homônimos aguarda em checkpoint próprio");
    const etapaNome=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:execucao.id,aplicativoId:b,fase:"APLICAR"}});
    const janelaFonte=await db.olistSyncParticipante.findUniqueOrThrow({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:a}}});
    assert.equal(etapaNome.disponivelEm.getTime(),janelaFonte.proximaChamadaEm!.getTime(),"Busca respeita a janela da fonte, não só a do destino");
    await terminar(execucao.id);
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
    assert.equal([...contas.get(b)!.values()][0].cpfCnpj,null);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendente.id}})).status,"RESOLVIDA");
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),1);
    assert.ok(chamadas.some(r=>new URL(r.url).searchParams.has("nome")));
    assert.ok(chamadas.filter(r=>new URL(r.url).searchParams.has("nome")).every(r=>new URL(r.url).searchParams.get("nome")===origem.nome));
    await terminar((await enfileirar()).id);assert.equal(escritas().length,1,"Reauditoria não repete a criação");
    assert.equal(await db.olistSyncEstado.count({where:{presente:true,registroId:{not:null}}}),2);
  });
  await t.test("contatos já existentes sem documento são comparados pelo nome sem novo POST",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    for(const [app,id]of [[a,10],[b,20]]as const)contas.get(app)!.set(String(id),{id,nome:"Eva Santos",cpfCnpj:null,tipoPessoa:"F",situacao:"B",tipos:[]});
    await terminar((await enfileirar()).id);
    assert.equal(escritas().length,0);assert.equal(await db.olistSyncRegistro.count(),1);
    assert.equal(await db.olistSyncEstado.count({where:{status:"SINCRONIZADO"}}),2);
  });
  await t.test("homônimos sem documento na mesma empresa bloqueiam antes de escrever",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    for(const id of [10,11])contas.get(a)!.set(String(id),{id,nome:"Eva Santos",cpfCnpj:null,tipoPessoa:"F",situacao:"B",tipos:[]});
    await terminar((await enfileirar()).id);assert.equal(escritas().length,0);
    assert.ok(await db.olistSyncPendencia.count({where:{tipo:"IDENTIDADE_DUPLICADA",status:"AGUARDANDO_REVISAO"}}));
  });
  await t.test("homônimo criado na origem após auditoria bloqueia a aplicação por nome",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    const contato={id:10,nome:"Eva Santos",cpfCnpj:null,tipoPessoa:"F",situacao:"B",tipos:[]};
    contas.get(a)!.set("10",contato);await terminar((await enfileirar("AUDITAR")).id);
    contas.get(a)!.set("11",{...contato,id:11,nome:"  EVA   SANTOS "});
    await terminar((await enfileirar("APLICAR")).id);assert.equal(escritas().length,0);
    assert.ok(await db.olistSyncPendencia.count({where:{tipo:"IDENTIDADE_DUPLICADA",status:"AGUARDANDO_REVISAO"}}));
  });
  await t.test("nome sem documento não é unido a CPF preenchido nem gera criação reversa duplicada",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    contas.get(a)!.set("10",{id:10,nome:"Eva Santos",cpfCnpj:null,tipoPessoa:"F",situacao:"B",tipos:[]});
    contas.get(b)!.set("20",{id:20,nome:"Eva Santos",cpfCnpj:"52998224725",tipoPessoa:"F",situacao:"B",tipos:[]});
    await terminar((await enfileirar()).id);assert.equal(escritas().length,0);
    assert.ok(await db.olistSyncPendencia.count({where:{tipo:{in:["POSSIVEL_DUPLICIDADE","IDENTIDADE_INCOMPATIVEL"]},status:"AGUARDANDO_REVISAO"}}));
  });
  for(const faseFalha of ["FONTE","DESTINO","CONFIRMACAO"]as const)await t.test(`400 na consulta de ${faseFalha} isola só o contato e continua a fila`,async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    for(const [id,nome]of [[10,"Contato Primeiro Teste"],[11,"Contato Segundo Teste"]]as const)
      contas.get(a)!.set(String(id),{id,nome,cpfCnpj:null,tipoPessoa:"F",situacao:"B",tipos:[]});
    await terminar((await enfileirar("AUDITAR")).id);
    const operacoes=await db.olistSyncOperacao.findMany({where:{status:"AUTORIZADA"},orderBy:{id:"asc"},select:{id:true,precondicoesJson:true}});
    assert.equal(operacoes.length,2);
    const replicas=(operacoes[0].precondicoesJson as {replicas:Record<string,{remoteId:string}>}).replicas;
    const nomeFalho=String(contas.get(a)!.get(replicas[a].remoteId)!.nome);
    let falhas=0;
    responder=async(r,app)=>{
      const u=new URL(r.url);
      if(r.metodo!=="GET"||u.searchParams.get("nome")!==nomeFalho)return;
      const criado=[...contas.get(b)!.values()].some(item=>item.nome===nomeFalho);
      if(faseFalha==="FONTE"?app===a:app===b&&(faseFalha==="DESTINO"||criado)) {
        falhas++;return {status:400,dados:{mensagem:"Sua consulta levou muito tempo."}};
      }
    };
    postIncerto=faseFalha==="CONFIRMACAO";
    const execucao=await enfileirar("APLICAR");
    assert.equal((await terminar(execucao.id)).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(falhas,1);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:execucao.id,status:"FALHOU"}}),0);
    const isolada=await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacoes[0].id}});
    assert.equal(isolada.erroCodigo,"CONSULTA_OLIST_400");
    assert.equal(isolada.status,faseFalha==="CONFIRMACAO"?"RESULTADO_INCONCLUSIVO":"OBSOLETA");
    assert.equal(isolada.tentativas,faseFalha==="CONFIRMACAO"?1:0);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacoes[1].id}})).status,"CONFIRMADA");
    assert.equal(await db.olistSyncPendencia.count({where:{tipo:"CONSULTA_OLIST_400",status:"AGUARDANDO_REVISAO"}}),1);
    assert.equal(escritas().length,faseFalha==="CONFIRMACAO"?2:1);
    const escritasAntes=escritas().length;
    if(faseFalha==="CONFIRMACAO")responder=null;
    await terminar((await enfileirar("APLICAR")).id);
    assert.equal(escritas().length,escritasAntes,"Retomada não reenvia POST aceito ou operação isolada");
    if(faseFalha==="CONFIRMACAO") {
      assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:isolada.id}})).status,"CONFIRMADA");
      assert.equal(await db.olistSyncPendencia.count({where:{tipo:"CONSULTA_OLIST_400",status:"AGUARDANDO_REVISAO"}}),0);
    }
  });
  for(const respostaPerdida of [false,true])await t.test(`contato com DV inválido é sincronizado e encerra revisão antiga (resposta perdida: ${respostaPerdida})`,async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    const origem={id:10,nome:"Contato Teste",cpfCnpj:"52998224726",tipoPessoa:"F",situacao:"B",tipos:[]};
    contas.get(a)!.set("10",origem);
    const obs=observarRegistro("CONTATO",origem,{completo:true});
    const antiga={id:obs.id,nome:obs.nome,situacao:obs.situacao,campos:obs.campos,alteradoEm:null,completo:true,chave:null,pendencias:["IDENTIDADE_AUSENTE_OU_INVALIDA"]};
    await db.olistSyncEstado.create({data:{configuracaoId:config.id,aplicativoId:a,entidade:"CONTATO",remoteId:"10",chave:null,metadadosJson:{completo:true},dadosCriptografados:cripto.cifrar(antiga,`${config.id}:estado:${a}:CONTATO:10`)}});
    const pendente=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,aplicativoId:a,entidade:"CONTATO",tipo:"IDENTIDADE_REQUER_REVISAO",severidade:"ALTA",chaveDedupe:cripto.hash(`sem-chave:${a}:CONTATO:10`,`${config.id}:pendencia`)}});
    postIncerto=respostaPerdida;
    await terminar((await enfileirar()).id);
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
    assert.equal([...contas.get(b)!.values()][0].cpfCnpj,origem.cpfCnpj);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:pendente.id}})).status,"RESOLVIDA");
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),1);
    assert.ok(chamadas.some(r=>new URL(r.url).searchParams.get("cpfCnpj")===origem.cpfCnpj));
    await terminar((await enfileirar()).id);assert.equal(escritas().length,1);
  });
  await t.test("documento sem validação local mantém bloqueio de duplicidade e rejeição real da Olist",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    const origem={id:10,nome:"Contato Teste",cpfCnpj:"00000000000",tipoPessoa:"F",situacao:"B",tipos:[]};
    for(const id of [10,11])contas.get(a)!.set(String(id),{...origem,id});
    await terminar((await enfileirar()).id);
    assert.equal(escritas().length,0);
    assert.ok(await db.olistSyncPendencia.count({where:{tipo:"IDENTIDADE_DUPLICADA",status:"AGUARDANDO_REVISAO"}}));
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    contas.get(a)!.set("10",origem);
    responder=async(r,app)=>app===b&&r.metodo==="POST"?{status:400,dados:{}}:undefined;
    await terminar((await enfileirar()).id);
    assert.equal(escritas().length,1);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"FALHA_PERMANENTE");
    assert.ok(await db.olistSyncPendencia.count({where:{tipo:"OLIST_400",status:"AGUARDANDO_REVISAO"}}));
    await terminar((await enfileirar("APLICAR")).id);assert.equal(escritas().length,1,"Rejeição permanente não repete POST");
  });
  await t.test("vínculo manual de contatos mascarados sobrevive à reauditoria sem liberar escrita",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    for(const [app,id] of [[a,10],[b,20]] as const)contas.get(app)!.set(String(id),{id,nome:"C******e",cpfCnpj:null,tipoPessoa:"F",situacao:"B"});
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
    contas.get(a)!.get("10")!.nome="C******o";
    await terminar((await enfileirar()).id);
    assert.equal(escritas().length,0,"Vínculo manual não libera escrita de contato sem documento e com nome mascarado.");
    assert.equal(contas.get(b)!.get("20")!.nome,"C******e");
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
    contas.get(a)!.get("10")!.descricao="Ref Mudança para todas";const e=await enfileirar();
    // Adia apenas a etapa de C: B continua autorizado a consultar a conta C.
    await adiarDestino(e.id,terceiro);await aguardarConfirmacao(e.id,b);await liberarDestino(e.id,terceiro);await terminar(e.id);
    assert.equal(contas.get(b)!.get("20")!.descricao,"Ref Mudança para todas");
    assert.equal(contas.get(terceiro)!.get("30")!.descricao,"Ref Mudança para todas");
    assert.equal(await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"CONFIRMADA"}}),2);
    assert.notDeepEqual((await db.olistSyncRegistro.findFirstOrThrow()).hashesBaseJson,base.hashesBaseJson);
    assert.equal(escritas().length,2);
  });
  await t.test("alteração externa após uma confirmação não é aceita como avanço da mesma proposta",async()=>{
    await reset();await habilitarTerceiro();
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),produto(id));
    await terminar((await enfileirar()).id);const base=await db.olistSyncRegistro.findFirstOrThrow();
    contas.get(a)!.get("10")!.descricao="Ref Alteração autorizada";
    const e=await enfileirar();await adiarDestino(e.id,terceiro);await aguardarConfirmacao(e.id,b);
    assert.equal(contas.get(b)!.get("20")!.descricao,"Ref Alteração autorizada");
    contas.get(b)!.get("20")!.descricao="Ref Edição externa posterior à confirmação";
    await liberarDestino(e.id,terceiro);await terminar(e.id);
    assert.equal(contas.get(terceiro)!.get("30")!.descricao,"Ref Toalha");
    assert.equal(contas.get(b)!.get("20")!.descricao,"Ref Edição externa posterior à confirmação");
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
    contas.get(a)!.get("10")!.descricao="Ref Descrição nova";
    contas.get(b)!.get("20")!.descricaoComplementar="Complemento novo";
    const e=await enfileirar();await adiarDestino(e.id,b);await aguardarConfirmacao(e.id,a);await liberarDestino(e.id,b);await terminar(e.id);
    for(const [app,id] of [[a,"10"],[b,"20"]] as const) {
      assert.equal(contas.get(app)!.get(id)!.descricao,"Ref Descrição nova");
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
    replica.descricao="Ref Atualização feita na réplica";const e=await enfileirar();await terminar(e.id);
    const final=await db.olistSyncRegistro.findFirstOrThrow();
    assert.equal(contas.get(a)!.get("10")!.descricao,"Ref Atualização feita na réplica");assert.equal(final.ultimaFonteAppId,b);
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
    const e=await enfileirar("AUDITAR");assert.equal((await terminar(e.id,400)).status,"CONCLUIDA",JSON.stringify({ops:await db.olistSyncOperacao.findMany({select:{acao:true,status:true,erroCodigo:true}}),pendencias:await db.olistSyncPendencia.findMany({select:{tipo:true}})}));
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
    contas.get(a)!.get("10")!.descricao="Ref Descrição após PUT";let respostaPerdida=false;
    responder=async(r,app)=>{
      if(r.metodo!=="PUT"||respostaPerdida)return undefined;
      assert.ok(r.payload&&typeof r.payload==="object"&&!Array.isArray(r.payload));respostaPerdida=true;
      const id=new URL(r.url).pathname.split("/").at(-1)!;contas.get(app)!.set(id,{...contas.get(app)!.get(id),...r.payload});
      throw new Error("Timeout após atualização remota confirmada pelo provedor simulado");
    };
    const e=await enfileirar();await terminar(e.id);
    assert.equal(respostaPerdida,true);assert.equal(escritas().length,1);assert.equal(escritas()[0].metodo,"PUT");
    assert.equal(contas.get(b)!.get("20")!.descricao,"Ref Descrição após PUT");assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"CONFIRMADA");
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
      for(const app of apps.filter(app=>app!==b))for(const produto of contas.get(app)!.values())produto.descricao="Ref Descrição compartilhada atualizada";
      await consumirAteFinal((await enfileirar("AUDITAR")).id);
      const proposta=await db.olistSyncOperacao.findFirstOrThrow({where:{status:"AUTORIZADA"}});
      assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),1);
      assert.equal(proposta.destinoAppId,b);
      const inicio=agora, execucao=await enfileirar("APLICAR");
      interceptar=async r=>{if(r.metodo==="GET"&&!r.url.endsWith("/info"))agora+=7_000;};
      // Usa apenas o relógio virtual de executar()/aguardar(), sem avançar 6s
      // artificialmente entre etapas pelo helper passo().
      assert.equal((await consumirAteFinal(execucao.id)).status,"CONCLUIDA");
      assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:proposta.id}})).status,"CONFIRMADA");
      assert.equal(escritas().length,1);assert.equal(escritas()[0].metodo,"PUT");
      assert.equal(contas.get(b)!.get("11")!.descricao,"Ref Descrição compartilhada atualizada");
      assert.equal(await db.olistSyncEstado.count({where:{status:"SINCRONIZADO"}}),20);
      assert.ok(agora-inicio>120_000,"O cenário precisa atravessar a antiga janela fixa.");
    } finally {
      await reset();
      await db.olistSyncParticipante.deleteMany({where:{configuracaoId:config.id,aplicativoId:{in:extras}}});
      await db.aplicativo.deleteMany({where:{id:{in:extras}}});
      for(const app of extras)docs.delete(app);
    }
  });
  await t.test("30/min retoma coleta completa com plano sem relistar nem repetir detalhes já persistidos",async()=>{
    await reset();for(let i=0;i<12;i++)contas.get(a)!.set(String(100+i),produto(100+i,`SKU-${i}`,`Produto ${i}`));
    const e=await enfileirar("AUDITAR");
    await avancarAte(async()=>await db.olistSyncEstado.count({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}})===1,"um detalhe foi persistido");
    const salvo=await db.olistSyncEstado.findFirstOrThrow({where:{ultimaExecucaoId:e.id,metadadosJson:{path:["completo"],equals:true}}});
    const checkpoint=(await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:a}})).cursorJson as {plano:{modo:string}};
    assert.equal(checkpoint.plano.modo,"COMPLETA");
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
  const contato=(id:number, documento="52998224725", tiposContato:CamposSync["tipos"]=[]) => ({id,nome:"Contato",cpfCnpj:documento,tipoPessoa:"F",situacao:"B",tipos:tiposContato});
  await t.test("tipos equivalentes com IDs distintos criam contato usando o ID do destino e resolvem bloqueio antigo",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    tipos.set(a,[{id:1,nome:"Cliente",perfilContato:0}]);tipos.set(b,[{id:87,nome:" CLIENTE ",perfilContato:0}]);
    contas.get(a)!.set("10",contato(10,undefined,[{id:1,descricao:"Cliente"}]));
    const audit=await enfileirar("AUDITAR");await terminar(audit.id);
    const registro=await db.olistSyncRegistro.findFirstOrThrow({where:{entidade:"CONTATO"}});
    await db.olistSyncPendencia.create({data:{configuracaoId:config.id,registroId:registro.id,entidade:"CONTATO",tipo:"REFERENCIA_TIPOS_CONTATO",severidade:"ALTA",chaveDedupe:"bloqueio-legado"}});
    // A projeção antiga não guardava tipos; a nova coleta precisa substituí-la.
    await db.olistSyncEstado.updateMany({where:{registroId:registro.id},data:{fingerprint:"projecao-legada"}});
    const e=await enfileirar();const fim=await terminar(e.id);
    assert.equal(fim.status,"CONCLUIDA",JSON.stringify(await db.olistSyncOperacao.findMany({select:{status:true,erroCodigo:true}})));
    assert.equal(escritas().length,1);assert.deepEqual((escritas()[0].payload as CamposSync).tipos,[87]);
    assert.equal("tiposContato" in (escritas()[0].payload as CamposSync),false);
    assert.equal(await db.olistSyncPendencia.count({where:{registroId:registro.id,status:"AGUARDANDO_REVISAO"}}),0);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),1);
    // Uma página por conta em cada auditoria e uma por conta na aplicação;
    // o número de chamadas não cresce com o número de contatos detalhados.
    assert.equal(chamadas.filter(r=>new URL(r.url).pathname.endsWith("/contatos/tipos")).length,6);
  });
  await t.test("confirma cobrança vazia materializada pela Olist sem alterar a origem",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    contas.get(a)!.set("10",contato(10));
    responder=async(r,app)=>app===b&&r.metodo==="GET"&&/\/contatos\/\d+$/.test(new URL(r.url).pathname)
      ?{status:200,dados:{...contas.get(b)!.get(new URL(r.url).pathname.split('/').at(-1)!)!,enderecoCobranca:{endereco:"",numero:null,pais:"Brasil"}}}:undefined;
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA");
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),1);
    assert.equal(escritas().length,1);assert.equal(escritas()[0].token,b);
    assert.equal(contas.get(a)!.size,1);assert.equal(contas.get(a)!.get("10")!.enderecoCobranca,undefined);
    responder=null;
  });
  await t.test("reconcilia envio inconclusivo antigo por ID sem POST nem nova coleta",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    contas.get(a)!.set("10",contato(10));
    responder=async(r,app)=>app===b&&r.metodo==="GET"&&/\/contatos\/\d+$/.test(new URL(r.url).pathname)
      ?{status:200,dados:{...contas.get(b)!.get(new URL(r.url).pathname.split('/').at(-1)!)!,enderecoCobranca:{endereco:"Outra rua",pais:"Brasil"}}}:undefined;
    await terminar((await enfileirar()).id);
    const op=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(op.status,"RESULTADO_INCONCLUSIVO");assert.ok(op.remoteId);
    responder=async(r,app)=>app===b&&r.metodo==="GET"&&/\/contatos\/\d+$/.test(new URL(r.url).pathname)
      ?{status:200,dados:{...contas.get(b)!.get(new URL(r.url).pathname.split('/').at(-1)!)!,enderecoCobranca:{pais:"Brasil"}}}:undefined;
    const antes=chamadas.length;const e=await enfileirar("APLICAR");assert.equal((await terminar(e.id)).status,"CONCLUIDA");
    const confirmada=await db.olistSyncOperacao.findUniqueOrThrow({where:{id:op.id}});
    assert.equal(confirmada.status,"CONFIRMADA");assert.equal(confirmada.remoteId,op.remoteId);assert.equal(escritas().length,1);
    assert.equal(chamadas.slice(antes).filter(r=>new URL(r.url).pathname.endsWith('/contatos')).length,0);
    assert.equal(await db.olistSyncPendencia.count({where:{status:"AGUARDANDO_REVISAO"}}),0);
    responder=null;
  });
  await t.test("três confirmações realmente divergentes suspendem novas escritas daquele destino",async()=>{
    await reset();for(let n=1;n<=4;n++)contas.get(a)!.set(String(n),produto(n,`SKU-${n}`,["Azulejo","Martelo","Camiseta","Livro"][n-1]));
    responder=async(r,app)=>app===b&&r.metodo==="GET"&&/\/produtos\/\d+$/.test(new URL(r.url).pathname)
      ?{status:200,dados:{...contas.get(b)!.get(new URL(r.url).pathname.split('/').at(-1)!)!,descricao:"Ref Alteração externa"}}:undefined;
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length,3);assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),1);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,status:"PAUSADA",erroCodigo:"CONFIRMACOES_DIVERGENTES"}}),1);
    assert.equal(await db.olistSyncEvento.count({where:{tipo:"APLICACAO_REQUER_DIAGNOSTICO"}}),1);
    responder=null;
  });
  for(const catalogo of [[],[{id:87,nome:"Cliente",perfilContato:1}],[{id:87,nome:"Cliente",perfilContato:0},{id:88,nome:"cliente",perfilContato:0}]])
  await t.test(`tipo ausente, perfil incompatível ou equivalência ambígua bloqueia antes de escrever (${catalogo.length})`,async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    tipos.set(a,[{id:1,nome:"Cliente",perfilContato:0}]);tipos.set(b,catalogo);
    contas.get(a)!.set("10",contato(10,undefined,[{id:1,descricao:"Cliente"}]));
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length,0);
    assert.equal(await db.olistSyncPendencia.count({where:{tipo:{in:["TIPOS_CONTATO_AMBIGUOS","TIPOS_CONTATO_NAO_MAPEADOS"]}}}),1);
  });
  await t.test("catálogo paginado é retomado sem reler páginas e sem consulta por contato",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    tipos.set(a,Array.from({length:105},(_,i)=>({id:i+1,nome:`Tipo ${i}`,perfilContato:0})));
    for(let i=0;i<5;i++)contas.get(a)!.set(String(10+i),contato(10+i));
    const e=await enfileirar("AUDITAR");await terminar(e.id);
    const paginas=chamadas.filter(r=>new URL(r.url).pathname.endsWith("/contatos/tipos") && r.token===a);
    assert.deepEqual(paginas.map(r=>new URL(r.url).searchParams.get("offset")),["0","100"]);
    assert.equal(await db.olistSyncEstado.count({where:{entidade:"CONTATO",aplicativoId:a}}),5);assert.equal(escritas().length,0);
  });
  await t.test("resposta real com perfilContato textual conclui coleta e aplicação nas duas empresas",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    tipos.set(a,[{id:1,nome:"Cliente",perfilContato:1}]);tipos.set(b,[{id:87,nome:"Cliente",perfilContato:1}]);
    contas.get(a)!.set("10",contato(10,undefined,[{id:1,descricao:"Cliente"}]));
    responder=async(r,app)=>new URL(r.url).pathname.endsWith("/contatos/tipos")
      ?{status:200,dados:{itens:(tipos.get(app)??[]).map(tipo=>({...tipo,perfilContato:String(tipo.perfilContato)})),paginacao:{total:1,offset:0,limit:100}}}:undefined;
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA");
    assert.equal(escritas().length,1);assert.deepEqual((escritas()[0].payload as CamposSync).tipos,[87]);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,status:"FALHOU"}}),0);
    assert.equal(await db.olistSyncCobertura.count({where:{configuracaoId:config.id,entidade:"CONTATO",completaEm:{not:null}}}),2);
  });
  await t.test("mudança do catálogo de destino após auditoria bloqueia a proposta antes do POST",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    tipos.set(a,[{id:1,nome:"Cliente",perfilContato:0}]);tipos.set(b,[{id:87,nome:"Cliente",perfilContato:0}]);
    contas.get(a)!.set("10",contato(10,undefined,[{id:1,descricao:"Cliente"}]));
    const audit=await enfileirar("AUDITAR");await terminar(audit.id);
    tipos.set(b,[{id:87,nome:"Fornecedor",perfilContato:0}]);
    const e=await enfileirar("APLICAR");await terminar(e.id);
    assert.equal(escritas().length,0);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"OBSOLETA",erroCodigo:"TIPOS_CONTATO_NAO_MAPEADOS"}}),1);
  });
  await t.test("proposta de contato do contrato antigo não é enviada sem reauditoria",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    contas.get(a)!.set("10",contato(10));const audit=await enfileirar("AUDITAR");await terminar(audit.id);
    const operacao=await db.olistSyncOperacao.findFirstOrThrow();
    const plano=operacao.precondicoesJson as Record<string,unknown>;delete plano.versaoObservacaoContato;
    await db.olistSyncOperacao.update({where:{id:operacao.id},data:{precondicoesJson:plano as Prisma.InputJsonObject}});
    const e=await enfileirar("APLICAR");await terminar(e.id);assert.equal(escritas().length,0);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}})).erroCodigo,"CONTRATO_CONTATO_DESATUALIZADO");
  });
  await t.test("429 no catálogo preserva a página, respeita Retry-After e retoma sem escrever",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    const e=await enfileirar("AUDITAR");
    responder=async(r,app)=>app===a&&new URL(r.url).pathname.endsWith("/contatos/tipos")?{status:429,dados:{},retryAfter:"180",cotaLeitura:{limite:60,restante:0,resetSegundos:60}}:undefined;
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId:e.id,erroCodigo:"OLIST_429"}})>0,"429 do catálogo persistido");
    const participante=await db.olistSyncParticipante.findUniqueOrThrow({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:a}}});
    assert.ok(participante.proximaChamadaEm!.getTime()>=agora+180_000);
    responder=null;agora+=180_001;await terminar(e.id);
    const paginas=chamadas.filter(r=>r.token===a&&new URL(r.url).pathname.endsWith("/contatos/tipos"));
    assert.deepEqual(paginas.map(r=>new URL(r.url).searchParams.get("offset")),["0","0"]);assert.equal(escritas().length,0);
  });
  await t.test("catálogo com ID repetido entre páginas falha sem confirmar cobertura ou escrever",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    tipos.set(a,Array.from({length:101},(_,i)=>({id:i===100?1:i+1,nome:`Tipo ${i}`,perfilContato:0})));
    const e=await enfileirar();await terminar(e.id);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,erroCodigo:"CATALOGO_TIPOS_INCONSISTENTE",status:"FALHOU"}}),1);
    assert.equal(await db.olistSyncCobertura.count({where:{configuracaoId:config.id,aplicativoId:a,completaEm:{not:null}}}),0);
    assert.equal(escritas().length,0);
  });
  await t.test("lotes de uma alteração continuam na mesma execução sem reler ou pedir revisão humana",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{limiteAlteracoes:1}});
    contas.get(a)!.set("10",produto(10,"ABC-1","Ref Toalha azul"));contas.get(a)!.set("11",produto(11,"XYZ-9","Ref Caixa madeira"));
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA");
    assert.equal(escritas().length,2);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),0);
    assert.equal(await db.olistSyncPendencia.count({where:{status:"AGUARDANDO_REVISAO"}}),0);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),2);
    assert.equal(await db.olistSyncExecucao.count(),1);
    assert.equal(chamadas.filter(r=>r.metodo==="GET"&&new URL(r.url).pathname.endsWith('/produtos')&&!new URL(r.url).searchParams.has('codigo')).length,2);
    assert.equal(await db.olistSyncEvento.count({where:{tipo:"LOTE_APLICACAO_CONCLUIDO"}}),1);
  });
  await t.test("limite do lote persiste entre reservas e revogação na pausa impede a próxima escrita",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{limiteAlteracoes:1}});
    contas.get(a)!.set("10",produto(10,"ABC-1","Azulejo"));contas.get(a)!.set("11",produto(11,"XYZ-9","Martelo"));
    const e=await enfileirar();
    await avancarAte(async()=>await db.olistSyncEvento.count({where:{execucaoId:e.id,tipo:"LOTE_APLICACAO_CONCLUIDO"}})>0,"próximo lote persistido");
    const etapa=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:b,fase:"APLICAR"}});
    assert.equal(escritas().length,1);assert.equal((etapa.cursorJson as CamposSync).loteConsumidas,0);
    assert.ok(etapa.disponivelEm.getTime()>=agora+5_000);assert.equal(etapa.status,"PENDENTE");
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).finalizadaEm,null);
    const chamadasAntes=chamadas.length;
    await db.usuario.update({where:{id:usuario},data:{ativo:false},select:{id:true}});
    await terminar(e.id);assert.equal(escritas().length,1);assert.equal(chamadas.length,chamadasAntes);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),1);
  });
  await t.test("429 consome orçamento do lote e continua com pré-condições renovadas sem duplicar",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{limiteAlteracoes:1}});
    contas.get(a)!.set("10",produto(10));post429=true;
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA");
    assert.equal(escritas().length,2);assert.equal(contas.get(b)!.size,1);
    const op=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(op.status,"CONFIRMADA");assert.equal(op.tentativas,2);
    assert.equal(await db.olistSyncEvento.count({where:{tipo:"LOTE_APLICACAO_CONCLUIDO"}}),1);
  });
  await t.test("propostas antigas bloqueadas só por volume são reavaliadas e continuam sem aprovação manual",async()=>{
    await reset();await db.olistSyncConfiguracao.update({where:{id:config.id},data:{limiteAlteracoes:1}});
    contas.get(a)!.set("10",produto(10,"ABC-1","Ref Toalha azul"));contas.get(a)!.set("11",produto(11,"XYZ-9","Ref Caixa madeira"));
    const audit=await enfileirar("AUDITAR");await terminar(audit.id);
    await db.olistSyncOperacao.updateMany({where:{status:"AUTORIZADA"},data:{status:"PROPOSTA",erroCodigo:"LIMITE_ALTERACOES"}});
    await db.olistSyncPendencia.create({data:{configuracaoId:config.id,aplicativoId:b,entidade:"PRODUTO",tipo:"LIMITE_ALTERACOES",severidade:"ALTA",chaveDedupe:"limite-legado"}});
    const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,2);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),0);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"PROPOSTA"}}),0);
    assert.equal(await db.olistSyncPendencia.count({where:{status:"AGUARDANDO_REVISAO"}}),0);
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
    assert.equal(escritas().length,1);assert.ok(resultado.etapas>10);assert.ok(esperas.length>1);assert.ok(esperas.includes(2_500));
    assert.ok(esperas.every(ms=>ms>0&&ms<=12_000));
    for(const app of [a,b]) {
      const conta=horarios.filter(h=>h.app===app);
      for(let i=1;i<conta.length;i++)assert.ok(conta[i].quando-conta[i-1].quando>=(conta[i-1].metodo==="GET"?2_000:2_500),"Preserva o intervalo da conta entre consultas/escritas.");
    }
  });
  await t.test("aplicação com headers processa fila existente em cadência controlada sem relistar",async()=>{
    await reset();
    await db.olistSyncConfiguracao.update({where:{id:config.id},data:{entidades:["CONTATO"]}});
    for(let i=0;i<40;i++){
      let cpf=String(100000000+i);
      for(const peso of [10,11]){
        const resto=[...cpf].reduce((s,d,indice)=>s+Number(d)*(peso-indice),0)*10%11;
        cpf+=resto===10?0:resto;
      }
      contas.get(a)!.set(String(10+i),contato(10+i,cpf));
    }
    await terminar((await enfileirar("AUDITAR")).id,400);
    assert.equal(await db.olistSyncOperacao.count({where:{status:"AUTORIZADA"}}),40);
    chamadas.length=0;
    const cotas=new Map<string,{janela:number;consumidas:number}>();
    let limitesExcedidos=0;
    const rapido=criarClienteSync({...transporte,http:async r=>{
      const chave=`${r.token}:${r.metodo==="GET"?"leitura":"escrita"}`,janela=Math.floor(agora/60_000);
      const cota=cotas.get(chave)?.janela===janela?cotas.get(chave)!:{janela,consumidas:0};
      cota.consumidas++;cotas.set(chave,cota);
      const headers={limite:60,restante:Math.max(0,60-cota.consumidas),resetSegundos:(60_000-agora%60_000)/1_000};
      if(cota.consumidas>60){limitesExcedidos++;return {status:429,dados:{},retryAfter:headers.resetSegundos,cotaLeitura:headers};}
      return {...await transporte.http(r),cotaLeitura:headers};
    }});
    const consumidor=criarServicoOlistSync(db,rapido,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{agora+=ms;}});
    const e=await enfileirar("APLICAR"),inicio=agora;
    for(let i=0;i<5;i++){
      await consumidor.executar(agora+240_000);
      if((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).finalizadaEm)break;
    }
    assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),40);
    assert.equal(escritas().length,40);assert.equal(contas.get(b)!.size,40);assert.equal(limitesExcedidos,0);
    assert.ok(!chamadas.some(r=>r.metodo==="GET"&&new URL(r.url).pathname.endsWith("/contatos")&&!new URL(r.url).searchParams.has("cpfCnpj")));
    const infos=chamadas.filter(r=>r.url.endsWith("/info")).length;
    assert.ok(infos<100,`Cache deve reduzir /info: ${infos}`);
    const porMinuto=40*60_000/(agora-inicio);
    assert.ok(porMinuto>=8,`Ritmo simulado abaixo da meta: ${porMinuto}`);
    t.diagnostic(`40 criações confirmadas em ${agora-inicio}ms virtuais; ${porMinuto.toFixed(2)}/min; ${chamadas.length} HTTP; ${infos} identidades`);
  });
  await t.test("cota de identidade esgotada adia escrita sem marcar envio e retoma a mesma operação",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    const reserva=await reservarEscrita(e.id);let limitada=false;
    responder=async(r,app)=>{
      if(!limitada&&app===b&&r.url.endsWith("/info")){
        limitada=true;return {status:200,dados:{cpfCnpj:docs.get(b),razaoSocial:"Conta"},cotaLeitura:{limite:60,restante:0,resetSegundos:180}};
      }
      return undefined;
    };
    await servico.processar(reserva);
    const op=await db.olistSyncOperacao.findFirstOrThrow();
    assert.equal(op.status,"AUTORIZADA");assert.equal(op.tentativas,0);assert.equal(escritas().length,0);
    const etapa=await db.olistSyncEtapa.findUniqueOrThrow({where:{id:reserva.id}});
    assert.equal(etapa.status,"PENDENTE");assert.ok(etapa.disponivelEm.getTime()>=agora+180_000);
    assert.equal((etapa.cursorJson as CamposSync).fase,"FONTES");
    assert.equal((etapa.cursorJson as CamposSync).iniciadaEm,undefined);
    responder=null;agora+=181_000;await terminar(e.id);
    assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:op.id}})).status,"CONFIRMADA");
    assert.equal(escritas().length,1);
  });
  for(const fase of ["CONTAS","FONTES","DESTINO","ESCREVER","VERIFICAR"]){
    await t.test(`consumidor novo retoma checkpoint legado em ${fase} sem relistar nem duplicar`,async()=>{
      await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();
      if(fase==="VERIFICAR")await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId:e.id,status:"VERIFICANDO"}})>0,"envio já registrado");
      else await aguardarEscrita(e.id);
      const etapa=await db.olistSyncEtapa.findFirstOrThrow({where:{execucaoId:e.id,aplicativoId:b,fase:"APLICAR"}});
      const operacao=await db.olistSyncOperacao.findFirstOrThrow({where:{execucaoId:e.id}});
      const cursor:CamposSync={...(etapa.cursorJson as CamposSync),operacaoId:operacao.id,fase,indice:0,loteConsumidas:36};
      if(["CONTAS","FONTES"].includes(fase))delete cursor.iniciadaEm;
      await db.olistSyncEtapa.update({where:{id:etapa.id},data:{cursorJson:cursor,disponivelEm:new Date(agora)}});
      await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:b}},data:{proximaChamadaEm:new Date(agora+18_000)}});
      const antes=chamadas.length,novo=criarServicoOlistSync(db,criarClienteSync(transporte),{cripto,agora:()=>new Date(agora),aguardar:async ms=>{agora+=ms;}});
      for(let i=0;i<5;i++){
        await novo.executar(agora+240_000);
        if((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).finalizadaEm)break;
        agora+=20_000;
      }
      assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA");
      assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({where:{id:operacao.id}})).status,"CONFIRMADA");
      assert.equal(await db.olistSyncExecucao.count(),1);assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
      assert.ok(!chamadas.slice(antes).some(r=>r.metodo==="GET"&&new URL(r.url).pathname.endsWith("/produtos")&&!new URL(r.url).searchParams.has("codigo")));
    });
  }
  await t.test("consumidor novo respeita reserva anterior e confirma seu efeito sem reenviar",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    const anterior=await reservarEscrita(e.id),antes=chamadas.length;
    const novo=criarServicoOlistSync(db,criarClienteSync(transporte),{cripto,agora:()=>new Date(agora),aguardar:async ms=>{agora+=ms;}});
    await novo.executar(agora+240_000);
    assert.equal(chamadas.length,antes);assert.equal(escritas().length,0);
    assert.equal((await db.olistSyncEtapa.findUniqueOrThrow({where:{id:anterior.id}})).leaseToken,anterior.leaseToken);
    await servico.processar(anterior);assert.equal(escritas().length,1);
    await novo.executar(agora+240_000);
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA");
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,1);
  });
  await t.test("janela vence durante consulta real e a mesma invocação retoma o processamento",async()=>{
    await reset();await enfileirar("AUDITAR");
    await db.olistSyncEtapa.updateMany({data:{disponivelEm:new Date(agora+50)}});
    let atrasou=false;
    const instrumentado=db.$extends({query:{async $queryRaw({args,query}) {
      const resultado=await query(args);
      if(!atrasou && JSON.stringify(args).includes("SELECT c.id FROM olist_sync_configuracao")) {
        atrasou=true;agora+=100;
      }
      return resultado;
    }}});
    const consumidor=criarServicoOlistSync(instrumentado as unknown as PrismaClient,cliente,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{agora+=ms;}});
    const resultado=await consumidor.executar(agora+240_000);
    assert.equal(atrasou,true);
    assert.ok(resultado.etapas>0,"A janela pronta deve ser consumida na mesma invocação");
    assert.ok(chamadas.length>0);
  });
  await t.test("processar carrega dados do handler uma única vez sem repetir a leitura no despacho",async()=>{
    await reset();await enfileirar("AUDITAR");
    const reserva=await repo.reservarEtapa({agora:new Date(agora)});assert.ok(reserva);
    let leituras=0;
    const instrumentado=db.$extends({query:{olistSyncEtapa:{async findUniqueOrThrow({args,query}) {
      if(args.select?.leaseAte && args.select.execucao)leituras++;
      return query(args);
    }}}});
    const consumidor=criarServicoOlistSync(instrumentado as unknown as PrismaClient,cliente,{cripto,agora:()=>new Date(agora),aguardar:async ms=>{agora+=ms;}});
    await consumidor.processar(reserva);
    assert.equal(leituras,1);
    assert.equal(chamadas.length,1);
    assert.ok(chamadas[0].url.endsWith("/info"));
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
  await t.test("páginas inteiras sem Ref são ignoradas sem perder cobertura nem gravar dados",async()=>{
    await reset();
    for(let id=1;id<=101;id++)contas.get(a)!.set(String(id),{id,descricao:"Reforma",sku:`IGN-${id}`,tipo:"S",dimensoes:"inválido"});
    contas.get(a)!.set("200",produto(200,"VALIDO"));
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA");
    assert.equal(await db.olistSyncRegistro.count(),1);assert.equal(await db.olistSyncEstado.count(),2);assert.equal(await db.olistSyncPendencia.count(),0);
    assert.equal(chamadas.filter(r=>r.metodo==="GET"&&/\/produtos\/(?:[1-9]|[1-9]\d|10[01])$/.test(new URL(r.url).pathname)).length,0);
    assert.equal(contas.get(b)!.size,1);
  });

  await t.test("produto renomeado sem Ref sai do banco local e revoga proposta antiga",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar("AUDITAR")).id);
    assert.equal(await db.olistSyncOperacao.count(),1);
    contas.get(a)!.get("10")!.descricao="Sem marcação";
    await terminar((await enfileirar("AUDITAR")).id);
    assert.deepEqual(await Promise.all([db.olistSyncRegistro.count(),db.olistSyncEstado.count(),db.olistSyncPendencia.count(),db.olistSyncOperacao.count()]),[0,0,0,0]);
    assert.equal(escritas().length,0);assert.ok(contas.get(a)!.has("10"));
  });

  await t.test("coleta completa remove legado sem Ref já ausente da API e preserva Ref Unicode",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar("AUDITAR")).id);
    contas.get(a)!.clear();
    await db.olistSyncEstado.updateMany({data:{nome:"Cadastro ignorado antigo",presente:false,detalhePendente:false}});
    contas.get(a)!.set("30",{...produto(30,"UNICODE"),descricao:"Ｒｅｆ 30"});
    await terminar((await enfileirar("AUDITAR")).id);
    assert.equal(await db.olistSyncRegistro.count({where:{chave:"001-A"}}),0);
    assert.equal(await db.olistSyncEstado.count({where:{remoteId:"10"}}),0);
    assert.equal(await db.olistSyncRegistro.count({where:{chave:"UNICODE"}}),1);
    await terminar((await enfileirar("AUDITAR")).id);
    assert.equal(await db.olistSyncRegistro.count({where:{chave:"UNICODE"}}),1);assert.equal(escritas().length,0);
  });

  function fabricado(id:number, componente:CamposSync, quantidade=1):CamposSync {
    return {...produto(id,"FAB-01","Ref Lenço"),tipo:"F",producao:{produtos:[{produto:{id:componente.id,sku:componente.sku,descricao:componente.descricao},quantidade}],etapas:["Cortar","Costurar"]}};
  }
  function prepararFabricados() {
    const mpA:CamposSync={...produto(11,"MP-01","Ref Tecido"),tipo:"M"},mpB:CamposSync={...produto(21,"MP-01","Ref Tecido"),tipo:"M"};
    contas.get(a)!.set("11",mpA);contas.get(b)!.set("21",mpB);
    contas.get(a)!.set("10",fabricado(10,mpA));contas.get(b)!.set("20",fabricado(20,mpB));
    return {mpA,mpB};
  }

  await t.test("simples, matéria-prima e fabricado são criados com IDs locais na composição",async()=>{
    await reset();const {mpA}=prepararFabricados();contas.get(b)!.clear();contas.get(a)!.set("12",produto(12,"SIMPLES","Ref Avulso"));
    const e=await enfileirar();assert.equal((await terminar(e.id,400)).status,"CONCLUIDA",JSON.stringify({ops:await db.olistSyncOperacao.findMany({select:{acao:true,status:true,erroCodigo:true}}),pendencias:await db.olistSyncPendencia.findMany({select:{tipo:true}})}));
    assert.equal(contas.get(b)!.size,3);
    const post=escritas().find(r=>(r.payload as CamposSync).tipo==="F");assert.ok(post);
    const estrutura=(post.payload as {producao:{produtos:Array<{produto:{id:number};quantidade:number}>}}).producao;
    const destino=[...contas.get(b)!.values()].find(p=>p.sku===mpA.sku)!;
    assert.equal(estrutura.produtos[0].produto.id,destino.id);assert.notEqual(destino.id,mpA.id);
    const segunda=await enfileirar();await terminar(segunda.id);assert.equal(escritas().length,3);
  });

  for(const cadastro of [false,true])await t.test(`fabricado atualiza composição${cadastro?" e cadastro com confirmações separadas":" pelo endpoint específico"}`,async()=>{
    await reset();const {mpA}=prepararFabricados();await terminar((await enfileirar()).id);assert.equal(escritas().length,0);
    const novo=fabricado(10,mpA,2.5);if(cadastro)novo.descricao="Ref Lenço novo";
    contas.get(a)!.set("10",novo);const e=await enfileirar();assert.equal((await terminar(e.id,400)).status,"CONCLUIDA",JSON.stringify({ops:await db.olistSyncOperacao.findMany({select:{acao:true,status:true,erroCodigo:true}}),pendencias:await db.olistSyncPendencia.findMany({select:{tipo:true}})}));
    const puts=escritas();assert.equal(puts.length,cadastro?2:1);assert.ok(puts.at(-1)!.url.endsWith("/produtos/20/fabricado"));
    assert.deepEqual(puts.at(-1)!.payload,{produtos:[{produto:{id:21,tipo:"P"},quantidade:2.5}],etapas:["Cortar","Costurar"]});
    if(cadastro)assert.equal(contas.get(b)!.get("20")!.descricao,"Ref Lenço novo");
    assert.equal(await db.olistSyncOperacao.count({where:{status:{not:"CONFIRMADA"}}}),0);
    const antes=escritas().length;await terminar((await enfileirar()).id);assert.equal(escritas().length,antes);
  });

  await t.test("componente sem Ref bloqueia fabricação sem gravar seu cadastro ou estrutura parcial",async()=>{
    await reset();const mp={...produto(11,"IGNORADO"),descricao:"Tecido sem marcação",tipo:"M"};
    contas.get(a)!.set("11",mp);contas.get(a)!.set("10",fabricado(10,mp));
    const e=await enfileirar();assert.equal((await terminar(e.id)).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length,0);assert.equal(await db.olistSyncEstado.count(),1);
    assert.equal(await db.olistSyncRegistro.count({where:{chave:"IGNORADO"}}),0);
    const estado=await db.olistSyncEstado.findFirstOrThrow();
    const observado=cripto.decifrar(estado.dadosCriptografados!,`${config.id}:estado:${a}:PRODUTO:10`);
    assert.equal(JSON.stringify(observado).includes("IGNORADO"),false);
    assert.equal((await db.olistSyncPendencia.findFirstOrThrow()).tipo,"COMPONENTE_FORA_ESCOPO");
  });

  await t.test("SKU existente no destino sem Ref impede criação duplicada",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));contas.get(b)!.set("20",{...produto(20),descricao:"Produto sem marcação"});
    const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,0);assert.equal(contas.get(b)!.size,1);
    assert.equal(await db.olistSyncEstado.count({where:{aplicativoId:b}}),0);
  });

  await t.test("fonte que perde Ref depois da auditoria não escapa por proposta autorizada",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));const e=await enfileirar();await aguardarEscrita(e.id);
    contas.get(a)!.get("10")!.descricao="Sem marcação";
    // O cursor volta à leitura da fonte, como na retomada após espera de cota.
    await db.olistSyncEtapa.updateMany({where:{execucaoId:e.id,fase:"APLICAR"},data:{cursorJson:{}}});
    await terminar(e.id);assert.equal(escritas().length,0);assert.equal(await db.olistSyncEstado.count(),0);assert.equal(await db.olistSyncRegistro.count(),0);
  });

  await t.test("POST de fabricado com resposta perdida é reconciliado sem nova criação",async()=>{
    await reset();prepararFabricados();contas.get(b)!.delete("20");
    interceptar=async r=>{if(r.metodo==="POST"&&(r.payload as CamposSync)?.tipo==="F")postIncerto=true;};
    const e=await enfileirar();assert.equal((await terminar(e.id,400)).status,"CONCLUIDA");
    assert.equal(escritas().length,1);assert.equal(contas.get(b)!.size,2);assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status,"CONFIRMADA");
  });

  for(const etapa of ["CADASTRO","FABRICADO"])await t.test(`resposta perdida em ${etapa} confirma etapas do fabricado sem repetir PUT`,async()=>{
    await reset();const {mpA,mpB}=prepararFabricados();await terminar((await enfileirar()).id);
    contas.get(a)!.set("10",{...fabricado(10,mpA,3),descricao:"Ref Lenço novo"});let perdeu=false;
    responder=async(r,app)=>{
      if(app!==b||r.metodo!=="PUT"||perdeu)return undefined;
      const composicao=r.url.endsWith("/fabricado");if(composicao!==(etapa==="FABRICADO"))return undefined;
      perdeu=true;
      contas.get(b)!.set("20",composicao?{...fabricado(20,mpB,3),descricao:"Ref Lenço novo"}:{...contas.get(b)!.get("20"),...r.payload as CamposSync});
      throw new Error("Resposta perdida após commit remoto simulado");
    };
    const e=await enfileirar();assert.equal((await terminar(e.id,400)).status,"CONCLUIDA");
    assert.ok(perdeu);assert.equal(escritas().length,2);assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),1);
    assert.equal(escritas().filter(r=>r.url.endsWith("/fabricado")).length,1);
  });

  await t.test("fabricados em três empresas aceitam avanços intermediários da mesma revisão",async()=>{
    await reset();const {mpA}=prepararFabricados();
    await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:terceiro}},data:{habilitado:true}});
    const mpC:CamposSync={...produto(31,"MP-01","Ref Tecido"),tipo:"M"};
    contas.get(terceiro)!.set("31",mpC);contas.get(terceiro)!.set("30",fabricado(30,mpC));
    await terminar((await enfileirar()).id);
    contas.get(a)!.set("10",{...fabricado(10,mpA,4),descricao:"Ref Lenço novo"});
    const e=await enfileirar();
    await avancarAte(async()=>await db.olistSyncOperacao.count({where:{execucaoId:e.id}})===2,"propostas de fabricação");
    await adiarDestino(e.id,terceiro);await aguardarConfirmacao(e.id,b);await liberarDestino(e.id,terceiro);
    assert.equal((await terminar(e.id,400)).status,"CONCLUIDA");
    assert.equal(escritas().length,4);assert.equal(await db.olistSyncOperacao.count({where:{status:"CONFIRMADA"}}),2);
    assert.equal(contas.get(terceiro)!.get("30")!.descricao,"Ref Lenço novo");
  });
  for(const status of ["EM_APLICACAO","VERIFICANDO","RESULTADO_INCONCLUSIVO"])await t.test(`descarte de uma réplica preserva ${status} de outra empresa`,async()=>{
    await reset();
    await db.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:terceiro}},data:{habilitado:true}});
    for(const [app,id] of [[a,10],[b,20],[terceiro,30]] as const)contas.get(app)!.set(String(id),produto(id));
    await terminar((await enfileirar("AUDITAR")).id);
    contas.get(b)!.get("20")!.descricao="Ref mudança da empresa B";
    await terminar((await enfileirar("AUDITAR")).id);
    const op=await db.olistSyncOperacao.findFirstOrThrow({where:{destinoAppId:terceiro,status:"AUTORIZADA"}});
    await db.olistSyncOperacao.update({where:{id:op.id},data:{status,remoteId:"30"}});
    const pendente=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,registroId:op.registroId,aplicativoId:terceiro,execucaoId:op.execucaoId,entidade:"PRODUTO",tipo:"RESULTADO_INCONCLUSIVO",severidade:"ALTA",chaveDedupe:randomUUID()}});
    contas.get(a)!.get("10")!.descricao="Cadastro sem marcação";
    await terminar((await enfileirar("AUDITAR")).id);
    assert.equal(await db.olistSyncOperacao.count({where:{id:op.id,status}}),1);
    assert.equal(await db.olistSyncPendencia.count({where:{id:pendente.id,status:"AGUARDANDO_REVISAO"}}),1);
    assert.ok(contas.get(terceiro)!.get("30")!.descricao!.toString().includes("Ref"));
    assert.equal(escritas().length,0);
  });
  await t.test("limpeza de legado confirma nome atual e preserva origem declarada",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar("AUDITAR")).id);
    const reg=await db.olistSyncRegistro.findFirstOrThrow();
    await db.olistSyncRegistro.update({where:{id:reg.id},data:{nome:"Nome antigo sem marcação",origemTipo:"DECLARADA_POR_USUARIO",origemMotivo:"Origem histórica confirmada pelo responsável",origemRegistradaPor:usuario}});
    await db.olistSyncEstado.updateMany({data:{nome:"Nome antigo sem marcação"}});
    await terminar((await enfileirar("AUDITAR")).id);
    const novo=await db.olistSyncRegistro.findFirstOrThrow({where:{chave:reg.chave}});
    assert.equal(novo.id,reg.id);assert.equal(novo.origemTipo,"DECLARADA_POR_USUARIO");
    assert.equal(escritas().length,0);
  });
  await t.test("duplicidade de produto ignorado entre páginas não certifica cobertura",async()=>{
    await reset();
    contas.get(a)!.set("500",produto(500,"OCULTO","Ref produto real"));
    contas.get(b)!.set("600",produto(600,"OCULTO","Ref produto real"));
    responder=async(r,app)=>{
      const u=new URL(r.url);
      if(app!==a||r.metodo!=="GET"||!u.pathname.endsWith("/produtos")||u.searchParams.has("codigo"))return undefined;
      const offset=Number(u.searchParams.get("offset"));
      const itens=offset===0?Array.from({length:100},(_,i)=>({id:i+1,sku:`IGN-${i}`,descricao:"Reforma",tipo:"S",situacao:"A"})):[{id:1,sku:"IGN-0",descricao:"Reforma",tipo:"S",situacao:"A"}];
      return {status:200,dados:{itens,paginacao:{total:101,offset,limit:100}}};
    };
    const e=await enfileirar();const resultado=await terminar(e.id,300);
    assert.equal(resultado.status,"CONCLUIDA_COM_PENDENCIAS");
    const reg=await db.olistSyncRegistro.findFirstOrThrow({where:{chave:"OCULTO"}});
    assert.equal(reg.aplicativoOrigemId,null);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,aplicativoId:a,erroCodigo:"COBERTURA_INCOMPLETA",status:"FALHOU"}}),1);
    assert.equal(await db.olistSyncReciboPagina.count(),0);assert.equal(escritas().length,0);

  });

  await t.test("falha de leitura do legado não apaga registros nem origem declarada",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar("AUDITAR")).id);
    const reg=await db.olistSyncRegistro.findFirstOrThrow();
    await db.olistSyncRegistro.update({where:{id:reg.id},data:{origemTipo:"DECLARADA_POR_USUARIO",origemRegistradaPor:usuario,origemMotivo:"Histórico confirmado"}});
    await db.olistSyncEstado.updateMany({data:{nome:"Nome antigo"}});
    responder=async(r,app)=>app===a&&r.metodo==="GET"&&r.url.endsWith("/produtos/10")?{status:503,dados:{}}:undefined;
    const e=await enfileirar("AUDITAR");assert.equal((await terminar(e.id,300)).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal((await db.olistSyncRegistro.findUniqueOrThrow({where:{id:reg.id}})).origemTipo,"DECLARADA_POR_USUARIO");
    assert.equal(await db.olistSyncEstado.count(),1);assert.equal(escritas().length,0);
  });

  await t.test("recibos são opacos, isolados por etapa e retomáveis sem guardar produtos ignorados",async()=>{
    await reset();
    for(let id=1;id<=101;id++)contas.get(a)!.set(String(id),{id,sku:`IGN-${id}`,descricao:"Sem marcação",tipo:"S",situacao:"A"});
    const e=await enfileirar("AUDITAR");
    await avancarAte(async()=>await db.olistSyncReciboPagina.count()===100,"recibos da primeira página");
    assert.equal(await db.olistSyncEstado.count(),0);assert.equal(await db.olistSyncRegistro.count(),0);
    const recibos=await db.olistSyncReciboPagina.findMany({take:101});
    assert.equal(recibos.length,100);
    for(const recibo of recibos) {
      assert.match(recibo.digest,/^[a-f0-9]{64}$/);
      assert.deepEqual(Object.keys(recibo).sort(),["digest","etapaId"]);
    }
    assert.notEqual(cripto.hash("1",`${config.id}:pagina:${recibos[0].etapaId}`),cripto.hash("1",`${config.id}:pagina:${randomUUID()}`));
    const reiniciado=criarServicoOlistSync(db,cliente,{agora:()=>new Date(agora),cripto,aguardar:async ms=>{agora+=ms;}});
    for(let i=0;i<30;i++) {
      agora+=6_001;const reserva=await repo.reservarEtapa({agora:new Date(agora)});if(reserva)await reiniciado.processar(reserva);
      const atual=await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}});if(atual.status==="CONCLUIDA")break;
    }
    assert.equal((await db.olistSyncExecucao.findUniqueOrThrow({where:{id:e.id}})).status,"CONCLUIDA");
    assert.equal(await db.olistSyncReciboPagina.count(),0);
    const seguranca=await sql.query("SELECT relrowsecurity,has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'INSERT') AS authenticated FROM pg_class WHERE oid='olist_sync_recibo_pagina'::regclass");
    assert.deepEqual(seguranca.rows[0],{relrowsecurity:true,anon:false,authenticated:false});
  });
  await t.test("404 da identidade durante revisão do legado não equivale a produto removido",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));await terminar((await enfileirar("AUDITAR")).id);
    const reg=await db.olistSyncRegistro.findFirstOrThrow();await db.olistSyncEstado.updateMany({data:{nome:"Nome antigo"}});
    const e=await enfileirar("AUDITAR");
    await avancarAte(async()=>await db.olistSyncEtapa.count({where:{execucaoId:e.id,aplicativoId:a,cursorJson:{path:["identidadeVerificada"],equals:true}}})>0,"identidade inicial verificada");
    responder=async(r,app)=>app===a&&r.url.endsWith("/info")?{status:404,dados:{}}:undefined;
    assert.equal((await terminar(e.id)).status,"CONCLUIDA_COM_PENDENCIAS");
    assert.equal(await db.olistSyncRegistro.count({where:{id:reg.id}}),1);assert.equal(await db.olistSyncEstado.count(),1);assert.equal(escritas().length,0);
  });

  await t.test("limite de coleta é validado antes de registrar produtos ou recibos",async()=>{
    await reset();
    responder=async(r,app)=>app===a&&r.metodo==="GET"&&new URL(r.url).pathname.endsWith("/produtos")
      ?{status:200,dados:{itens:[produto(10)],paginacao:{total:100_001}}}:undefined;
    const e=await enfileirar();await terminar(e.id);
    assert.equal(await db.olistSyncEtapa.count({where:{execucaoId:e.id,aplicativoId:a,erroCodigo:"LIMITE_COLETA_PRODUTOS"}}),1);
    assert.equal(await db.olistSyncReciboPagina.count(),0);assert.equal(await db.olistSyncEstado.count(),0);assert.equal(escritas().length,0);
  });

  await t.test("destino que perde Ref após POST incerto mantém apuração e não é recriado",async()=>{
    await reset();contas.get(a)!.set("10",produto(10));postIncerto=true;
    interceptar=async(r,app)=>{
      if(app===b&&r.metodo==="GET"&&/\/produtos\/\d+$/.test(new URL(r.url).pathname)) {
        const id=new URL(r.url).pathname.split("/").at(-1)!;
        if(contas.get(b)!.has(id))contas.get(b)!.get(id)!.descricao="Sem marcação";
      }
    };
    const e=await enfileirar();await terminar(e.id);
    assert.equal(escritas().length,1);assert.equal(await db.olistSyncEstado.count({where:{aplicativoId:b}}),0);
    const op=await db.olistSyncOperacao.findFirstOrThrow();assert.equal(op.status,"RESULTADO_INCONCLUSIVO");
    assert.equal(op.erroCodigo,"PRODUTO_FORA_ESCOPO");
    await terminar((await enfileirar("APLICAR")).id);assert.equal(escritas().length,1);
    assert.equal(await db.olistSyncOperacao.count({where:{id:op.id,status:"RESULTADO_INCONCLUSIVO"}}),1);
  });
});
