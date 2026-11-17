import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { aplicativoTemJob } from "@/lib/aplicativo-jobs";
import { criarOlistSyncRepository, ErroRepositorioSync, ESTADOS_EXECUCAO_SYNC_ATIVOS, JOBS_SYNC } from "@/repositories/olist-sync-repository";
import { aplicativoElegivelSync } from "@/lib/olist-sync/elegibilidade";
import { criarCriptografiaSync } from "@/lib/olist-sync/cripto";
import { FalhaSync } from "@/lib/olist-sync/contrato";
import { configuracaoSchema, decisaoSchema, execucaoSchema, filtrosSchema, objetoJson, observacaoProtegida, origemSchema, proximoHorarioSync } from "@/lib/olist-sync/validacao";

import { declararOrigemSync, resolverPendenciaSync } from "@/services/olist-sync-review-service";
import { contarValidacoesRecentesSync } from "@/repositories/olist-sync-previsao-repository";
import { calcularPrevisaoValidacaoSync, inicioJanelaPrevisaoSync } from "@/lib/olist-sync/previsao";

export const dynamic="force-dynamic";
type Contexto={params:Promise<{recurso?:string[]}>};
const repo=criarOlistSyncRepository(prisma);
const json=(body:unknown,init?:ResponseInit)=>NextResponse.json(body,{...init,headers:{...init?.headers,"Cache-Control":"private, no-store"}});
const selectExecucao={id:true,modo:true,status:true,origem:true,createdAt:true,iniciadaEm:true,finalizadaEm:true,contadoresJson:true} as const;
const selectPendencia={id:true,registroId:true,entidade:true,tipo:true,severidade:true,status:true,versao:true,createdAt:true} as const;
function execucaoDto(e:{id:string;modo:string;status:string;origem:string;createdAt:Date;iniciadaEm:Date|null;finalizadaEm:Date|null;contadoresJson:Prisma.JsonValue}) {
  return {id:e.id,modo:e.modo,status:e.status,origem:e.origem,criadoEm:e.createdAt,iniciadoEm:e.iniciadaEm,finalizadoEm:e.finalizadaEm,contadores:e.contadoresJson};
}
const pendenciaDto=(p:Prisma.OlistSyncPendenciaGetPayload<{select:typeof selectPendencia}>)=>({id:p.id,registroId:p.registroId,entidade:p.entidade,tipo:p.tipo,severidade:p.severidade,status:p.status,versao:p.versao,criadoEm:p.createdAt,resumo:p.tipo.replaceAll("_"," ")});
type PermissaoSync="visualizar"|"executar"|"resolver"|"configurar";
async function escopoComConfiguracao<T>(request:Request,permissao:PermissaoSync,obterConfiguracao:(aplicativoPaiId:string)=>Promise<T|null>) {
  let usuario;
  try{usuario=await getUsuarioAutenticado(request);}catch{throw new ErroRepositorioSync("Sessão inválida ou expirada.",401);}
  const [permissoes,config]=await Promise.all([
    prisma.usuario.findUnique({where:{id:usuario.id},select:{podeVisualizarSincronizacaoOlist:true,podeExecutarSincronizacaoOlist:true,podeResolverSincronizacaoOlist:true,podeConfigurarSincronizacaoOlist:true}}),
    obterConfiguracao(usuario.aplicativoId),
  ]);
  const permitido=permissao==="visualizar"?permissoes?.podeVisualizarSincronizacaoOlist:permissao==="executar"?permissoes?.podeExecutarSincronizacaoOlist:permissao==="resolver"?permissoes?.podeResolverSincronizacaoOlist:permissoes?.podeConfigurarSincronizacaoOlist;
  if(!config || !permissoes?.podeVisualizarSincronizacaoOlist || !permitido)throw new ErroRepositorioSync("Acesso restrito aos administradores autorizados do aplicativo pai.",403);
  return {usuario,config};
}
const escopo=(request:Request,permissao:PermissaoSync)=>escopoComConfiguracao(request,permissao,repo.obterConfiguracao);
function respostaErro(error:unknown) {
  if(error instanceof ErroRepositorioSync)return json({error:error.message},{status:error.status});
  if(error instanceof z.ZodError)return json({error:"Dados inválidos. Revise os campos e limites enviados."},{status:400});
  if(error instanceof FalhaSync)return json({error:error.message,codigo:error.codigo},{status:409});
  return json({error:"Não foi possível concluir a solicitação de sincronização."},{status:500});
}
async function corpo(request:Request):Promise<unknown> {
  if(Number(request.headers.get("content-length")??0)>16_384)throw new ErroRepositorioSync("Solicitação muito grande.",413);
  const texto=await request.text(); if(texto.length>16_384)throw new ErroRepositorioSync("Solicitação muito grande.",413);
  try{return JSON.parse(texto);}catch{throw new ErroRepositorioSync("JSON inválido.",400);}
}

