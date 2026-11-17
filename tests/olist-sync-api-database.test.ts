import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { criarCriptografiaSync } from "../src/lib/olist-sync/cripto";
import { avaliarReplicas, gerarHashesCampos, observarRegistro } from "../src/lib/olist-sync/dominio";
import { observacaoProtegida } from "../src/lib/olist-sync/validacao";
import type { EntidadeSync } from "../src/lib/olist-sync/contrato";

const url = process.env.OLIST_SYNC_API_TEST_DATABASE_URL;
test("Olist sync API com PostgreSQL real: decisões atômicas, origem e isolamento", { skip: !url }, async t => {
  const endereco = new URL(url!); assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname)); assert.match(endereco.pathname, /^\/olist_sync_test/);
  const sql = new Client({ connectionString: url! }); await sql.connect(); t.after(() => sql.end());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) }); t.after(() => db.$disconnect());
  assert.equal((await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'")).rows[0].total,0);
  await sql.query(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL,jobs text NOT NULL DEFAULT '',aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),ativo boolean NOT NULL DEFAULT true,email text NOT NULL DEFAULT 'teste@example.test',vendedor_olist_id integer,pode_editar_configuracao boolean DEFAULT false,pode_visualizar_olist_formas_pagamento boolean DEFAULT false,pode_visualizar_olist_formas_recebimento boolean DEFAULT false);
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY,pausado boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),termos_ignorados_nome_arquivo text[] DEFAULT '{}',variantes_permitidas text[] DEFAULT '{}');
    CREATE TABLE integracao_olist_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);
  const pai="00000000-0000-0000-0000-000000000002", matriz="00000000-0000-0000-0000-000000000003", a="00000000-0000-0000-0000-000000000004", b="00000000-0000-0000-0000-000000000005", externo="00000000-0000-0000-0000-000000000001";
  await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Pai'),($2,'Externo')",[pai,externo]);
  await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$4),($2,'B',$4),($3,'Matriz',$4)",[a,b,matriz,pai]);
  await sql.query(await readFile(new URL("../prisma/migrations/20261116000100_olist_sync_multiempresa/migration.sql",import.meta.url),"utf8"));
  const usuario=randomUUID(),usuarioFilho=randomUUID();
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_visualizar_sincronizacao_olist,pode_configurar_sincronizacao_olist,pode_executar_sincronizacao_olist,pode_resolver_sincronizacao_olist) VALUES ($1,$2,true,true,true,true),($3,$4,true,true,true,true)",[usuario,pai,usuarioFilho,a]);
  const config=await db.olistSyncConfiguracao.findUniqueOrThrow({where:{aplicativoPaiId:pai}});
  await db.olistSyncConfiguracao.update({where:{id:config.id},data:{ativo:true,autorizadoPor:usuario}});
  await db.configuracaoJob.updateMany({data:{pausado:false}});
  Object.assign(globalThis,{prisma:db});
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://supabase.example.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-not-real";
  process.env.OLIST_SYNC_DATA_KEY=Buffer.alloc(32,1).toString("base64");process.env.OLIST_SYNC_HMAC_KEY=Buffer.alloc(32,2).toString("base64");
  const {supabaseAdmin}=await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth,"getUser",async(token:string)=>({data:{user:{id:token,email:"teste@example.test",email_confirmed_at:"2026-11-16"}},error:null}));
  const api=await import("../src/app/api/olist/sincronizacao/[[...recurso]]/route");
  const contexto=(recurso:string[])=>({params:Promise.resolve({recurso})});
  const req=(metodo:string,recurso:string[],dados?:unknown,token=usuario)=>new Request(`https://example.test/api/olist/sincronizacao/${recurso.join("/")}`,{method:metodo,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},...(dados===undefined?{}:{body:JSON.stringify(dados)})});
  const post=(recurso:string[],dados:unknown,token=usuario)=>api.POST(req("POST",recurso,dados,token),contexto(recurso));
  const pendencia=async(chave:string)=>db.olistSyncPendencia.create({data:{configuracaoId:config.id,entidade:"PRODUTO",tipo:"DIVERGENCIA",severidade:"ALTA",chaveDedupe:chave}});
  await t.test("sessão e aplicativo filho não acessam dados do grupo",async()=>{
    assert.equal((await api.GET(new Request("https://example.test"),contexto(["resumo"]))).status,401);
    assert.equal((await api.GET(req("GET",["resumo"],undefined,usuarioFilho),contexto(["resumo"]))).status,403);
    const response=await api.GET(req("GET",["resumo"]),contexto(["resumo"]));assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
  });
  await t.test("origem declarada pode referenciar matriz excluída e preserva idempotência",async()=>{
    const registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:"PRODUTO",chave:"ORIGEM-API"}});
    const dados={revisao:1,aplicativoOrigemId:matriz,registroOlistOrigemId:"123",motivo:"Origem declarada após conferência manual",idempotencia:randomUUID()};
    const rota=["registros",registro.id,"origem"];
    assert.equal((await post(rota,dados)).status,200);assert.equal((await post(rota,dados)).status,200);
    const atualizado=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});assert.equal(atualizado.origemTipo,"DECLARADA_POR_USUARIO");assert.equal(atualizado.aplicativoOrigemId,matriz);assert.equal(atualizado.revisao,2);
    assert.equal(await db.olistSyncEvento.count({where:{registroId:registro.id,tipo:"ORIGEM_DECLARADA"}}),1);
    assert.equal((await post(rota,{...dados,idempotencia:randomUUID()})).status,409);
    assert.equal((await post(rota,{...dados,revisao:2,aplicativoOrigemId:externo,idempotencia:randomUUID()})).status,400);
  });
  await t.test("configuração rejeita matriz excluída mesmo sendo filha direta",async()=>{
    const rota=["configuracao"];const response=await api.PUT(req("PUT",rota,{versao:1,ativo:true,entidades:["PRODUTO"],participantesIds:[a,b,matriz],horaDiaria:"02:00",limiteAlteracoes:100,prontidao:{sincronizacaoNativaCompativel:false,semanticaPutValidada:false,incrementalValidado:false}}),contexto(rota));assert.equal(response.status,400);
    assert.equal((await db.olistSyncConfiguracao.findUniqueOrThrow({where:{id:config.id}})).versao,1);
  });
  await t.test("configuração mantém a matriz como origem histórica sem oferecê-la como participante", async () => {
    const response = await api.GET(req("GET", ["configuracao"]), contexto(["configuracao"]));
    assert.equal(response.status, 200);
    const body: { aplicativosOrigem: { id: string }[]; aplicativosElegiveis: { id: string }[] } = await response.json();
    assert.ok(body.aplicativosOrigem.some(app => app.id === matriz));
    assert.deepEqual(body.aplicativosElegiveis.map(app => app.id).sort(), [a, b].sort());
    assert.deepEqual((await db.olistSyncConfiguracao.findUniqueOrThrow({ where: { id: config.id } })).aplicativosBloqueados, [matriz]);
  });
  await t.test("reauditoria pausada não resolve pendência nem grava decisão parcial",async()=>{
    const p=await pendencia("REAUDITAR-PAUSADA");await db.configuracaoJob.update({where:{chave:"auditar-sincronizacao-olist"},data:{pausado:true}});
    const response=await post(["pendencias",p.id,"decisao"],{versao:1,acao:"REAUDITAR",motivo:"Conferir novamente os cadastros antes de decidir"});assert.equal(response.status,503);
    const preservada=await db.olistSyncPendencia.findUniqueOrThrow({where:{id:p.id}});assert.equal(preservada.status,"AGUARDANDO_REVISAO");assert.equal(preservada.versao,1);
    assert.equal(await db.olistSyncEvento.count({where:{tipo:"DECISAO_HUMANA",metadadosJson:{path:["pendenciaId"],equals:p.id}}}),0);
    await db.configuracaoJob.update({where:{chave:"auditar-sincronizacao-olist"},data:{pausado:false}});
  });
  await t.test("aprovação exige auditoria completa de todos os participantes",async()=>{
    const c=criarCriptografiaSync(),registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:"PRODUTO",chave:"SEM-AUDITORIA"}});
    const observacao={id:"1",chave:"SEM-AUDITORIA",nome:"Produto simples",situacao:"A",alteradoEm:null,completo:true,campos:{sku:"SEM-AUDITORIA",descricao:"Produto simples",tipo:"S"},pendencias:[]};
    await db.olistSyncEstado.create({data:{configuracaoId:config.id,registroId:registro.id,aplicativoId:a,entidade:"PRODUTO",remoteId:"1",chave:"SEM-AUDITORIA",dadosCriptografados:c.cifrar(observacao,`${config.id}:estado:${a}:PRODUTO:1`)}});
    const p=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,registroId:registro.id,entidade:"PRODUTO",tipo:"DIVERGENCIA",severidade:"ALTA",chaveDedupe:"SEM-AUDITORIA"}});
    const response=await post(["pendencias",p.id,"decisao"],{versao:1,acao:"APROVAR",motivo:"Escolher o cadastro conferido pela equipe",aplicativoFonteId:a});assert.equal(response.status,409);
    assert.equal(await db.olistSyncOperacao.count({where:{registroId:registro.id}}),0);assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:p.id}})).status,"AGUARDANDO_REVISAO");
  });
  await t.test("aprovação concorrente cria uma proposta e não redefine a origem histórica",async()=>{
    const c=criarCriptografiaSync();
    const e=await db.olistSyncExecucao.create({data:{configuracaoId:config.id,chaveIdempotencia:randomUUID(),modo:"AUDITAR",completa:true,versaoConfiguracao:1,status:"CONCLUIDA",finalizadaEm:new Date()}});
    await db.olistSyncEtapa.createMany({data:[a,b].map(aplicativoId=>({execucaoId:e.id,aplicativoId,entidade:"PRODUTO",fase:"DETALHAR",status:"CONCLUIDA"}))});
    const registro=await db.olistSyncRegistro.create({data:{configuracaoId:config.id,entidade:"PRODUTO",chave:"MANUAL-APROVADO",aplicativoOrigemId:b,registroOlistOrigemId:"202",origemTipo:"DECLARADA_POR_USUARIO",origemRegistradaEm:new Date()}});
    for(const app of [a,b]){
      const remoteId=app===a?"201":"202",campos={sku:"MANUAL-APROVADO",tipo:"S",descricao:app===a?"Nome aprovado":"Nome divergente"};
      const obs={id:remoteId,chave:campos.sku,nome:campos.descricao,tipo:"S",situacao:"A",alteradoEm:null,completo:true,campos,pendencias:[]};
      await db.olistSyncEstado.create({data:{configuracaoId:config.id,registroId:registro.id,aplicativoId:app,entidade:"PRODUTO",remoteId,chave:campos.sku,ultimaExecucaoId:e.id,hashesJson:gerarHashesCampos(campos,v=>c.hash(v,`${config.id}:campo`)),dadosCriptografados:c.cifrar(obs,`${config.id}:estado:${app}:PRODUTO:${remoteId}`)}});
    }
    const p=await db.olistSyncPendencia.create({data:{configuracaoId:config.id,registroId:registro.id,execucaoId:e.id,entidade:"PRODUTO",tipo:"CONFLITO_INICIAL",severidade:"ALTA",chaveDedupe:"APROVAR-MANUAL"}});
    const dados={versao:1,acao:"APROVAR",motivo:"Cadastro de origem conferido e aprovado pela equipe",aplicativoFonteId:a};
    const respostas=await Promise.all([post(["pendencias",p.id,"decisao"],dados),post(["pendencias",p.id,"decisao"],dados)]);
    assert.deepEqual(respostas.map(r=>r.status).sort(),[200,409]);
    const ops=await db.olistSyncOperacao.findMany({where:{registroId:registro.id},select:{sourceAppId:true,destinoAppId:true,status:true,acao:true}});
    assert.deepEqual(ops,[{sourceAppId:a,destinoAppId:b,status:"AUTORIZADA",acao:"ATUALIZAR"}]);
    const atual=await db.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id}});assert.equal(atual.aplicativoOrigemId,b);assert.equal(atual.registroOlistOrigemId,"202");assert.equal(atual.origemTipo,"DECLARADA_POR_USUARIO");
  });
  await t.test("reauditoria e decisão são confirmadas na mesma transação e retornam 202",async()=>{
    const p=await pendencia("REAUDITAR-ACEITA");const response=await post(["pendencias",p.id,"decisao"],{versao:1,acao:"REAUDITAR",motivo:"Reavaliar o estado completo após correções"});assert.equal(response.status,202);const body=await response.json();
    assert.ok(await db.olistSyncExecucao.findUnique({where:{id:body.id}}));assert.ok(body.statusUrl.includes(body.id));assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({where:{id:p.id}})).status,"APROVADA");
    assert.equal((await post(["execucoes",body.id,"cancelar"],{})).status,200);
  });

  const cripto = criarCriptografiaSync();
  let proximoIdRemoto = 600;
  const criarIdentidade = async (entidade: EntidadeSync, app: string, nome = "Cadastro equivalente") => {
    const remoteId = String(proximoIdRemoto++);
    const dados = entidade === "FORMA_PAGAMENTO" ? { id: remoteId, nome, situacao: "1" }
      : entidade === "VENDEDOR" ? { id: remoteId, situacao: "B", contato: { nome, cpfCnpj: "" } }
      : { id: remoteId, nome, cpfCnpj: "", tipoPessoa: "F", situacao: "B" };
    const observacao = observarRegistro(entidade, dados, { completo: true });
    const observacaoPersistida = {
      id: observacao.id, chave: observacao.chave, nome: observacao.nome, situacao: observacao.situacao,
      completo: observacao.completo, alteradoEm: observacao.alteradoEm, campos: observacao.campos, pendencias: observacao.pendencias,
      ...(observacao.tipo !== undefined ? { tipo: observacao.tipo } : {}),
      ...(observacao.paiId !== undefined ? { paiId: observacao.paiId } : {}),
    };
    const estado = await db.olistSyncEstado.create({ data: {
      configuracaoId: config.id, aplicativoId: app, entidade, remoteId,
      dadosCriptografados: cripto.cifrar(observacaoPersistida, `${config.id}:estado:${app}:${entidade}:${remoteId}`),
      hashesJson: gerarHashesCampos(observacao.campos, v => cripto.hash(v, `${config.id}:campo`)),
    } });
    const chaveDedupe = cripto.hash(`sem-chave:${app}:${entidade}:${remoteId}`, `${config.id}:pendencia`);
    const p = await db.olistSyncPendencia.create({ data: {
      configuracaoId: config.id, aplicativoId: app, entidade, tipo: "IDENTIDADE_REQUER_REVISAO", severidade: "ALTA", chaveDedupe,
      detalhesCriptografados: cripto.cifrar({ aplicativoId: app, remoteId }, `${config.id}:pendencia:${chaveDedupe}`),
    } });
    return { estado, p, vinculo: { aplicativoId: app, registroOlistId: remoteId } };
  };

  await t.test("regressão P2: filtrar empresa preserva identidades sem registro canônico", async () => {
    const resultados: { entidade: string; propriaEmpresaVisivel: boolean; outraEmpresaOculta: boolean; totalPositivo: boolean }[] = [];
    for (const entidade of ["CONTATO", "FORMA_PAGAMENTO", "VENDEDOR"] as const) {
      const local = await criarIdentidade(entidade, a), outra = await criarIdentidade(entidade, b);
      const caminho = ["pendencias"];
      const response = await api.GET(new Request(`https://example.test/api/olist/sincronizacao/pendencias?aplicativoId=${a}&entidade=${entidade}&limit=100`, { headers: { authorization: `Bearer ${usuario}` } }), contexto(caminho));
      assert.equal(response.status, 200);
      const body: { itens: { id: string }[]; total: number } = await response.json();
      resultados.push({ entidade, propriaEmpresaVisivel: body.itens.some(p => p.id === local.p.id), outraEmpresaOculta: !body.itens.some(p => p.id === outra.p.id), totalPositivo: body.total >= 1 });
    }
    assert.deepEqual(resultados, ["CONTATO", "FORMA_PAGAMENTO", "VENDEDOR"].map(entidade => ({ entidade, propriaEmpresaVisivel: true, outraEmpresaOculta: true, totalPositivo: true })));
  });

  await t.test("regressão P2: contatos idênticos sem documento ficam sincronizados após equivalência manual", async () => {
    const ladoA = await criarIdentidade("CONTATO", a), ladoB = await criarIdentidade("CONTATO", b);
    const response = await post(["pendencias", ladoA.p.id, "decisao"], {
      versao: 1, acao: "VINCULAR", motivo: "Identidade conferida individualmente nas duas empresas", vinculos: [ladoA.vinculo, ladoB.vinculo],
    });
    assert.equal(response.status, 200);
    const estados = await db.olistSyncEstado.findMany({ where: { id: { in: [ladoA.estado.id, ladoB.estado.id] } } });
    assert.equal(new Set(estados.map(e => e.registroId)).size, 1);
    assert.ok(estados.every(e => e.registroId !== null));
    const resultado = avaliarReplicas({ entidade: "CONTATO", visaoCompleta: true, hashesBase: null,
      hash: v => cripto.hash(v, `${config.id}:campo`),
      replicas: estados.map(e => ({ aplicativoId: e.aplicativoId, existia: false,
        observacao: observacaoProtegida(cripto.decifrar(e.dadosCriptografados!, `${config.id}:estado:${e.aplicativoId}:CONTATO:${e.remoteId}`)),
      })),
    });
    assert.equal(await db.olistSyncOperacao.count({ where: { registroId: estados[0].registroId! } }), 0);
    assert.equal(resultado.status, "SINCRONIZADO", `O vínculo deve resolver a identidade: ${resultado.motivos.join(", ")}`);
  });

  await t.test("filtro mantém pendência geral do registro e restringe pendência de um destino", async () => {
    const registro = await db.olistSyncRegistro.create({ data: { configuracaoId: config.id, entidade: "PRODUTO", chave: "FILTRO-PENDENCIA" } });
    await db.olistSyncEstado.createMany({ data: [a, b].map(app => ({ configuracaoId: config.id, registroId: registro.id, aplicativoId: app, entidade: "PRODUTO", remoteId: "999001" })) });
    const comum = { configuracaoId: config.id, registroId: registro.id, entidade: "PRODUTO", tipo: "FILTRO_POR_EMPRESA", severidade: "ALTA" };
    const geral = await db.olistSyncPendencia.create({ data: { ...comum, chaveDedupe: "FILTRO-GERAL" } });
    const destino = await db.olistSyncPendencia.create({ data: { ...comum, aplicativoId: b, chaveDedupe: "FILTRO-DESTINO" } });
    for (const [app, esperados] of [[a, [geral.id]], [b, [geral.id, destino.id]]] as const) {
      const response = await api.GET(new Request(`https://example.test/api/olist/sincronizacao/pendencias?aplicativoId=${app}&tipo=FILTRO_POR_EMPRESA`, { headers: { authorization: `Bearer ${usuario}` } }), contexto(["pendencias"]));
      assert.equal(response.status, 200);
      const body: { itens: { id: string }[]; total: number } = await response.json();
      assert.deepEqual(body.itens.map(p => p.id).sort(), [...esperados].sort());
      assert.equal(body.total, esperados.length);
    }
  });

  await t.test("equivalência manual remove apenas o bloqueio de identidade e preserva dependências", async () => {
    const ladoA = await criarIdentidade("CONTATO", a), ladoB = await criarIdentidade("CONTATO", b);
    const aad = `${config.id}:estado:${a}:CONTATO:${ladoA.estado.remoteId}`;
    const original = observacaoProtegida(cripto.decifrar(ladoA.estado.dadosCriptografados!, aad));
    await db.olistSyncEstado.update({ where: { id: ladoA.estado.id }, data: { dadosCriptografados: cripto.cifrar({ ...original, pendencias: [...original.pendencias, "REFERENCIA_VENDEDOR"] }, aad) } });
    const response = await post(["pendencias", ladoA.p.id, "decisao"], { versao: 1, acao: "VINCULAR", motivo: "Identidade conferida; referência ainda exige mapeamento", vinculos: [ladoA.vinculo, ladoB.vinculo] });
    assert.equal(response.status, 200);
    const atual = await db.olistSyncEstado.findUniqueOrThrow({ where: { id: ladoA.estado.id } });
    const observacao = observacaoProtegida(cripto.decifrar(atual.dadosCriptografados!, aad));
    assert.deepEqual(observacao.pendencias, ["REFERENCIA_VENDEDOR"]);
    assert.equal(await db.olistSyncOperacao.count({ where: { registroId: atual.registroId! } }), 0);
  });

  await t.test("IDs de outro grupo não permitem ler, decidir, declarar origem, cancelar ou retomar", async () => {
    const outroPai = randomUUID();
    await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Outro grupo de testes')", [outroPai]);
    const outroGrupo = await db.olistSyncConfiguracao.create({ data: { aplicativoPaiId: outroPai } });
    await assert.rejects(db.olistSyncPendencia.create({ data: { configuracaoId: outroGrupo.id, aplicativoId: a, entidade: "CONTATO", tipo: "IDENTIDADE_REQUER_REVISAO", severidade: "ALTA", chaveDedupe: "FILHO-DE-OUTRO-GRUPO" } }), { code: "P2003" });
    const registro = await db.olistSyncRegistro.create({ data: { configuracaoId: outroGrupo.id, entidade: "PRODUTO", chave: "SEGREDO-OUTRO-GRUPO" } });
    const p = await db.olistSyncPendencia.create({ data: { configuracaoId: outroGrupo.id, registroId: registro.id, entidade: "PRODUTO", tipo: "DIVERGENCIA", severidade: "ALTA", chaveDedupe: "OUTRO-GRUPO" } });
    const e = await db.olistSyncExecucao.create({ data: { configuracaoId: outroGrupo.id, modo: "AUDITAR", chaveIdempotencia: randomUUID(), versaoConfiguracao: 1, status: "FALHOU" } });
    for (const recurso of [["pendencias", p.id], ["execucoes", e.id]]) {
      assert.equal((await api.GET(req("GET", recurso), contexto(recurso))).status, 404);
    }
    assert.equal((await post(["pendencias", p.id, "decisao"], { versao: 1, acao: "REJEITAR", motivo: "Tentativa de decidir recurso de outro grupo" })).status, 404);
    assert.equal((await post(["registros", registro.id, "origem"], { revisao: 1, aplicativoOrigemId: a, registroOlistOrigemId: "10", motivo: "Tentativa de alterar recurso de outro grupo", idempotencia: randomUUID() })).status, 404);
    for (const acao of ["cancelar", "retomar"]) assert.equal((await post(["execucoes", e.id, acao], {})).status, 404);
    assert.equal((await db.olistSyncRegistro.findUniqueOrThrow({ where: { id: registro.id } })).revisao, 1);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: p.id } })).status, "AGUARDANDO_REVISAO");
    assert.equal(await db.olistSyncEvento.count({ where: { configuracaoId: outroGrupo.id } }), 0);
  });

  await t.test("origens concorrentes com a mesma revisão aceitam uma decisão e auditam apenas a vencedora", async () => {
    const r = await db.olistSyncRegistro.create({ data: { configuracaoId: config.id, entidade: "PRODUTO", chave: "ORIGEM-CAS" } });
    const rota = ["registros", r.id, "origem"];
    const entradas = [a, b].map((app, index) => ({ revisao: 1, aplicativoOrigemId: app, registroOlistOrigemId: String(index + 10), motivo: "Conferência histórica da origem pela equipe", idempotencia: randomUUID() }));
    const respostas = await Promise.all(entradas.map(input => post(rota, input)));
    assert.deepEqual(respostas.map(r => r.status).sort(), [200, 409]);
    const vencedor = entradas[respostas.findIndex(r => r.status === 200)];
    const atual = await db.olistSyncRegistro.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(atual.revisao, 2); assert.equal(atual.aplicativoOrigemId, vencedor.aplicativoOrigemId);
    assert.equal(atual.registroOlistOrigemId, vencedor.registroOlistOrigemId);
    assert.equal(await db.olistSyncEvento.count({ where: { registroId: r.id, tipo: "ORIGEM_DECLARADA" } }), 1);
  });

  await t.test("replay concorrente da origem é idempotente e não permite reutilizar a chave com outro conteúdo", async () => {
    const r = await db.olistSyncRegistro.create({ data: { configuracaoId: config.id, entidade: "PRODUTO", chave: "ORIGEM-REPLAY" } });
    const rota = ["registros", r.id, "origem"], input = { revisao: 1, aplicativoOrigemId: a, registroOlistOrigemId: "44", motivo: "Histórico conferido na conta original do cadastro", idempotencia: randomUUID() };
    const respostas = await Promise.all([post(rota, input), post(rota, input)]);
    assert.deepEqual(respostas.map(r => r.status), [200, 200]);
    assert.equal((await post(rota, { ...input, motivo: "Outro motivo indevidamente usando a mesma chave" })).status, 409);
    assert.equal((await db.olistSyncRegistro.findUniqueOrThrow({ where: { id: r.id } })).revisao, 2);
    assert.equal(await db.olistSyncEvento.count({ where: { registroId: r.id, tipo: "ORIGEM_DECLARADA" } }), 1);
  });

  await t.test("rejeitar e ignorar concorrentemente preservam uma única decisão com motivo e autor", async () => {
    const p = await pendencia("DECISAO-CAS-REJEITAR-IGNORAR");
    const respostas = await Promise.all(["REJEITAR", "IGNORAR"].map(acao => post(["pendencias", p.id, "decisao"], { versao: 1, acao, motivo: `Decisão ${acao} conferida pelo administrador` })));
    assert.deepEqual(respostas.map(r => r.status).sort(), [200, 409]);
    const atual = await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(atual.versao, 2); assert.equal(atual.decididoPor, usuario);
    assert.equal(atual.status, respostas[0].status === 200 ? "REJEITADA" : "IGNORADA");
    assert.ok(atual.motivo?.includes(respostas[0].status === 200 ? "REJEITAR" : "IGNORAR"));
    assert.equal(await db.olistSyncEvento.count({ where: { configuracaoId: config.id, tipo: "DECISAO_HUMANA", metadadosJson: { path: ["pendenciaId"], equals: p.id } } }), 1);
    assert.equal((await post(["pendencias", p.id, "decisao"], { versao: 2, acao: "REJEITAR", motivo: "Tentativa de substituir uma decisão encerrada" })).status, 409);
  });

  await t.test("vínculo manual exige incluir precisamente o cadastro da pendência revisada", async () => {
    const original = await criarIdentidade("FORMA_PAGAMENTO", a), outroA = await criarIdentidade("FORMA_PAGAMENTO", a), ladoB = await criarIdentidade("FORMA_PAGAMENTO", b);
    const response = await post(["pendencias", original.p.id, "decisao"], { versao: 1, acao: "VINCULAR", motivo: "Tentativa de associar cadastros de outra pendência", vinculos: [outroA.vinculo, ladoB.vinculo] });
    assert.equal(response.status, 409);
    assert.equal(await db.olistSyncEstado.count({ where: { id: { in: [original.estado.id, outroA.estado.id, ladoB.estado.id] }, registroId: { not: null } } }), 0);
    assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: original.p.id } })).versao, 1);
  });

  await t.test("vínculo com participante desabilitado falha integralmente sem resolver a pendência", async () => {
    const ladoA = await criarIdentidade("FORMA_PAGAMENTO", a), ladoB = await criarIdentidade("FORMA_PAGAMENTO", b);
    await db.olistSyncParticipante.update({ where: { configuracaoId_aplicativoId: { configuracaoId: config.id, aplicativoId: b } }, data: { habilitado: false } });
    try {
      const response = await post(["pendencias", ladoA.p.id, "decisao"], { versao: 1, acao: "VINCULAR", motivo: "Vínculo requer participantes atualmente habilitados", vinculos: [ladoA.vinculo, ladoB.vinculo] });
      assert.equal(response.status, 400);
      assert.equal(await db.olistSyncEstado.count({ where: { id: { in: [ladoA.estado.id, ladoB.estado.id] }, registroId: { not: null } } }), 0);
      assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: ladoA.p.id } })).status, "AGUARDANDO_REVISAO");
    } finally {
      await db.olistSyncParticipante.update({ where: { configuracaoId_aplicativoId: { configuracaoId: config.id, aplicativoId: b } }, data: { habilitado: true } });
    }
  });

  await t.test("lista de pendências não transfere dados protegidos; detalhe decifra somente a empresa observada", async () => {
    const local = await criarIdentidade("CONTATO", a, "Contato fictício confidencial");
    const listagem = await api.GET(req("GET", ["pendencias"]), contexto(["pendencias"]));
    const texto = await listagem.text(); assert.ok(!texto.includes("Contato fictício confidencial")); assert.ok(!texto.includes("detalhesCriptografados"));
    assert.equal(listagem.headers.get("cache-control"), "private, no-store");
    const detalhe = await api.GET(req("GET", ["pendencias", local.p.id]), contexto(["pendencias", local.p.id]));
    const body = await detalhe.json();
    assert.equal(body.comparacao.length, 1); assert.equal(body.comparacao[0].aplicativoId, a);
    assert.equal(body.comparacao[0].campos.nome, "Contato fictício confidencial");
    assert.ok(body.acoesPermitidas.includes("VINCULAR")); assert.equal(body.detalhesCriptografados, undefined);
  });

  await t.test("bloqueio sem nova versão impede aprovar e vincular sem impedir encerrar pendências", async () => {
    const politica = await db.olistSyncConfiguracao.findUniqueOrThrow({ where: { id: config.id } });
    const e = await db.olistSyncExecucao.create({ data: { configuracaoId: config.id, chaveIdempotencia: randomUUID(), modo: "AUDITAR", completa: true, versaoConfiguracao: politica.versao, status: "CONCLUIDA", finalizadaEm: new Date() } });
    await db.olistSyncEtapa.createMany({ data: [a, b].map(aplicativoId => ({ execucaoId: e.id, aplicativoId, entidade: "PRODUTO", fase: "DETALHAR", status: "CONCLUIDA" })) });
    const registro = await db.olistSyncRegistro.create({ data: { configuracaoId: config.id, entidade: "PRODUTO", chave: "POLITICA-REVISAO" } });
    for (const app of [a, b]) {
      const remoteId = app === a ? "750001" : "750002", campos = { sku: "POLITICA-REVISAO", tipo: "S", descricao: app === a ? "Nome aprovado" : "Nome divergente" };
      const observacao = { id: remoteId, chave: campos.sku, nome: campos.descricao, tipo: "S", situacao: "A", alteradoEm: null, completo: true, campos, pendencias: [] };
      await db.olistSyncEstado.create({ data: { configuracaoId: config.id, registroId: registro.id, aplicativoId: app, entidade: "PRODUTO", remoteId, chave: campos.sku, ultimaExecucaoId: e.id,
        hashesJson: gerarHashesCampos(campos, valor => cripto.hash(valor, `${config.id}:campo`)), dadosCriptografados: cripto.cifrar(observacao, `${config.id}:estado:${app}:PRODUTO:${remoteId}`) } });
    }
    const conflito = await db.olistSyncPendencia.create({ data: { configuracaoId: config.id, registroId: registro.id, execucaoId: e.id, entidade: "PRODUTO", tipo: "CONFLITO_INICIAL", severidade: "ALTA", chaveDedupe: "POLITICA-REVISAO" } });
    const ladoA = await criarIdentidade("FORMA_PAGAMENTO", a), ladoB = await criarIdentidade("FORMA_PAGAMENTO", b);
    await db.olistSyncConfiguracao.update({ where: { id: config.id }, data: { aplicativosBloqueados: [...politica.aplicativosBloqueados, b] } });
    try {
      const aprovar = await post(["pendencias", conflito.id, "decisao"], { versao: 1, acao: "APROVAR", motivo: "Cadastro conferido antes do bloqueio administrativo", aplicativoFonteId: a });
      const vincular = await post(["pendencias", ladoA.p.id, "decisao"], { versao: 1, acao: "VINCULAR", motivo: "Identidades conferidas antes do bloqueio administrativo", vinculos: [ladoA.vinculo, ladoB.vinculo] });
      assert.equal(aprovar.status, 400); assert.equal(vincular.status, 400);
      assert.match((await aprovar.json()).error, /sem bloqueios/); assert.match((await vincular.json()).error, /sem bloqueios/);
      assert.equal((await db.olistSyncConfiguracao.findUniqueOrThrow({ where: { id: config.id } })).versao, politica.versao);
      assert.equal(await db.olistSyncOperacao.count({ where: { registroId: registro.id } }), 0);
      assert.equal((await db.olistSyncRegistro.findUniqueOrThrow({ where: { id: registro.id } })).revisao, 1);
      assert.equal(await db.olistSyncEstado.count({ where: { id: { in: [ladoA.estado.id, ladoB.estado.id] }, registroId: { not: null } } }), 0);
      for (const p of [conflito, ladoA.p]) {
        assert.equal((await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: p.id } })).status, "AGUARDANDO_REVISAO");
        assert.equal(await db.olistSyncEvento.count({ where: { configuracaoId: config.id, tipo: "DECISAO_HUMANA", metadadosJson: { path: ["pendenciaId"], equals: p.id } } }), 0);
      }
      assert.equal((await post(["pendencias", conflito.id, "decisao"], { versao: 1, acao: "IGNORAR", motivo: "Encerrar a pendência enquanto a empresa está bloqueada" })).status, 200);
      assert.equal((await post(["pendencias", ladoA.p.id, "decisao"], { versao: 1, acao: "REJEITAR", motivo: "Recusar equivalência enquanto a empresa está bloqueada" })).status, 200);
    } finally {
      await db.olistSyncConfiguracao.update({ where: { id: config.id }, data: { aplicativosBloqueados: politica.aplicativosBloqueados } });
    }
  });

  await t.test("outro grupo aplica seu bloqueio persistido e a seleção comum não consegue removê-lo", async () => {
    const outroPai = randomUUID(), bloqueado = randomUUID(), filhoA = randomUUID(), filhoB = randomUUID(), responsavel = randomUUID();
    await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Outro pai com política')", [outroPai]);
    await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'Filho bloqueado',$4),($2,'Filho A',$4),($3,'Filho B',$4)", [bloqueado, filhoA, filhoB, outroPai]);
    await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_visualizar_sincronizacao_olist,pode_configurar_sincronizacao_olist) VALUES ($1,$2,true,true)", [responsavel, outroPai]);
    const outroGrupo = await db.olistSyncConfiguracao.create({ data: { aplicativoPaiId: outroPai, aplicativosBloqueados: [bloqueado] } });
    const rota = ["configuracao"], input = { versao: 1, ativo: false, entidades: ["PRODUTO"], participantesIds: [filhoA, filhoB], horaDiaria: "02:00", limiteAlteracoes: 100,
      prontidao: { sincronizacaoNativaCompativel: false, semanticaPutValidada: false, incrementalValidado: false } };
    const obter = async () => {
      const response = await api.GET(req("GET", rota, undefined, responsavel), contexto(rota));
      assert.equal(response.status, 200);
      const body: { aplicativosOrigem: { id: string }[]; aplicativosElegiveis: { id: string; habilitado: boolean }[] } = await response.json();
      return body;
    };
    const inicial = await obter();
    assert.deepEqual(inicial.aplicativosElegiveis.map(app => app.id).sort(), [filhoA, filhoB].sort());
    assert.ok(inicial.aplicativosElegiveis.every(app => !app.habilitado));
    assert.ok(inicial.aplicativosOrigem.some(app => app.id === bloqueado));
    assert.equal((await api.PUT(req("PUT", rota, input, responsavel), contexto(rota))).status, 200);
    assert.ok((await obter()).aplicativosElegiveis.every(app => app.habilitado));
    const atualizar = { ...input, versao: 2 };
    assert.equal((await api.PUT(req("PUT", rota, { ...atualizar, aplicativosBloqueados: [] }, responsavel), contexto(rota))).status, 400);
    assert.equal((await api.PUT(req("PUT", rota, { ...atualizar, participantesIds: [filhoA, bloqueado] }, responsavel), contexto(rota))).status, 400);
    const atual = await db.olistSyncConfiguracao.findUniqueOrThrow({ where: { id: outroGrupo.id } });
    assert.deepEqual(atual.aplicativosBloqueados, [bloqueado]); assert.equal(atual.versao, 2);
    assert.equal(await db.olistSyncParticipante.count({ where: { configuracaoId: outroGrupo.id, aplicativoId: bloqueado } }), 0);
    assert.equal(await db.olistSyncEvento.count({ where: { configuracaoId: outroGrupo.id, tipo: "CONFIGURACAO_ALTERADA" } }), 1);
  });
});
