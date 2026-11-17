import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { criarOlistSyncRepository, JOBS_SYNC } from "@/repositories/olist-sync-repository";
import { aplicativoTemJob } from "@/lib/aplicativo-jobs";
import { aplicativoElegivelSync } from "@/lib/olist-sync/elegibilidade";
import { criarCriptografiaSync, serializarCanonico } from "@/lib/olist-sync/cripto";
import { avaliarReplicas, gerarHashesCampos, inferirOrigem, prepararPayload } from "@/lib/olist-sync/dominio";
import { FalhaSync, type ClienteSync, type CamposSync, type JsonValue, type ObservacaoRemota, type ReplicaComparacao } from "@/lib/olist-sync/contrato";
import { entidadeSync, hashesJson, objetoJson, observacaoProtegida, proximoHorarioSync, prazoRetrySync } from "@/lib/olist-sync/validacao";
import { cotaDaRespostaSync, esperaAuditoriaSync, type CotaLeituraSync } from "@/lib/olist-sync/ritmo";

type Tx = Prisma.TransactionClient;
type Repo = ReturnType<typeof criarOlistSyncRepository>;
type Reserva = NonNullable<Awaited<ReturnType<Repo["reservarEtapa"]>>>;
type Cripto = ReturnType<typeof criarCriptografiaSync>;
const selecaoEstado = { id:true, registroId:true, aplicativoId:true, remoteId:true, chave:true, dadosCriptografados:true, ultimaExecucaoId:true, hashesJson:true, metadadosJson:true } as const;
const jsonObservacao = (o: ObservacaoRemota): CamposSync => ({ id:o.id,chave:o.chave,nome:o.nome,situacao:o.situacao,alteradoEm:o.alteradoEm,completo:o.completo,campos:o.campos,pendencias:o.pendencias,...(o.tipo?{tipo:o.tipo}:{}),...(o.paiId?{paiId:o.paiId}:{}) });
const contextoEstado = (grupo:string, app:string, entidade:string, id:string) => `${grupo}:estado:${app}:${entidade}:${id}`;
const contextoOperacao = (grupo:string,id:string) => `${grupo}:operacao:${id}`;
const idAgendamento = (grupo:string, prevista:Date) => {
  const hash=createHash("sha256").update(`olist-sync:${grupo}:${prevista.toISOString()}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
};

export function criarServicoOlistSync(db: PrismaClient, cliente: ClienteSync, opcoes: { agora?:()=>Date; aguardar?:(ms:number)=>Promise<void>; cripto?:Cripto } = {}) {
  const persistencia = criarOlistSyncRepository(db);
  const repo = { ...persistencia,
    async comReserva<T>(reserva:Pick<Reserva,"id"|"leaseToken">, executar:(tx:Tx,atual:Reserva)=>Promise<T>) {
      const resultado=await persistencia.comReserva(reserva,executar);
      if(resultado===null)throw new FalhaSync("LEASE_PERDIDA","A reserva de execução expirou.");
      return resultado;
    },
    async salvarCheckpoint(entrada:Parameters<Repo["salvarCheckpoint"]>[0]) {
      const salvo=await persistencia.salvarCheckpoint(entrada);
      if(salvo===null)throw new FalhaSync("LEASE_PERDIDA","A reserva de execução expirou.");
      return salvo;
    },
  };
  const agora = opcoes.agora ?? (() => new Date());
  const aguardar = opcoes.aguardar ?? ((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const criptografia = () => opcoes.cripto ?? criarCriptografiaSync();

  async function contar(tx:Tx, execucaoId:string, campo:string, quantidade=1) {
    await tx.$executeRaw`UPDATE olist_sync_execucao SET contadores_json=jsonb_set(coalesce(contadores_json,'{}'::jsonb),ARRAY[${campo}],to_jsonb(coalesce((contadores_json->>${campo})::integer,0)+${quantidade}::integer),true) WHERE id=${execucaoId}::uuid`;
  }

  async function dadosReserva(r: Reserva) {
    const etapa = await db.olistSyncEtapa.findUniqueOrThrow({ where:{id:r.id}, select:{ id:true,execucaoId:true,entidade:true,aplicativoId:true,fase:true,cursorJson:true,leaseAte:true,
      execucao:{select:{id:true,configuracaoId:true,modo:true,origem:true,completa:true,versaoConfiguracao:true,solicitadoPor:true,cancelamentoSolicitado:true,
        configuracao:{select:{id:true,aplicativoPaiId:true,autorizadoPor:true,ativo:true,versao:true,readinessJson:true,limiteAlteracoes:true,participantes:{where:{habilitado:true},select:{aplicativoId:true,contaIdentidade:true}}}}}}} });
    return etapa;
  }

  async function validarChamada(tx:Tx, etapa:Reserva, app:string, escrita=false) {
    const config = etapa.execucao.configuracao;
    const membros=config.participantes.filter(p=>p.habilitado);
    if (!config.ativo || config.versao !== etapa.execucao.versaoConfiguracao || etapa.execucao.cancelamentoSolicitado || membros.length<2 || !membros.some(p=>p.aplicativoId===app)
      || membros.some(p=>!aplicativoElegivelSync(config,p.aplicativo))) {
      throw new FalhaSync("ESCOPO_ALTERADO", "A configuração ou a autorização mudou; execute uma nova auditoria.");
    }
    const agendada=etapa.execucao.origem==="AGENDADA", responsavel=agendada?config.autorizadoPor:etapa.execucao.solicitadoPor;
    if(!responsavel || !await tx.usuario.findFirst({where:{id:responsavel,aplicativoId:config.aplicativoPaiId,ativo:true,
      ...(agendada?{podeConfigurarSincronizacaoOlist:true}:{podeExecutarSincronizacaoOlist:true})},select:{id:true}})) {
      throw new FalhaSync("AUTORIZACAO_REVOGADA","A autorização do responsável não está mais válida.");
    }
    const job = escrita || etapa.fase === "APLICAR" ? JOBS_SYNC.aplicar : JOBS_SYNC.auditar;
    const global=await tx.configuracaoJob.findUnique({where:{chave:job.chave},select:{pausado:true}});
    if (!global || global.pausado || !aplicativoTemJob(config.aplicativoPai.jobs,job.flag)) throw new FalhaSync("JOB_PAUSADO", "O processamento desta etapa está pausado.");
    if (escrita) {
      const flags=objetoJson(config.readinessJson);
      if (flags.sincronizacaoNativaCompativel!==true || flags.semanticaPutValidada!==true) throw new FalhaSync("PRONTIDAO_PENDENTE", "Valide a sincronização nativa e o contrato de escrita antes de aplicar.");
    }
    return config;
  }

  async function contaPermitida(r:Reserva, app:string, escrita=false) {
    // A mesma conta é serializada entre consumidores. A janela reserva tempo para
    // a chamada em andamento, além do ritmo; é liberada apenas depois da resposta.
    return repo.comReserva(r, async (tx,atual) => {
      const config=await validarChamada(tx,atual,app,escrita);
      const participante=await tx.olistSyncParticipante.updateMany({where:{configuracaoId:config.id,aplicativoId:app,habilitado:true,OR:[{proximaChamadaEm:null},{proximaChamadaEm:{lte:agora()}}]},data:{proximaChamadaEm:new Date(agora().getTime()+120_000)}});
      if(participante.count!==1)throw new FalhaSync("AGUARDANDO_CONTA", "Aguarde a janela de chamadas desta conta.");
      return config;
    });
  }

  async function chamada<T>(r:Reserva, app:string, executar:()=>Promise<T>, escrita=false, identidadeVinculada=false):Promise<T> {
    const config=await contaPermitida(r,app,escrita);
    const inicio=agora().getTime();
    const auditoria = !escrita && !identidadeVinculada && ["LISTAR","DETALHAR"].includes(r.fase);
    let cota:CotaLeituraSync|null=null, limitada=false, retryAfterMs=0;
    try { const resposta=await executar();cota=cotaDaRespostaSync(resposta);return resposta; }
    catch(error) {
      if(error instanceof FalhaSync) {cota=cotaDaRespostaSync(error);limitada=error.status===429;retryAfterMs=error.retryAfterMs;}
      throw error;
    }
    finally {
      // Escrita inclui uma leitura de identidade com a mesma credencial: 6s + 12s.
      const intervalo=auditoria?esperaAuditoriaSync(cota,limitada,retryAfterMs):escrita?18_000:identidadeVinculada?12_000:6_000;
      const proxima=Math.max(agora().getTime(),(auditoria&&(cota||limitada)?agora().getTime():inicio)+intervalo,agora().getTime()+retryAfterMs);
      await repo.comReserva(r,async(tx,atual)=>{
        await tx.olistSyncParticipante.updateMany({where:{configuracaoId:config.id,aplicativoId:app},data:{proximaChamadaEm:new Date(proxima)}});
        if(auditoria && cota)await tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:{...objetoJson(atual.cursorJson),cotaLeitura:{...cota,observadaEm:agora().toISOString()}}},select:{id:true}});
      });
    }
  }

  async function pendencia(tx:Tx, entrada:{grupo:string;execucaoId:string;registroId?:string|null;aplicativoId?:string;entidade:string;tipo:string;chave:string;detalhes:JsonValue;severidade?:string}) {
    const c=criptografia(), chaveDedupe=c.hash(entrada.chave,`${entrada.grupo}:pendencia`);
    const anterior=await tx.olistSyncPendencia.findUnique({where:{configuracaoId_chaveDedupe:{configuracaoId:entrada.grupo,chaveDedupe}},select:{status:true,tipo:true,detalhesCriptografados:true}});
    if(anterior && ["IGNORADA","REJEITADA","APROVADA"].includes(anterior.status) && anterior.tipo===entrada.tipo && anterior.detalhesCriptografados &&
      serializarCanonico(c.decifrar(anterior.detalhesCriptografados,`${entrada.grupo}:pendencia:${chaveDedupe}`))===serializarCanonico(entrada.detalhes))return;
    const dados={registroId:entrada.registroId??null,aplicativoId:entrada.aplicativoId??null,execucaoId:entrada.execucaoId,entidade:entrada.entidade,tipo:entrada.tipo,severidade:entrada.severidade??"ALTA",
      detalhesCriptografados:c.cifrar(entrada.detalhes,`${entrada.grupo}:pendencia:${chaveDedupe}`)};
    await tx.olistSyncPendencia.upsert({where:{configuracaoId_chaveDedupe:{configuracaoId:entrada.grupo,chaveDedupe}},create:{configuracaoId:entrada.grupo,chaveDedupe,...dados},
      update:{...dados,status:"AGUARDANDO_REVISAO",versao:{increment:1},decididoEm:null,decididoPor:null},select:{id:true}});
  }

  async function gravarObservacao(tx:Tx, grupo:string, execucaoId:string, app:string, entidade:string, obs:ObservacaoRemota) {
    const c=criptografia(), anterior=await tx.olistSyncEstado.findUnique({where:{aplicativoId_entidade_remoteId:{aplicativoId:app,entidade,remoteId:obs.id}},select:{configuracaoId:true,registroId:true,chave:true,metadadosJson:true}});
    const vinculoManual=anterior?.configuracaoId===grupo && objetoJson(anterior.metadadosJson).vinculoManual===true && !!anterior.registroId && !!anterior.chave;
    const chave=vinculoManual?anterior.chave:obs.chave===null?null:entidade==="PRODUTO"?obs.chave:c.hash(obs.chave,`${grupo}:identidade:${entidade}`);
    const observada=vinculoManual?{...obs,chave:anterior.chave,pendencias:obs.pendencias.filter(p=>p!=="IDENTIDADE_AUSENTE_OU_INVALIDA"&&p!=="IDENTIDADE_REQUER_REVISAO")}:obs;
    const nome=entidade==="CONTATO"||entidade==="VENDEDOR"?"Cadastro protegido":obs.nome.slice(0,500);
    let registroId:string|null=vinculoManual?anterior.registroId:null;
    if (chave && !vinculoManual) {
      const registro=await tx.olistSyncRegistro.upsert({where:{configuracaoId_entidade_chave:{configuracaoId:grupo,entidade,chave}},create:{configuracaoId:grupo,entidade,chave,nome},update:{},select:{id:true}});
      const duplicado=await tx.olistSyncEstado.findFirst({where:{configuracaoId:grupo,registroId:registro.id,aplicativoId:app,remoteId:{not:obs.id}},select:{id:true}});
      if (!duplicado) registroId=registro.id;
    }
    await tx.olistSyncEstado.upsert({where:{aplicativoId_entidade_remoteId:{aplicativoId:app,entidade,remoteId:obs.id}},
      create:{configuracaoId:grupo,registroId,aplicativoId:app,entidade,remoteId:obs.id,chave,nome,situacaoRemota:obs.situacao,status:obs.completo?"DIVERGENTE":"NAO_VERIFICADO",
        hashesJson:gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)),metadadosJson:{completo:obs.completo,...(vinculoManual?{vinculoManual:true}:{})},dadosCriptografados:c.cifrar(jsonObservacao(observada),contextoEstado(grupo,app,entidade,obs.id)),ultimaExecucaoId:execucaoId,verificadoEm:agora()},
      update:{registroId,chave,nome,situacaoRemota:obs.situacao,status:obs.completo?"DIVERGENTE":"NAO_VERIFICADO",hashesJson:gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)),metadadosJson:{completo:obs.completo,...(vinculoManual?{vinculoManual:true}:{})},dadosCriptografados:c.cifrar(jsonObservacao(observada),contextoEstado(grupo,app,entidade,obs.id)),ultimaExecucaoId:execucaoId,verificadoEm:agora()},select:{id:true}});
    if (!chave) await pendencia(tx,{grupo,execucaoId,aplicativoId:app,entidade,tipo:"IDENTIDADE_REQUER_REVISAO",chave:`sem-chave:${app}:${entidade}:${obs.id}`,detalhes:{aplicativoId:app,remoteId:obs.id}});
  }

  async function listar(r:Reserva) {
    const e=await dadosReserva(r), app=e.aplicativoId!; const config=e.execucao.configuracao, cursor=objetoJson(e.cursorJson), entidade=entidadeSync(e.entidade);
    if (cursor.identidadeVerificada!==true) {
      const identidade=await chamada(r,app,()=>cliente.identidadeConta(app));
      const hash=criptografia().hash(identidade.documento,`${config.id}:conta`);
      await repo.comReserva(r,async tx=>{
        const conta=config.participantes.find(p=>p.aplicativoId===app);
        if (conta?.contaIdentidade && conta.contaIdentidade!==hash) throw new FalhaSync("CONTA_ALTERADA","A conexão aponta para outra conta Olist.");
        const outra=await tx.olistSyncParticipante.findFirst({where:{configuracaoId:config.id,habilitado:true,contaIdentidade:hash,aplicativoId:{not:app}},select:{id:true}});
        if (outra) throw new FalhaSync("CONTA_DUPLICADA","Dois aplicativos apontam para a mesma conta Olist.");
        await tx.olistSyncParticipante.update({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:app}},data:{contaIdentidade:hash},select:{id:true}});
      });
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{...cursor,identidadeVerificada:true}}); return;
    }
    // Passagem completa é deliberada até o filtro incremental ser validado por conta.
    const offset=typeof cursor.offset==="number"?cursor.offset:0;
    const pagina=await chamada(r,app,()=>cliente.listar(app,entidade,{offset,limit:100}));
    // Página curta não prova ausência quando o total ainda anuncia outros itens.
    if(pagina.total===null || (pagina.itens.length===0 && offset<pagina.total)) throw new FalhaSync("COBERTURA_INCOMPLETA","A listagem não comprova a cobertura completa dos cadastros.");
    const terminou=offset+pagina.itens.length>=pagina.total;
    const cota=cotaDaRespostaSync(pagina);
    const proximoCursor={...(terminou?{}:{identidadeVerificada:true,offset:offset+pagina.itens.length}),
      ...(cota?{cotaLeitura:{...cota,observadaEm:agora().toISOString()}}:{})};
    await repo.comReserva(r,async tx=>{
      for(const obs of pagina.itens) await gravarObservacao(tx,config.id,e.execucaoId,app,entidade,obs);
      await contar(tx,e.execucaoId,"listados",pagina.itens.length);
      await contar(tx,e.execucaoId,"analisados",pagina.itens.filter(item=>item.completo).length);
      await tx.olistSyncEtapa.update({where:{id:e.id},data:{...(terminou?{fase:"DETALHAR"}:{}),cursorJson:proximoCursor},select:{id:true}});
    });
    await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:proximoCursor});
  }

  async function detalhar(r:Reserva) {
    const e=await dadosReserva(r), app=e.aplicativoId!, grupo=e.execucao.configuracaoId, entidade=entidadeSync(e.entidade);
    const estado=await db.olistSyncEstado.findFirst({where:{configuracaoId:grupo,aplicativoId:app,entidade,ultimaExecucaoId:e.execucaoId,metadadosJson:{path:["completo"],equals:false}},orderBy:{id:"asc"},select:{remoteId:true}});
    if(estado) {
      const obs=await chamada(r,app,()=>cliente.detalhar(app,entidade,estado.remoteId));
      await repo.comReserva(r,async tx=>{await gravarObservacao(tx,grupo,e.execucaoId,app,entidade,obs);await contar(tx,e.execucaoId,"analisados");});
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{}}); return;
    }
    await repo.comReserva(r,async tx=>{
      await tx.olistSyncEtapa.update({where:{id:e.id},data:{status:"CONCLUIDA",leaseToken:null,leaseAte:null},select:{id:true}});
      const faltam=await tx.olistSyncEtapa.count({where:{execucaoId:e.execucaoId,entidade,fase:{in:["LISTAR","DETALHAR"]},status:{not:"CONCLUIDA"}}});
      if(!faltam) await tx.olistSyncEtapa.createMany({data:[{execucaoId:e.execucaoId,entidade,fase:"COMPARAR"}],skipDuplicates:true});
    });
  }

  async function comparar(r:Reserva) {
    const e=await dadosReserva(r), grupo=e.execucao.configuracaoId, entidade=entidadeSync(e.entidade), c=criptografia(), cursor=objetoJson(e.cursorJson);
    const registros=await db.olistSyncRegistro.findMany({where:{configuracaoId:grupo,entidade,...(typeof cursor.ultimoId==="string"?{id:{gt:cursor.ultimoId}}:{})},orderBy:{id:"asc"},take:25,
      select:{id:true,chave:true,nome:true,hashesBaseJson:true,revisao:true,origemRegistradaEm:true,origemTipo:true,aplicativoOrigemId:true}});
    for(const registro of registros) {
      const estados=await db.olistSyncEstado.findMany({where:{configuracaoId:grupo,entidade,chave:registro.chave,aplicativoId:{in:e.execucao.configuracao.participantes.map(p=>p.aplicativoId)}},orderBy:[{ultimaExecucaoId:"desc"},{id:"asc"}],take:201,select:selecaoEstado});
      const replicas:ReplicaComparacao[]=e.execucao.configuracao.participantes.map(p=>{
        const estado=estados.find(s=>s.aplicativoId===p.aplicativoId && s.ultimaExecucaoId===e.execucaoId)??estados.find(s=>s.aplicativoId===p.aplicativoId), atual=estado?.ultimaExecucaoId===e.execucaoId;
        const observacao=atual&&estado?.dadosCriptografados?observacaoProtegida(c.decifrar(estado.dadosCriptografados,contextoEstado(grupo,p.aplicativoId,entidade,estado.remoteId))):null;
        if(observacao && estados.filter(s=>s.aplicativoId===p.aplicativoId && s.ultimaExecucaoId===e.execucaoId).length>1) observacao.pendencias.push("IDENTIDADE_DUPLICADA");
        if(observacao && estados.length>200)observacao.pendencias.push("LIMITE_OBSERVACOES");
        return {aplicativoId:p.aplicativoId,observacao,existia:!!estado&&!atual};
      });
      if(entidade==="PRODUTO" && replicas.some(p=>!p.observacao) && registro.nome) {
        // pg_trgm usa o índice GIN; identidade continua sendo exclusivamente o SKU.
        const candidatos=await db.$queryRaw<{id:string}[]>`SELECT id FROM olist_sync_registro WHERE configuracao_id=${grupo}::uuid AND entidade='PRODUTO' AND chave<>${registro.chave} AND (nome % ${registro.nome} OR lower(btrim(chave))=lower(btrim(${registro.chave}))) AND (similarity(nome,${registro.nome})>=0.85 OR lower(btrim(chave))=lower(btrim(${registro.chave}))) LIMIT 1`;
        if(candidatos.length) for(const replica of replicas) replica.observacao?.pendencias.push("POSSIVEL_DUPLICIDADE");
      }
      const base=hashesJson(registro.hashesBaseJson);
      const decisao=avaliarReplicas({entidade,replicas,hashesBase:Object.keys(base).length?base:null,visaoCompleta:true,hash:v=>c.hash(v,`${grupo}:campo`)});
      await repo.comReserva(r,async tx=>{
        try {
        await tx.$queryRaw`SELECT id FROM olist_sync_registro WHERE id=${registro.id}::uuid FOR UPDATE`;
        const atual=await tx.olistSyncRegistro.findUniqueOrThrow({where:{id:registro.id},select:{revisao:true}});
        if(atual.revisao!==registro.revisao) {
          await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:registro.id,entidade,tipo:"REVISAO_ALTERADA",chave:`registro:${registro.id}`,detalhes:{revisaoEsperada:registro.revisao,revisaoAtual:atual.revisao}});return;
        }
        // Qualquer nova decisão substitui propostas ainda não enviadas, inclusive
        // quando a auditoria agora encontra conflito, equivalência ou payload inválido.
        await tx.olistSyncOperacao.updateMany({where:{registroId:registro.id,status:{in:["AUTORIZADA","PROPOSTA"]}},data:{status:"OBSOLETA"}});
        const revisao=registro.revisao+1;
        // Conflitos e equivalências também inauguram uma nova geração observada.
        // A confirmação de uma escrita anterior não pode sobrescrever essa decisão.
        await tx.olistSyncRegistro.update({where:{id:registro.id},data:{revisao},select:{id:true}});
        if(!registro.origemRegistradaEm) {
          const origem=inferirOrigem(replicas,true), remoto=replicas.find(p=>p.aplicativoId===origem.aplicativoId)?.observacao?.id;
          await tx.olistSyncRegistro.update({where:{id:registro.id},data:{origemTipo:origem.tipo,aplicativoOrigemId:origem.aplicativoId,registroOlistOrigemId:remoto,origemRegistradaEm:agora(),origemExecucaoId:e.execucaoId},select:{id:true}});
        }
        await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,entidade,chave:registro.chave,aplicativoId:{in:replicas.map(p=>p.aplicativoId)}},data:{status:decisao.status==="PROPAGAR"?"DIVERGENTE":decisao.status}});
        if(decisao.status==="AGUARDANDO_REVISAO") {
          const observacoes=Object.fromEntries(replicas.map(p=>[p.aplicativoId,p.observacao?{remoteId:p.observacao.id,hashes:gerarHashesCampos(p.observacao.campos,v=>c.hash(v,`${grupo}:campo`)),situacao:p.observacao.situacao}:null]));
          await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:registro.id,entidade,tipo:decisao.motivos[0]??"CONFLITO",chave:`registro:${registro.id}`,detalhes:{motivos:decisao.motivos,observacoes},severidade:decisao.motivos.some(m=>/DUPLIC|IDENTIDADE|PROTEGIDO/.test(m))?"CRITICA":"ALTA"});
          await contar(tx,e.execucaoId,"bloqueados");
          return;
        }
        if(decisao.status==="SINCRONIZADO") {
          await tx.olistSyncRegistro.update({where:{id:registro.id},data:{hashesBaseJson:decisao.hashes},select:{id:true}});
          await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,registroId:registro.id,status:"AGUARDANDO_REVISAO"},data:{status:"RESOLVIDA",decididoEm:agora()}});
          await contar(tx,e.execucaoId,"semAlteracao");
          return;
        }
        if(!decisao.campos)return;
        // Qualquer operação incerta permanece em quarentena mesmo numa nova auditoria.
        if(await tx.olistSyncOperacao.count({where:{registroId:registro.id,status:{in:["EM_APLICACAO","VERIFICANDO","RESULTADO_INCONCLUSIVO"]}}}))return;
        let payload:CamposSync;
        try { payload=prepararPayload(entidade,decisao.campos,{operacao:decisao.aplicativosCriar.length?"CRIAR":"ATUALIZAR"}); }
        catch(error) { await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:registro.id,entidade,tipo:error instanceof FalhaSync?error.codigo:"PAYLOAD_INVALIDO",chave:`registro:${registro.id}`,detalhes:{}});return; }
        void payload;
        for(const destino of [...decisao.aplicativosCriar,...decisao.aplicativosAtualizar]) {
          const id=randomUUID(), acao=decisao.aplicativosCriar.includes(destino)?"CRIAR":"ATUALIZAR";
          const observacaoDestino=replicas.find(p=>p.aplicativoId===destino)?.observacao;
          const hashesDestino=observacaoDestino?gerarHashesCampos(observacaoDestino.campos,v=>c.hash(v,`${grupo}:campo`)):base;
          const alterados=Object.keys(decisao.hashes).filter(campo=>decisao.hashes[campo]!==hashesDestino[campo]);
          const fontes=[...new Set(alterados.flatMap(campo=>decisao.fontesPorCampo[campo]??[]))].filter(a=>a!==destino).sort();
          const fonte=fontes[0]??replicas.find(p=>p.observacao)?.aplicativoId;
          if(!fonte)continue;
          const atuais=Object.fromEntries(replicas.map(p=>[p.aplicativoId,p.observacao?{remoteId:p.observacao.id,hashes:gerarHashesCampos(p.observacao.campos,v=>c.hash(v,`${grupo}:campo`))}:null]));
          await tx.olistSyncOperacao.create({data:{id,configuracaoId:grupo,registroId:registro.id,execucaoId:e.execucaoId,sourceAppId:fonte,destinoAppId:destino,acao,revisao,status:"AUTORIZADA",precondicoesJson:{replicas:atuais,fontesPorCampo:decisao.fontesPorCampo,contas:Object.fromEntries(e.execucao.configuracao.participantes.map(p=>[p.aplicativoId,p.contaIdentidade])),versaoConfiguracao:e.execucao.versaoConfiguracao},payloadCriptografado:c.cifrar(decisao.campos,contextoOperacao(grupo,id))},select:{id:true}});
        }
        } finally {
          // O cursor avança junto com a decisão: uma retomada não recria propostas já confirmadas.
          await tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:{ultimoId:registro.id}},select:{id:true}});
        }
      });
    }
    if(registros.length===25) {await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{ultimoId:registros[24].id}});return;}
    await repo.comReserva(r,async tx=>{
      if(e.execucao.modo==="AUDITAR_E_APLICAR") {
        for(const p of e.execucao.configuracao.participantes) await tx.olistSyncEtapa.createMany({data:[{execucaoId:e.execucaoId,entidade,aplicativoId:p.aplicativoId,fase:"APLICAR"}],skipDuplicates:true});
      }
      await tx.olistSyncEtapa.update({where:{id:e.id},data:{status:"CONCLUIDA",leaseToken:null,leaseAte:null},select:{id:true}});
    });
  }

  async function aplicar(r:Reserva) {
    const e=await dadosReserva(r), grupo=e.execucao.configuracaoId, app=e.aplicativoId!, entidade=entidadeSync(e.entidade), c=criptografia(), cursor=objetoJson(e.cursorJson);
    const operacao=await db.olistSyncOperacao.findFirst({where:{configuracaoId:grupo,destinoAppId:app,registro:{entidade},...(typeof cursor.operacaoId==="string"?{id:cursor.operacaoId,status:{in:["AUTORIZADA","EM_APLICACAO","VERIFICANDO","RESULTADO_INCONCLUSIVO"]}}:{OR:[{status:{in:["AUTORIZADA","EM_APLICACAO","VERIFICANDO"]}},{status:"RESULTADO_INCONCLUSIVO",execucaoId:{not:e.execucaoId}}]})},orderBy:{id:"asc"},
      select:{id:true,registroId:true,sourceAppId:true,revisao:true,status:true,acao:true,tentativas:true,precondicoesJson:true,payloadCriptografado:true,remoteId:true,registro:{select:{revisao:true}}}});
    const checkpoint=(valor:CamposSync)=>repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:valor});
    if(!operacao) {await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{},...(typeof cursor.operacaoId==="string"?{}:{status:"CONCLUIDA"})});return;}
    const plan=objetoJson(operacao.precondicoesJson), replicas=objetoJson(plan.replicas);
    const reconciliando=operacao.status!=="AUTORIZADA";
    const campos=operacao.payloadCriptografado?objetoJson(c.decifrar(operacao.payloadCriptografado,contextoOperacao(grupo,operacao.id))):null;
    const bloquear=async(codigo:string,status="OBSOLETA")=>{
      await repo.comReserva(r,async tx=>{
        await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status,erroCodigo:codigo,...(reconciliando?{execucaoId:e.execucaoId}:{})},select:{id:true}});
        await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:operacao.registroId,aplicativoId:app,entidade,tipo:codigo,chave:`operacao:${operacao.id}`,detalhes:{operacaoId:operacao.id}});
      });
      await checkpoint({});
    };
    // Reconciliação apura um efeito já enviado; uma revisão nova não apaga essa incerteza.
    if(!campos || !reconciliando&&(operacao.registro.revisao!==operacao.revisao || plan.versaoConfiguracao!==e.execucao.versaoConfiguracao)) {await bloquear("PROPOSTA_OBSOLETA",reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
    if(operacao.status==="AUTORIZADA") {
      const total=await db.olistSyncOperacao.count({where:{configuracaoId:grupo,destinoAppId:app,registro:{entidade},status:"AUTORIZADA"}});
      if(total>e.execucao.configuracao.limiteAlteracoes) {
        await repo.comReserva(r,async tx=>{
          await tx.olistSyncOperacao.updateMany({where:{configuracaoId:grupo,destinoAppId:app,registro:{entidade},status:"AUTORIZADA"},data:{status:"PROPOSTA",erroCodigo:"LIMITE_ALTERACOES"}});
          await pendencia(tx,{grupo,execucaoId:e.execucaoId,aplicativoId:app,entidade,tipo:"LIMITE_ALTERACOES",chave:`limite:${e.execucaoId}:${app}:${entidade}`,detalhes:{quantidade:total,limite:e.execucao.configuracao.limiteAlteracoes}});
        });
        await checkpoint({});return;
      }
    }
    const fontes=Object.keys(replicas).filter(id=>id!==app && replicas[id]!==null).sort();
    // Orçamento limitado pelo grupo (até 20 filhos), incluindo as leituras de
    // identidade. O destino continua sendo revalidado por último antes do envio.
    const janelaValidacaoMs=Math.max(120_000,(fontes.length+2)*12_000);
    const fase=reconciliando?"VERIFICAR":typeof cursor.fase==="string"?cursor.fase:"FONTES";
    const hashesEsperados=gerarHashesCampos(campos,v=>c.hash(v,`${grupo}:campo`));
    const identidadeEsperada=(alvo:string)=>objetoJson(plan.contas)[alvo]??e.execucao.configuracao.participantes.find(p=>p.aplicativoId===alvo)?.contaIdentidade;
    const protegerConsulta=(alvo:string)=>({
      validarConta:(identidade:{documento:string})=>c.hash(identidade.documento,`${grupo}:conta`)===identidadeEsperada(alvo),
      antesDeConsultar:async()=>{
        await aguardar(6_000);
        await repo.comReserva(r,(tx,atual)=>validarChamada(tx,atual,alvo));
      },
    });
    async function consultar<T>(alvo:string, executar:()=>Promise<T>):Promise<T|null> {
      try { return await chamada(r,alvo,executar,false,true); }
      catch(error) {
        if(!(error instanceof FalhaSync) || error.codigo!=="CONTA_ALTERADA")throw error;
        await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return null;
      }
    }
    const observacaoPermitida=(obs:ObservacaoRemota)=>obs.completo && obs.chave===(entidade==="PRODUTO"?campos.sku:campos.cpfCnpj)
      && (entidade==="PRODUTO"?obs.situacao==="A":["A","B"].includes(obs.situacao))
      && !obs.pendencias.some(p=>!p.startsWith("REFERENCIA_")&&p!=="IMAGENS_REQUEREM_VALIDACAO");
    if(fase==="CONTAS") {
      // Compatibilidade com checkpoints antigos: cada consulta agora valida sua
      // própria credencial, em vez de confiar numa identidade lida em outra etapa.
      await checkpoint({operacaoId:operacao.id,fase:"FONTES"});return;
    }
    if(fase==="FONTES") {
      const indice=typeof cursor.indice==="number"?cursor.indice:0, fonte=fontes[indice];
      if(fonte) {
        const anterior=objetoJson(replicas[fonte]);
        if(typeof anterior.remoteId!=="string") {await bloquear("FONTE_INVALIDA");return;}
        const obs=await consultar(fonte,()=>cliente.detalhar(fonte,entidade,anterior.remoteId as string,protegerConsulta(fonte)));
        if(!obs)return;
        const hashes=serializarCanonico(gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)));
        // Outra réplica pode já ter recebido a mesma revisão. Aceitar apenas o
        // snapshot original ou o alvo exato mantém bloqueadas mudanças divergentes.
        if(!observacaoPermitida(obs) || hashes!==serializarCanonico(hashesJson(anterior.hashes))&&hashes!==serializarCanonico(hashesEsperados)) {await bloquear("FONTE_ALTERADA");return;}
        await checkpoint({operacaoId:operacao.id,fase:indice+1<fontes.length?"FONTES":"DESTINO",indice:indice+1,iniciadaEm:typeof cursor.iniciadaEm==="number"?cursor.iniciadaEm:agora().getTime()});return;
      }
      await checkpoint({operacaoId:operacao.id,fase:"DESTINO",iniciadaEm:agora().getTime()});return;
    }
    if(fase==="DESTINO") {
      const anterior=objetoJson(replicas[app]);
      if(operacao.acao==="CRIAR") {
        const chave=entidade==="PRODUTO"?campos.sku:campos.cpfCnpj;
        if(typeof chave!=="string") {await bloquear("IDENTIDADE_INVALIDA");return;}
        const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,entidade,chave,protegerConsulta(app)));
        if(!encontrados)return;
        if(encontrados.length) {
          if(encontrados.length!==1) {await bloquear("IDENTIDADE_DUPLICADA");return;}
          await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"VERIFICANDO",remoteId:encontrados[0].id},select:{id:true}}));
          await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});return;
        }
      } else {
        if(typeof anterior.remoteId!=="string") {await bloquear("DESTINO_INVALIDO");return;}
        const obs=await consultar(app,()=>cliente.detalhar(app,entidade,anterior.remoteId as string,protegerConsulta(app)));
        if(!obs)return;
        if(!observacaoPermitida(obs) || serializarCanonico(gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)))!==serializarCanonico(hashesJson(anterior.hashes))) {await bloquear("DESTINO_ALTERADO");return;}
      }
      await checkpoint({operacaoId:operacao.id,fase:"ESCREVER",iniciadaEm:cursor.iniciadaEm??agora().getTime()});return;
    }
    if(fase==="ESCREVER") {
      if(typeof cursor.iniciadaEm!=="number" || agora().getTime()-cursor.iniciadaEm>janelaValidacaoMs) {await bloquear("JANELA_VALIDACAO_EXCEDIDA");return;}
      const payload=prepararPayload(entidade,campos,{operacao:operacao.acao==="CRIAR"?"CRIAR":"ATUALIZAR"});
      const anterior=objetoJson(replicas[app]);
      let envioIniciado=false;
      try {
        const resultado=await chamada(r,app,async()=>{
          const protecao={
            validarConta:(identidade:{documento:string})=>c.hash(identidade.documento,`${grupo}:conta`)===identidadeEsperada(app),
            antesDeEscrever:async()=>{
              await aguardar(6_000);
              await repo.comReserva(r,async(tx,atual)=>{
                await validarChamada(tx,atual,app,true);
                if(agora().getTime()-Number(cursor.iniciadaEm)>janelaValidacaoMs)throw new FalhaSync("JANELA_VALIDACAO_EXCEDIDA","Revalide os cadastros antes de escrever.");
                const marcada=await tx.olistSyncOperacao.updateMany({where:{id:operacao.id,status:"AUTORIZADA",registro:{revisao:operacao.revisao}},data:{status:"EM_APLICACAO",execucaoId:e.execucaoId,tentativas:{increment:1}}});
                if(marcada.count!==1)throw new FalhaSync("PROPOSTA_OBSOLETA","A proposta mudou antes de enviar a escrita.");
              });
              envioIniciado=true;
            },
          };
          return operacao.acao==="CRIAR"?cliente.criar(app,entidade,payload,protecao):cliente.atualizar(app,entidade,String(anterior.remoteId),payload,protecao);
        },true);
        await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"VERIFICANDO",remoteId:resultado.id??(typeof anterior.remoteId==="string"?anterior.remoteId:null)},select:{id:true}}));
        await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});
      } catch(error) {
        if(error instanceof FalhaSync && ["JOB_PAUSADO","AGUARDANDO_CONTA","PRONTIDAO_PENDENTE","LEASE_PERDIDA"].includes(error.codigo))throw error;
        if(!envioIniciado) {
          // Falhas da leitura/guard anterior ao envio usam as tentativas da etapa;
          // não zerar o contador em checkpoints nem inventar uma escrita incerta.
          if(error instanceof FalhaSync && !error.recuperavel) {await bloquear(error.codigo);return;}
          throw error;
        }
        // Uma resposta incerta nunca volta à fila de POST/PUT. Só leitura/reconciliação.
        if(error instanceof FalhaSync && !error.inconclusivo && error.recuperavel && operacao.tentativas+1<5) {
          await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"AUTORIZADA",erroCodigo:error.codigo},select:{id:true}}));
          await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{operacaoId:operacao.id,fase:"CONTAS"},disponivelEm:prazoRetrySync(operacao.tentativas+1,agora(),error.retryAfterMs)});return;
        }
        if(error instanceof FalhaSync && !error.inconclusivo) {await bloquear(error.codigo,"FALHA_PERMANENTE");return;}
        await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"RESULTADO_INCONCLUSIVO",erroCodigo:"RESPOSTA_INCERTA"},select:{id:true}}));
        await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});
      }
      return;
    }
    let remotoId=operacao.remoteId;
    if(!remotoId) {
      const chave=entidade==="PRODUTO"?campos.sku:campos.cpfCnpj;
      if(typeof chave!=="string") {await bloquear("RESULTADO_INCONCLUSIVO","RESULTADO_INCONCLUSIVO");return;}
      const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,entidade,chave,protegerConsulta(app)));
      if(!encontrados)return;
      if(encontrados.length!==1) {await bloquear("RESULTADO_INCONCLUSIVO","RESULTADO_INCONCLUSIVO");return;}
      remotoId=encontrados[0].id;
      await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{remoteId:remotoId,status:"VERIFICANDO"},select:{id:true}}));
      await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});return;
    }
    const observado=await consultar(app,()=>cliente.detalhar(app,entidade,remotoId!,protegerConsulta(app)));
    if(!observado)return;
    const obtidos=gerarHashesCampos(observado.campos,v=>c.hash(v,`${grupo}:campo`));
    if(!observacaoPermitida(observado) || Object.keys(hashesEsperados).some(campo=>hashesEsperados[campo]!==obtidos[campo])) {await bloquear("VERIFICACAO_DIVERGENTE","RESULTADO_INCONCLUSIVO");return;}
    await repo.comReserva(r,async tx=>{
      await tx.$queryRaw`SELECT id FROM olist_sync_registro WHERE id=${operacao.registroId}::uuid FOR UPDATE`;
      const registro=await tx.olistSyncRegistro.findUniqueOrThrow({where:{id:operacao.registroId},select:{revisao:true}});
      const revisaoAtual=registro.revisao===operacao.revisao;
      if(revisaoAtual) {
        await gravarObservacao(tx,grupo,e.execucaoId,app,entidade,observado);
        await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,registroId:operacao.registroId,aplicativoId:app},data:{status:"SINCRONIZADO",revisaoAplicada:operacao.revisao,ultimaFonteAppId:operacao.sourceAppId}});
        await tx.olistSyncRegistro.update({where:{id:operacao.registroId},data:{ultimaFonteAppId:operacao.sourceAppId},select:{id:true}});
      }
      await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"CONFIRMADA",confirmadaEm:agora(),erroCodigo:null},select:{id:true}});
      const faltantes=await tx.olistSyncOperacao.count({where:{registroId:operacao.registroId,revisao:operacao.revisao,status:{not:"CONFIRMADA"}}});
      if(!faltantes&&revisaoAtual) {
        await tx.olistSyncRegistro.update({where:{id:operacao.registroId},data:{hashesBaseJson:hashesEsperados},select:{id:true}});
        await tx.olistSyncEstado.updateMany({where:{registroId:operacao.registroId,aplicativoId:{in:e.execucao.configuracao.participantes.map(p=>p.aplicativoId)},hashesJson:{equals:hashesEsperados}},data:{status:"SINCRONIZADO",revisaoAplicada:operacao.revisao}});
      }
      await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,chaveDedupe:c.hash(`operacao:${operacao.id}`,`${grupo}:pendencia`),status:"AGUARDANDO_REVISAO"},data:{status:"RESOLVIDA",decididoEm:agora()}});
      await tx.olistSyncEvento.create({data:{configuracaoId:grupo,execucaoId:e.execucaoId,registroId:operacao.registroId,tipo:"ESCRITA_CONFIRMADA",metadadosJson:{operacaoId:operacao.id,sourceAppId:operacao.sourceAppId,destinoAppId:app,revisao:operacao.revisao,acao:operacao.acao,fontesPorCampo:plan.fontesPorCampo??{}}},select:{id:true}});
      await contar(tx,e.execucaoId,operacao.acao==="CRIAR"?"criados":"atualizados");
    });
    await checkpoint({});
  }

  async function processar(r:Reserva) {
    try {
      const e=await dadosReserva(r);
      if(e.fase==="LISTAR")await listar(r);
      else if(e.fase==="DETALHAR")await detalhar(r);
      else if(e.fase==="COMPARAR")await comparar(r);
      else if(e.fase==="APLICAR")await aplicar(r);
      else throw new FalhaSync("ETAPA_INVALIDA","Etapa não suportada.");
    } catch(error) {
      const falha=error instanceof FalhaSync?error:new FalhaSync("FALHA_INTERNA","Falha ao processar a etapa.",true);
      if(["AGUARDANDO_CONTA","JOB_PAUSADO"].includes(falha.codigo)) {
        const e=await dadosReserva(r);
        await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:objetoJson(e.cursorJson),disponivelEm:new Date(agora().getTime()+10_000)});
      } else if(falha.codigo==="PRONTIDAO_PENDENTE") {
        await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{},status:"CONCLUIDA"});
      } else {
        await repo.falharEtapa(r,falha.codigo,falha.recuperavel?prazoRetrySync(r.tentativas,agora(),falha.retryAfterMs).getTime()-agora().getTime():null);
      }
    }
    await repo.concluirExecucaoQuandoPossivel(r.execucaoId);
  }

  async function agendar() {
    const configs=await db.olistSyncConfiguracao.findMany({where:{ativo:true,OR:[{proximaExecucaoEm:null},{proximaExecucaoEm:{lte:agora()}}]},orderBy:{id:"asc"},take:20,select:{id:true,horaDiaria:true,timezone:true,autorizadoPor:true,proximaExecucaoEm:true}});
    let agendadas=0;
    for(const config of configs) {
      if(!(await repo.disponibilidade(config.id,"agendar-sincronizacao-olist")).habilitado)continue;
      if(!config.proximaExecucaoEm) {await db.olistSyncConfiguracao.update({where:{id:config.id},data:{proximaExecucaoEm:proximoHorarioSync(agora(),config.horaDiaria,config.timezone)},select:{id:true}});continue;}
      try {
        await repo.enfileirar({configuracaoId:config.id,modo:"AUDITAR_E_APLICAR",idempotencia:idAgendamento(config.id,config.proximaExecucaoEm),solicitadoPor:config.autorizadoPor,origem:"AGENDADA",completa:true});
        await db.olistSyncConfiguracao.updateMany({where:{id:config.id,proximaExecucaoEm:config.proximaExecucaoEm},data:{proximaExecucaoEm:proximoHorarioSync(agora(),config.horaDiaria,config.timezone)}}); agendadas++;
      } catch { /* Outra execução ativa ou controle pausado: não perde a data pendente. */ }
    }
    return agendadas;
  }

  async function executar(prazo=agora().getTime()+240_000) {
    const agendadas=await agendar(); let etapas=0;
    // Reserva também OAuth inicial, uma renovação após 401 e duas consultas de 20s.
    // Uma etapa iniciada perto do fim não pode ultrapassar o orçamento do cron.
    const margemEtapaMs=120_000;
    while(agora().getTime()<prazo-margemEtapaMs) {
      const r=await repo.reservarEtapa({agora:agora(),leaseMs:180_000});
      if(!r) {
        const proxima=await repo.proximaJanelaEtapa({agora:agora(),limiteMs:12_000});
        const espera=proxima?Math.ceil(proxima.getTime()-agora().getTime()):0;
        // Só uma janela curta de trabalho já elegível mantém a invocação viva.
        // Pausas, fila vazia, retries longos e falta de orçamento terminam sem polling.
        if(espera<=0 || espera>12_000 || agora().getTime()+espera>=prazo-margemEtapaMs)break;
        await aguardar(espera);
        continue;
      }
      await processar(r); etapas++;
    }
    const limpar=await db.olistSyncConfiguracao.findMany({where:{OR:[{ultimaLimpezaEm:null},{ultimaLimpezaEm:{lt:new Date(agora().getTime()-86_400_000)}}]},orderBy:{id:"asc"},take:5,select:{id:true}});
    for(const config of limpar) {
      if(agora().getTime()+25_000>=prazo)break;
      await repo.limparHistorico(config.id);
    }
    return {agendadas,etapas};
  }
  return {processar,executar,agendar};
}