export async function GET(request:Request,contexto:Contexto) {
  try{
    const caminho=(await contexto.params).recurso??["resumo"];
    const [recurso,id]=caminho;
    if(recurso==="previsao" && !id) {
      const {config}=await escopoComConfiguracao(request,"visualizar",aplicativoPaiId=>prisma.olistSyncConfiguracao.findUnique({
        where:{aplicativoPaiId},select:{id:true,ativo:true,aplicativoPai:{select:{jobs:true}}}}));
      const agora=new Date();
      const e=await prisma.olistSyncExecucao.findFirst({where:{configuracaoId:config.id,status:{in:["PENDENTE","AUDITANDO","AGUARDANDO_RETRY"]},modo:{in:["AUDITAR","AUDITAR_E_APLICAR"]}},
        select:{id:true,iniciadaEm:true,contadoresJson:true,etapas:{select:{fase:true,status:true},take:201}}});
      if(!e)return json({previsao:null});
      const permitidoNoPai=config.ativo && aplicativoTemJob(config.aplicativoPai.jobs,JOBS_SYNC.auditar.flag);
      const job=permitidoNoPai?await prisma.configuracaoJob.findUnique({where:{chave:JOBS_SYNC.auditar.chave},select:{pausado:true}}):null;
      const pausada=!permitidoNoPai || !job || job.pausado;
      const listagemPendente=e.etapas.length===0 || e.etapas.length>200 || e.etapas.some(s=>s.fase==="LISTAR" && s.status!=="CONCLUIDA");
      const previa=calcularPrevisaoValidacaoSync({execucaoId:e.id,agora,iniciadaEm:e.iniciadaEm,contadores:e.contadoresJson,
        validadosNaJanela:0,listagemPendente,pausada});
      // Os demais estados já são conhecidos sem contar observações recentes.
      if(previa.estado!=="SEM_RITMO")return json({previsao:previa});
      const inicio=inicioJanelaPrevisaoSync(agora,e.iniciadaEm);
      const recentes=await contarValidacoesRecentesSync(prisma,config.id,e.id,inicio,agora);
      return json({previsao:calcularPrevisaoValidacaoSync({execucaoId:e.id,agora,iniciadaEm:e.iniciadaEm,contadores:e.contadoresJson,
        validadosNaJanela:recentes,listagemPendente,pausada})});
    }
    const {config}=await escopo(request,"visualizar");
    if(id)z.uuid().parse(id);
    const filtros=filtrosSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const pagina={skip:filtros.offset,take:filtros.limit};
    if(recurso==="configuracao") {
      const [pai,filhos,jobs]=await Promise.all([
        prisma.aplicativo.findUniqueOrThrow({where:{id:config.aplicativoPaiId},select:{nome:true}}),
        prisma.aplicativo.findMany({where:{aplicativoPaiId:config.aplicativoPaiId},select:{id:true,nome:true,aplicativoPaiId:true},orderBy:[{nome:"asc"},{id:"asc"}],take:100}),
        prisma.configuracaoJob.findMany({where:{chave:{in:Object.values(JOBS_SYNC).map(j=>j.chave)}},select:{chave:true,pausado:true}}),
      ]);
      return json({id:config.id,aplicativoPaiId:config.aplicativoPaiId,aplicativoPaiNome:pai.nome,versao:config.versao,ativo:config.ativo,entidades:config.entidades,
        participantes:config.participantes.map(p=>({id:p.aplicativoId,nome:p.aplicativo.nome,habilitado:p.habilitado})),aplicativosOrigem:filhos.map(p=>({id:p.id,nome:p.nome,habilitado:false})),aplicativosElegiveis:filhos.filter(p=>aplicativoElegivelSync(config,p)).map(p=>({id:p.id,nome:p.nome,habilitado:config.participantes.some(c=>c.aplicativoId===p.id&&c.habilitado)})),
        horaDiaria:config.horaDiaria,fusoHorario:config.timezone,limiteAlteracoes:config.limiteAlteracoes,proximaExecucaoEm:config.proximaExecucaoEm,
        prontidao:{sincronizacaoNativaCompativel:false,semanticaPutValidada:false,incrementalValidado:false,...objetoJson(config.readinessJson)},
        jobs:Object.values(JOBS_SYNC).map(j=>({chave:j.chave,permitidoNoPai:aplicativoTemJob(config.aplicativoPai.jobs,j.flag),pausado:jobs.find(c=>c.chave===j.chave)?.pausado??true}))});
    }
    if(recurso==="resumo") {
      const [estados,pendencias,ultima,ativa]=await Promise.all([
        prisma.olistSyncEstado.groupBy({by:["status"],where:{configuracaoId:config.id,participante:{habilitado:true}},_count:true}),
        prisma.olistSyncPendencia.count({where:{configuracaoId:config.id,status:"AGUARDANDO_REVISAO"}}),
        prisma.olistSyncExecucao.findFirst({where:{configuracaoId:config.id},orderBy:[{createdAt:"desc"},{id:"desc"}],select:selectExecucao}),
        prisma.olistSyncExecucao.findFirst({where:{configuracaoId:config.id,status:{in:ESTADOS_EXECUCAO_SYNC_ATIVOS}},select:selectExecucao}),
      ]);
      const quantidade=(...status:string[])=>estados.filter(e=>status.includes(e.status)).reduce((n,e)=>n+e._count,0);
      return json({sincronizados:quantidade("SINCRONIZADO"),divergentes:quantidade("DIVERGENTE","AGUARDANDO_REVISAO"),erros:quantidade("ERRO"),pendencias,ultimaExecucao:ultima?execucaoDto(ultima):null,execucaoAtiva:ativa?execucaoDto(ativa):null});
    }
    if(recurso==="execucoes") {
      if(id) {
        const e=await prisma.olistSyncExecucao.findFirst({where:{id,configuracaoId:config.id},select:{...selectExecucao,etapas:{select:{id:true,entidade:true,aplicativoId:true,fase:true,status:true,tentativas:true,disponivelEm:true},orderBy:[{entidade:"asc"},{aplicativoId:"asc"}],take:200}}});
        if(!e)throw new ErroRepositorioSync("Execução não encontrada.",404);
        return json({...execucaoDto(e),etapas:e.etapas.map(s=>({...s,aplicativoId:s.aplicativoId??config.aplicativoPaiId}))});
      }
      const where={configuracaoId:config.id,...(filtros.status?{status:filtros.status}:{})};
      const [itens,total]=await Promise.all([prisma.olistSyncExecucao.findMany({where,select:selectExecucao,orderBy:[{createdAt:"desc"},{id:"desc"}],...pagina}),prisma.olistSyncExecucao.count({where})]);
      return json({itens:itens.map(execucaoDto),total,offset:filtros.offset,limit:filtros.limit});
    }
    if(recurso==="registros") {
      const where:Prisma.OlistSyncRegistroWhereInput={configuracaoId:config.id,entidade:filtros.entidade,origemTipo:filtros.origemTipo,aplicativoOrigemId:filtros.aplicativoOrigemId,ultimaFonteAppId:filtros.ultimaFonteAppId,...(filtros.aplicativoId||filtros.status?{estados:{some:{aplicativoId:filtros.aplicativoId,status:filtros.status}}}:{})};
      const [itens,total]=await Promise.all([prisma.olistSyncRegistro.findMany({where,select:{id:true,entidade:true,chave:true,nome:true,revisao:true,origemTipo:true,aplicativoOrigemId:true,registroOlistOrigemId:true,origemRegistradaEm:true,ultimaFonteAppId:true,estados:{where:{participante:{habilitado:true}},select:{aplicativoId:true,status:true,verificadoEm:true},take:20}},orderBy:{id:"asc"},...pagina}),prisma.olistSyncRegistro.count({where})]);
      return json({itens:itens.map(({chave,...r})=>({...r,chaveExibicao:r.entidade==="PRODUTO"?chave:`Identificador protegido · ${chave.slice(0,8)}`})),total,offset:filtros.offset,limit:filtros.limit});
    }
    if(recurso==="pendencias") {
      if(id) {
        const p=await prisma.olistSyncPendencia.findFirst({where:{id,configuracaoId:config.id},select:{...selectPendencia,chaveDedupe:true,detalhesCriptografados:true}});
        if(!p)throw new ErroRepositorioSync("Pendência não encontrada.",404);
        const c=criarCriptografiaSync();
        const detalhe=p.detalhesCriptografados?objetoJson(c.decifrar(p.detalhesCriptografados,`${config.id}:pendencia:${p.chaveDedupe}`)):{};
        const estadoFiltro:Prisma.OlistSyncEstadoWhereInput=p.registroId?{registroId:p.registroId}:typeof detalhe.aplicativoId==="string"&&typeof detalhe.remoteId==="string"?{aplicativoId:detalhe.aplicativoId,remoteId:detalhe.remoteId,entidade:p.entidade}:{id:"00000000-0000-0000-0000-000000000000"};
        const estados=await prisma.olistSyncEstado.findMany({where:{configuracaoId:config.id,...estadoFiltro,participante:{habilitado:true}},select:{aplicativoId:true,remoteId:true,dadosCriptografados:true,participante:{select:{aplicativo:{select:{nome:true}}}}},take:20});
        const comparacao=estados.flatMap(s=>s.dadosCriptografados?[{aplicativoId:s.aplicativoId,nome:s.participante.aplicativo.nome,registroOlistId:s.remoteId,campos:observacaoProtegida(c.decifrar(s.dadosCriptografados,`${config.id}:estado:${s.aplicativoId}:${p.entidade}:${s.remoteId}`)).campos}]:[]);
        const aprovavel=p.registroId&&["PRODUTO","CONTATO"].includes(p.entidade)&&!/DUPLIC|IDENTIDADE|INCONCLUSIVO|REFERENCIA_|ESTRUTURA|VARIACAO|INATIVO|REMOVIDO/.test(p.tipo);
        return json({...pendenciaDto(p),comparacao,acoesPermitidas:p.status==="AGUARDANDO_REVISAO"?[...(aprovavel?["APROVAR"]:[]),...(!p.registroId&&p.entidade!=="PRODUTO"?["VINCULAR"]:[]),"REJEITAR","IGNORAR","REAUDITAR"]:[]});
      }
      const where:Prisma.OlistSyncPendenciaWhereInput={configuracaoId:config.id,entidade:filtros.entidade,status:filtros.status,severidade:filtros.severidade,tipo:filtros.tipo,...(filtros.aplicativoId?{OR:[
        {aplicativoId:filtros.aplicativoId},
        {aplicativoId:null,registro:{estados:{some:{aplicativoId:filtros.aplicativoId}}}},
      ]}:{})};
      const [itens,total]=await Promise.all([prisma.olistSyncPendencia.findMany({where,select:selectPendencia,orderBy:[{createdAt:"desc"},{id:"desc"}],...pagina}),prisma.olistSyncPendencia.count({where})]);
      return json({itens:itens.map(pendenciaDto),total,offset:filtros.offset,limit:filtros.limit});
    }
    throw new ErroRepositorioSync("Recurso não encontrado.",404);
  }catch(error){return respostaErro(error);}
}

export async function PUT(request:Request,contexto:Contexto) {
  try{
    const {usuario,config}=await escopo(request,"configurar");
    if((await contexto.params).recurso?.join("/")!=="configuracao")throw new ErroRepositorioSync("Recurso não encontrado.",404);
    const input=configuracaoSchema.parse(await corpo(request));
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM olist_sync_configuracao WHERE id=${config.id}::uuid FOR UPDATE`;
      // A política pode ter mudado desde a leitura de autorização. O lock impede
      // que um bloqueio concorra com a seleção comum de participantes.
      const politica=await tx.olistSyncConfiguracao.findUniqueOrThrow({where:{id:config.id},select:{aplicativoPaiId:true,aplicativosBloqueados:true}});
      if(politica.aplicativoPaiId!==usuario.aplicativoId)throw new ErroRepositorioSync("A configuração não pertence mais a este aplicativo pai.",403);
      const selecionados=await tx.aplicativo.findMany({where:{id:{in:input.participantesIds},aplicativoPaiId:politica.aplicativoPaiId},select:{id:true,aplicativoPaiId:true},take:input.participantesIds.length});
      if(selecionados.length!==input.participantesIds.length || selecionados.some(app=>!aplicativoElegivelSync(politica,app)))throw new ErroRepositorioSync("Somente filhos diretos sem bloqueio podem participar.",400);
      const salva=await tx.olistSyncConfiguracao.updateMany({where:{id:config.id,versao:input.versao},data:{ativo:input.ativo,entidades:input.entidades,horaDiaria:input.horaDiaria,limiteAlteracoes:input.limiteAlteracoes,readinessJson:input.prontidao,autorizadoPor:usuario.id,versao:{increment:1},proximaExecucaoEm:proximoHorarioSync(new Date(),input.horaDiaria,config.timezone)}});
      if(!salva.count)throw new ErroRepositorioSync("Configuração alterada por outro usuário. Recarregue antes de salvar.");
      await tx.olistSyncParticipante.updateMany({where:{configuracaoId:config.id,aplicativoId:{notIn:input.participantesIds}},data:{habilitado:false}});
      for(const app of input.participantesIds)await tx.olistSyncParticipante.upsert({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:app}},create:{configuracaoId:config.id,aplicativoId:app,habilitado:true},update:{habilitado:true},select:{id:true}});
      await tx.olistSyncEvento.create({data:{configuracaoId:config.id,usuarioId:usuario.id,tipo:"CONFIGURACAO_ALTERADA",metadadosJson:{versao:input.versao+1,participantes:input.participantesIds,prontidao:input.prontidao}},select:{id:true}});
    });
    return json({ok:true,versao:input.versao+1});
  }catch(error){return respostaErro(error);}
}

export async function POST(request:Request,contexto:Contexto) {
  try{
    const [recurso,id,acao]=(await contexto.params).recurso??[];
    const {usuario,config}=await escopo(request,recurso==="execucoes"?"executar":"resolver");
    if(id)z.uuid().parse(id);
    if(recurso==="execucoes") {
      if(id&&acao==="cancelar")return json(execucaoDto(await repo.cancelarExecucao(id,config.aplicativoPaiId)));
      if(id&&acao==="retomar") {
        const e=await repo.retomarExecucao(id,config.aplicativoPaiId,usuario.id,randomUUID());
        return json({...execucaoDto(e),statusUrl:`/api/olist/sincronizacao/execucoes/${e.id}`},{status:202});
      }
      if(id)throw new ErroRepositorioSync("Ação não encontrada.",404);
      const input=execucaoSchema.parse(await corpo(request));
      criarCriptografiaSync(); // Falha antes de aceitar trabalho que não pode proteger os dados.
      const e=await repo.enfileirar({configuracaoId:config.id,modo:input.modo,idempotencia:input.idempotencia,solicitadoPor:usuario.id,origem:"MANUAL",completa:input.completa});
      return json({...execucaoDto(e),statusUrl:`/api/olist/sincronizacao/execucoes/${e.id}`},{status:202});
    }
    if(recurso==="registros"&&id&&acao==="origem") {
      const input=origemSchema.parse(await corpo(request));
      await declararOrigemSync(prisma, config, usuario.id, id, input);
      return json({ok:true});
    }
    if(recurso==="pendencias"&&id&&acao==="decisao") {
      const input=decisaoSchema.parse(await corpo(request));
      if(input.acao==="REAUDITAR")await escopo(request,"executar");
      const resultado=await resolverPendenciaSync(prisma, config, usuario.id, id, input);
      if(resultado)return json({...execucaoDto(resultado),statusUrl:`/api/olist/sincronizacao/execucoes/${resultado.id}`},{status:202});
      return json({ok:true});
    }
    throw new ErroRepositorioSync("Ação não encontrada.",404);
  }catch(error){return respostaErro(error);}
}
