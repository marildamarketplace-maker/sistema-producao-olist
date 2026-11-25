import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { criarOlistSyncRepository, JOBS_SYNC, type ControleEtapaSync } from "@/repositories/olist-sync-repository";
import { aplicativoTemJob } from "@/lib/aplicativo-jobs";
import { aplicativoElegivelSync } from "@/lib/olist-sync/elegibilidade";
import { criarCriptografiaSync, serializarCanonico } from "@/lib/olist-sync/cripto";
import { avaliarReplicas, chaveContatoPorNome, chaveContatoSync, gerarHashesCampos, inferirOrigem, prepararPayload } from "@/lib/olist-sync/dominio";
import { CAPACIDADES_SYNC, FalhaSync, type ClienteSync, type CamposSync, type EntidadeSync, type JsonValue, type ObservacaoRemota, type OpcoesConsultaSync, type ReplicaComparacao } from "@/lib/olist-sync/contrato";
import { entidadeSync, hashesJson, objetoJson, observacaoProtegida, proximoHorarioSync, prazoRetrySync } from "@/lib/olist-sync/validacao";
import { cotaDaRespostaSync, proximaChamadaAplicacaoSync, proximaLeituraAuditoriaSync, type CotaLeituraSync } from "@/lib/olist-sync/ritmo";
import { selecionarPlanoColeta, fecharCobertura, marcarAfetadosSync, transferirAfetadosPendentes, marcarPropostasDesatualizadas } from "@/repositories/olist-sync-cobertura-repository";
import { assinaturaEscopoSync, lerPlanoColeta } from "@/lib/olist-sync/incremental";
import { lerCatalogoTiposContatoSync, MAXIMO_TIPOS_CONTATO, payloadTiposContatoSync, resolverTiposContatoSync, VALIDADE_CATALOGO_TIPOS_MS, VERSAO_OBSERVACAO_CONTATO, type CatalogoTiposContatoSync } from "@/lib/olist-sync/tipos-contato";
import { nomeProdutoElegivelSync, primeiraEscritaProdutoSync, producaoCanonicaSync, VERSAO_PRODUTOS_SYNC } from "@/lib/olist-sync/produtos";

import { PENDENCIAS_VENDEDOR_CONTATO, chaveBaseVendedorContato, lerCatalogoVendedoresContatoSync, MAXIMO_VENDEDORES_CONTATO, VALIDADE_CATALOGO_VENDEDORES_MS, resolverVendedorContatoSync, idVendedorPorNomeSync, ehBaseVendedorContato, type CatalogoVendedoresContatoSync } from "@/lib/olist-sync/vendedores-contato";
import { chaveServicoSync, nomeServicoSync } from "@/lib/olist-sync/servicos";

type Tx = Prisma.TransactionClient;
type Repo = ReturnType<typeof criarOlistSyncRepository>;
type Reserva = NonNullable<Awaited<ReturnType<Repo["reservarEtapa"]>>>;
type Cripto = ReturnType<typeof criarCriptografiaSync>;
const selecaoEstado = { id:true, registroId:true, aplicativoId:true, remoteId:true, chave:true, dadosCriptografados:true, ultimaExecucaoId:true, hashesJson:true, metadadosJson:true, presente:true, detalhePendente:true, fingerprint:true } as const;
const jsonObservacao = (o: ObservacaoRemota): CamposSync => ({ id:o.id,chave:o.chave,nome:o.nome,situacao:o.situacao,alteradoEm:o.alteradoEm,completo:o.completo,campos:o.campos,pendencias:o.pendencias,...(o.vendedorContatoRemoto!==undefined?{vendedorContatoRemoto:o.vendedorContatoRemoto?{...o.vendedorContatoRemoto}:null}:{}),...(o.tipo?{tipo:o.tipo}:{}),...(o.paiId?{paiId:o.paiId}:{}),...(o.tiposContatoRemotos?{tiposContatoRemotos:o.tiposContatoRemotos.map(tipo=>({...tipo}))}:{}) });
const contextoEstado = (grupo:string, app:string, entidade:string, id:string) => `${grupo}:estado:${app}:${entidade}:${id}`;
const contextoOperacao = (grupo:string,id:string) => `${grupo}:operacao:${id}`;
// A data remota pode mudar sem alterar o cadastro sincronizável. Identidade,
// estrutura, situação e impedimentos também compõem a decisão, além dos campos.
const conteudoObservacao = (o:ObservacaoRemota):CamposSync => ({...jsonObservacao(o),alteradoEm:null,pendencias:[...o.pendencias].sort()});
const idAgendamento = (grupo:string, prevista:Date) => {
  const hash=createHash("sha256").update(`olist-sync:${grupo}:${prevista.toISOString()}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
};

export function criarServicoOlistSync(db: PrismaClient, cliente: ClienteSync, opcoes: { agora?:()=>Date; aguardar?:(ms:number)=>Promise<void>; cripto?:Cripto } = {}) {
  const persistencia = criarOlistSyncRepository(db);
  const repo = { ...persistencia,
    async comReserva<T>(reserva:Pick<Reserva,"id"|"leaseToken">, executar:(tx:Tx,atual:ControleEtapaSync)=>Promise<T>) {
      const resultado=await persistencia.comControle(reserva,executar);
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
  const chamadasAtivas = new Map<string, { inicio: number; proxima: number; observada: boolean }>();
  // O mutex durável da conta envolve todos os HTTP, inclusive /info. O mapa só
  // acompanha a chamada reservada; não guarda tokens nem substitui o mutex.
  function ritmoTransporte(app: string): Pick<OpcoesConsultaSync, "antesDeRequisicao" | "aposResposta"> {
    return {
      antesDeRequisicao: async () => {
        const ritmo = chamadasAtivas.get(app);
        if (!ritmo) throw new FalhaSync("LEASE_PERDIDA", "A chamada não possui reserva ativa.");
        const espera = Math.max(0, ritmo.proxima - agora().getTime());
        if (espera > 12_000) throw new FalhaSync("COTA_OLIST", "Aguarde a liberação da cota Olist.", true, false, null, espera);
        if (espera) await aguardar(espera);
        ritmo.inicio = agora().getTime();
      },
      aposResposta: (metodo, resposta) => {
        const ritmo = chamadasAtivas.get(app);
        if (!ritmo) return;
        ritmo.observada = true;
        ritmo.proxima = proximaChamadaAplicacaoSync(ritmo.inicio, agora().getTime(), resposta.cotaLeitura ?? null,
          metodo !== "GET", resposta.status === 429, resposta.retryAfterMs);
      },
    };
  }

  async function contar(tx:Tx, execucaoId:string, campo:string, quantidade=1) {
    await tx.$executeRaw`UPDATE olist_sync_execucao SET contadores_json=jsonb_set(coalesce(contadores_json,'{}'::jsonb),ARRAY[${campo}],to_jsonb(coalesce((contadores_json->>${campo})::integer,0)+${quantidade}::integer),true) WHERE id=${execucaoId}::uuid`;
  }

  async function dadosReserva(r: Reserva) {
    const etapa = await db.olistSyncEtapa.findUniqueOrThrow({ where:{id:r.id}, select:{ id:true,execucaoId:true,entidade:true,aplicativoId:true,fase:true,cursorJson:true,leaseAte:true,
      execucao:{select:{id:true,configuracaoId:true,modo:true,origem:true,completa:true,versaoConfiguracao:true,solicitadoPor:true,cancelamentoSolicitado:true,
        configuracao:{select:{id:true,aplicativoPaiId:true,autorizadoPor:true,ativo:true,versao:true,readinessJson:true,limiteAlteracoes:true,participantes:{where:{habilitado:true},select:{aplicativoId:true,contaIdentidade:true}}}}}}} });
    return etapa;
  }
  type DadosReserva = Awaited<ReturnType<typeof dadosReserva>>;

  async function validarChamada(tx:Tx, etapa:ControleEtapaSync, app:string, escrita=false) {
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
      if(participante.count!==1) {
        const janela=await tx.olistSyncParticipante.findUnique({where:{configuracaoId_aplicativoId:{configuracaoId:config.id,aplicativoId:app}},select:{proximaChamadaEm:true}});
        throw new FalhaSync("AGUARDANDO_CONTA", "Aguarde a janela de chamadas desta conta.",true,false,null,Math.max(250,(janela?.proximaChamadaEm?.getTime()??agora().getTime()+10_000)-agora().getTime()));
      }
      return config;
    });
  }

  async function chamada<T>(r:Reserva, app:string, executar:()=>Promise<T>, escrita=false, identidadeVinculada=false):Promise<T> {
    const config=await contaPermitida(r,app,escrita);
    const inicio=agora().getTime();
    chamadasAtivas.set(app,{inicio,proxima:inicio,observada:false});
    const auditoria = !escrita && !identidadeVinculada && ["LISTAR","DETALHAR"].includes(r.fase);
    let cota:CotaLeituraSync|null=null, limitada=false, retryAfterMs=0;
    try { const resposta=await executar();cota=cotaDaRespostaSync(resposta);return resposta; }
    catch(error) {
      if(error instanceof FalhaSync) {cota=cotaDaRespostaSync(error);limitada=error.status===429;retryAfterMs=error.retryAfterMs;}
      throw error;
    }
    finally {
      const respostaEm=agora().getTime();
      const transporte=chamadasAtivas.get(app);
      const proxima=auditoria?proximaLeituraAuditoriaSync(inicio,respostaEm,cota,limitada,retryAfterMs)
        :Math.max(transporte?.observada?transporte.proxima:proximaChamadaAplicacaoSync(inicio,respostaEm,cota,escrita,limitada,retryAfterMs),respostaEm+retryAfterMs);
      chamadasAtivas.delete(app);
      await repo.comReserva(r,async(tx,atual)=>{
        await tx.olistSyncParticipante.updateMany({where:{configuracaoId:config.id,aplicativoId:app},data:{proximaChamadaEm:new Date(proxima)}});
        if(auditoria && cota)await tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:{...objetoJson(atual.cursorJson),cotaLeitura:{...cota,observadaEm:agora().toISOString()}}},select:{id:true}});
      });
    }
  }

  // Uma página por checkpoint: catálogo pequeno, durável e isolado por conta.
  // As leituras protegidas reutilizam a mesma credencial para /info e o recurso.
  async function paginaTipos(r:Reserva, app:string, grupo:string, conta:string, anterior:CatalogoTiposContatoSync|null):Promise<CatalogoTiposContatoSync> {
    if(!cliente.listarTiposContato)throw new FalhaSync("TIPOS_CONTATO_NAO_MAPEADOS","O cliente não oferece o catálogo de tipos de contato.");
    const pagina=await chamada(r,app,()=>cliente.listarTiposContato!(app,{offset:anterior?.offset??0,limit:100},{
      ...ritmoTransporte(app), reutilizarIdentidade:true,
      validarConta:identidade=>criptografia().hash(identidade.documento,`${grupo}:conta`)===conta,
      antesDeConsultar:async()=>{await repo.comReserva(r,(tx,atual)=>validarChamada(tx,atual,app));},
    }),false,true);
    const itens=[...(anterior?.itens??[]),...pagina.itens], total=pagina.total;
    if(!Number.isSafeInteger(total)||total<0||total>MAXIMO_TIPOS_CONTATO||itens.length>total || !pagina.itens.length&&itens.length<total || anterior&&anterior.total!==total || new Set(itens.map(tipo=>tipo.id)).size!==itens.length)
      throw new FalhaSync("CATALOGO_TIPOS_INCONSISTENTE","O catálogo de tipos mudou ou retornou páginas inconsistentes.");
    const resultado=lerCatalogoTiposContatoSync({contaIdentidade:conta,coletadoEm:anterior?.coletadoEm??agora().toISOString(),offset:itens.length,total,itens},conta);
    if(!resultado)throw new FalhaSync("CATALOGO_TIPOS_INCONSISTENTE","O catálogo de tipos de contato é inválido.");
    return resultado;
  }

  async function garantirTiposAuditoria(r:Reserva, e:Awaited<ReturnType<typeof dadosReserva>>, cursor:CamposSync):Promise<CatalogoTiposContatoSync|null> {
    if(e.entidade!=="CONTATO")return null;
    const app=e.aplicativoId!, grupo=e.execucao.configuracaoId, conta=e.execucao.configuracao.participantes.find(p=>p.aplicativoId===app)?.contaIdentidade;
    if(!conta)throw new FalhaSync("CONTA_NAO_VERIFICADA","Confirme a conta antes de consultar seus tipos.");
    const catalogo=lerCatalogoTiposContatoSync(cursor.catalogoTiposContato,conta);
    if(catalogo && catalogo.offset===catalogo.total)return catalogo;
    const proximo=await paginaTipos(r,app,grupo,conta,catalogo);
    await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{...cursor,catalogoTiposContato:{...proximo}}});
    return null;
  }

  // Nomes de vendedores são dados pessoais: o catálogo durável é cifrado.
  const contextoVendedores=(grupo:string,app:string)=>`${grupo}:catalogo-vendedores:${app}`;
  function lerVendedores(valor:JsonValue|undefined,grupo:string,app:string,conta:string):CatalogoVendedoresContatoSync|null {
    if(typeof valor!=="string")return null;
    return lerCatalogoVendedoresContatoSync(criptografia().decifrar(valor,contextoVendedores(grupo,app)),conta);
  }
  async function paginaVendedores(r:Reserva,app:string,grupo:string,conta:string,anterior:CatalogoVendedoresContatoSync|null):Promise<CatalogoVendedoresContatoSync> {
    if(!cliente.listarVendedoresContato)throw new FalhaSync("VENDEDOR_CONTATO_NAO_MAPEADO","O cliente não oferece o catálogo de vendedores.");
    const pagina=await chamada(r,app,()=>cliente.listarVendedoresContato!(app,{offset:anterior?.offset??0,limit:100},{
      ...ritmoTransporte(app),reutilizarIdentidade:true,
      validarConta:identidade=>criptografia().hash(identidade.documento,`${grupo}:conta`)===conta,
      antesDeConsultar:async()=>{await repo.comReserva(r,(tx,atual)=>validarChamada(tx,atual,app));},
    }),false,true);
    const itens=[...(anterior?.itens??[]),...pagina.itens],total=pagina.total;
    const proximo=lerCatalogoVendedoresContatoSync({contaIdentidade:conta,coletadoEm:anterior?.coletadoEm??agora().toISOString(),offset:itens.length,total,itens},conta);
    if(!proximo || total>MAXIMO_VENDEDORES_CONTATO || !pagina.itens.length&&itens.length<total || anterior&&anterior.total!==total)
      throw new FalhaSync("CATALOGO_VENDEDORES_INCONSISTENTE","O catálogo de vendedores mudou ou não comprova cobertura completa.");
    return proximo;
  }
  async function garantirVendedoresAuditoria(r:Reserva,e:DadosReserva,cursor:CamposSync):Promise<CatalogoVendedoresContatoSync|null> {
    if(e.entidade!=="CONTATO")return null;
    const app=e.aplicativoId!,grupo=e.execucao.configuracaoId,conta=e.execucao.configuracao.participantes.find(p=>p.aplicativoId===app)?.contaIdentidade;
    if(!conta)throw new FalhaSync("CONTA_NAO_VERIFICADA","Confirme a conta antes de consultar vendedores.");
    const catalogo=lerVendedores(cursor.catalogoVendedoresCriptografado,grupo,app,conta);
    if(catalogo && catalogo.offset===catalogo.total)return catalogo;
    const proximo=await paginaVendedores(r,app,grupo,conta,catalogo);
    await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{...cursor,catalogoVendedoresCriptografado:criptografia().cifrar({...proximo},contextoVendedores(grupo,app))}});
    return null;
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

  // Remove somente a observação desta conta. Um registro sem réplicas sai do
  // módulo, incluindo payloads e propostas antigas; nunca exclui nada na Olist.
  async function ignorarProduto(tx:Tx, grupo:string, execucaoId:string, app:string, remoteId:string) {
    const estado=await tx.olistSyncEstado.findFirst({where:{configuracaoId:grupo,aplicativoId:app,entidade:"PRODUTO",remoteId},select:{id:true,registroId:true,chave:true}});
    if(!estado)return;
    const registroId=estado.registroId ?? (estado.chave?await tx.olistSyncRegistro.findUnique({where:{configuracaoId_entidade_chave:{configuracaoId:grupo,entidade:"PRODUTO",chave:estado.chave}},select:{id:true}}):null)?.id;
    // Duas contas podem perder Ref simultaneamente. Serialize a remoção do
    // registro lógico para que a última réplica também elimine os históricos.
    if(registroId)await tx.$queryRaw`SELECT id FROM olist_sync_registro WHERE id=${registroId}::uuid AND configuracao_id=${grupo}::uuid FOR UPDATE`;
    await tx.olistSyncEstado.deleteMany({where:{id:estado.id,configuracaoId:grupo}});
    await tx.olistSyncPendencia.deleteMany({where:{configuracaoId:grupo,entidade:"PRODUTO",aplicativoId:app,registroId:null,chaveDedupe:criptografia().hash(`sem-chave:${app}:PRODUTO:${remoteId}`,`${grupo}:pendencia`)}});
    if(!registroId)return;
    // Alterar o conjunto de réplicas invalida propostas não enviadas. Efeitos
    // já enviados e pendências de outras contas continuam reconciliáveis.
    await tx.olistSyncOperacao.deleteMany({where:{configuracaoId:grupo,registroId,status:{in:["PROPOSTA","AUTORIZADA"]}}});
    const temReplica=await tx.olistSyncEstado.count({where:{configuracaoId:grupo,entidade:"PRODUTO",OR:[{registroId},...(estado.chave?[{chave:estado.chave}]:[])]}});
    const temEfeitoPendente=await tx.olistSyncOperacao.findFirst({where:{configuracaoId:grupo,registroId,status:{in:["EM_APLICACAO","VERIFICANDO","RESULTADO_INCONCLUSIVO"]}},select:{id:true}});
    if(temReplica || temEfeitoPendente) {
      await marcarAfetadosSync(tx,{grupo,execucao:execucaoId,entidade:"PRODUTO",registroIds:[registroId]});
      return;
    }
    await tx.olistSyncOperacao.deleteMany({where:{configuracaoId:grupo,registroId,status:{in:["CONFIRMADA","OBSOLETA","FALHA_PERMANENTE"]}}});
    await tx.olistSyncPendencia.deleteMany({where:{configuracaoId:grupo,registroId}});
    await tx.olistSyncEvento.deleteMany({where:{configuracaoId:grupo,registroId}});
    await tx.olistSyncAfetado.deleteMany({where:{configuracaoId:grupo,registroId}});
    await tx.olistSyncRegistro.deleteMany({where:{id:registroId,configuracaoId:grupo}});
  }

  async function gravarObservacao(tx:Tx, grupo:string, execucaoId:string, app:string, entidade:EntidadeSync, obs:ObservacaoRemota, opcoes:{listagem?:boolean;completa?:boolean;aplicacao?:boolean;recomparar?:boolean}={}) {
    if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(obs.nome)) {
      await ignorarProduto(tx,grupo,execucaoId,app,obs.id);return;
    }
    const c=criptografia();
    // Resumos só sinalizam trabalho. Nunca substituem o último detalhe válido.
    if(!obs.completo) {
      await tx.olistSyncEstado.upsert({where:{aplicativoId_entidade_remoteId:{aplicativoId:app,entidade,remoteId:obs.id},configuracaoId:grupo},
        create:{configuracaoId:grupo,aplicativoId:app,entidade,remoteId:obs.id,detalhePendente:true,ultimaListagemExecucaoId:execucaoId,...(opcoes.completa?{ultimaCompletaExecucaoId:execucaoId}:{})},
        update:{detalhePendente:true,ultimaListagemExecucaoId:execucaoId,...(opcoes.completa?{ultimaCompletaExecucaoId:execucaoId}:{})},select:{id:true}});
      return;
    }
    const anterior=await tx.olistSyncEstado.findUnique({where:{aplicativoId_entidade_remoteId:{aplicativoId:app,entidade,remoteId:obs.id}},
      select:{configuracaoId:true,registroId:true,chave:true,metadadosJson:true,fingerprint:true,presente:true,dadosCriptografados:true}});
    if(anterior && anterior.configuracaoId!==grupo)throw new FalhaSync("ESCOPO_ALTERADO","A observação pertence a outro grupo.");
    const vinculoManual=anterior && objetoJson(anterior.metadadosJson).vinculoManual===true && !!anterior.registroId && !!anterior.chave;
    const chave=vinculoManual?anterior.chave:obs.chave===null?null:entidade==="PRODUTO"?obs.chave:c.hash(obs.chave,`${grupo}:identidade:${entidade}`);
    const observada=vinculoManual?{...obs,chave:anterior.chave,pendencias:obs.pendencias.filter(p=>p!=="IDENTIDADE_AUSENTE_OU_INVALIDA"&&p!=="IDENTIDADE_REQUER_REVISAO")}:obs;
    const fingerprint=c.hash(conteudoObservacao(observada),`${grupo}:observacao`);
    let fingerprintAnterior=anterior?.fingerprint;
    if(!fingerprintAnterior && anterior?.dadosCriptografados && objetoJson(anterior.metadadosJson).completo===true)
      fingerprintAnterior=c.hash(conteudoObservacao(observacaoProtegida(c.decifrar(anterior.dadosCriptografados,contextoEstado(grupo,app,entidade,obs.id)))),`${grupo}:observacao`);
    // O GET da Olist também retorna contatos excluídos, com situação E.
    // Não confundir esse tombstone com uma réplica ainda sincronizável.
    const excluido=(entidade==="CONTATO" || entidade==="SERVICO") && obs.situacao==="E";
    const mudou=!anterior || anterior.presente===excluido || fingerprintAnterior!==fingerprint;
    const nome=entidade==="CONTATO"||entidade==="VENDEDOR"?"Cadastro protegido":obs.nome.slice(0,500);
    let registroId:string|null=vinculoManual?anterior.registroId:null;
    let registroDaChave:string|null=null;
    if(chave && !vinculoManual) {
      const registro=await tx.olistSyncRegistro.upsert({where:{configuracaoId_entidade_chave:{configuracaoId:grupo,entidade,chave}},create:{configuracaoId:grupo,entidade,chave,nome},update:entidade==="PRODUTO"?{nome}:{},select:{id:true}});
      registroDaChave=registro.id;
      const duplicado=await tx.olistSyncEstado.findFirst({where:{configuracaoId:grupo,registroId:registro.id,aplicativoId:app,remoteId:{not:obs.id}},select:{id:true}});
      if(!duplicado)registroId=registro.id;
    }
    const identidadeAlterada=!!anterior?.chave && anterior.chave!==chave;
    // Duplicatas não recebem registroId, mas sua chave anterior também precisa
    // ser reavaliada quando deixarem de pertencer àquela equivalência.
    const registroAnterior=identidadeAlterada && !anterior?.registroId && anterior?.chave
      ? await tx.olistSyncRegistro.findUnique({where:{configuracaoId_entidade_chave:{configuracaoId:grupo,entidade,chave:anterior.chave}},select:{id:true}}):null;
    const dados={registroId,chave,nome,situacaoRemota:obs.situacao,fingerprint,presente:!excluido,detalhePendente:false,
      ultimaExecucaoId:execucaoId,verificadoEm:agora(),...(opcoes.listagem?{ultimaListagemExecucaoId:execucaoId}:{}),...(opcoes.completa?{ultimaCompletaExecucaoId:execucaoId}:{})};
    const conteudo={hashesJson:gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)),metadadosJson:{completo:true,...(entidade==="CONTATO"?{versaoObservacaoContato:VERSAO_OBSERVACAO_CONTATO}:{}),...(vinculoManual?{vinculoManual:true}:{})},
      dadosCriptografados:mudou?c.cifrar(jsonObservacao(observada),contextoEstado(grupo,app,entidade,obs.id)):anterior?.dadosCriptografados};
    await tx.olistSyncEstado.upsert({where:{aplicativoId_entidade_remoteId:{aplicativoId:app,entidade,remoteId:obs.id}},
      create:{configuracaoId:grupo,aplicativoId:app,entidade,remoteId:obs.id,...dados,...conteudo,status:excluido?"INATIVO_EXCLUIDO":"DIVERGENTE"},
      update:{...dados,...(mudou?{...conteudo,status:excluido?"INATIVO_EXCLUIDO":"DIVERGENTE"}:{})},select:{id:true}});
    if((mudou || opcoes.recomparar) && !opcoes.aplicacao) {
      await marcarAfetadosSync(tx,{grupo,execucao:execucaoId,entidade,registroIds:[anterior?.registroId,registroAnterior?.id,registroId,registroDaChave].filter((id):id is string=>!!id),identidadeAlterada});
      if(mudou)await contar(tx,execucaoId,"alterados");
    }
    if(entidade==="SERVICO" && (chave || excluido))await encerrarPendenciaServico(tx,grupo,app,obs.id,excluido);
    if(excluido && entidade==="CONTATO")await encerrarPendenciaIdentidadeContato(tx,grupo,app,obs.id,true);
    else if(entidade==="CONTATO" && chave && anterior?.chave===null && anterior.dadosCriptografados && ["A","B"].includes(obs.situacao))await encerrarPendenciaIdentidadeContato(tx,grupo,app,obs.id,false);
    else if(!chave && mudou && !excluido)await pendencia(tx,{grupo,execucaoId,aplicativoId:app,entidade,tipo:"IDENTIDADE_REQUER_REVISAO",chave:`sem-chave:${app}:${entidade}:${obs.id}`,detalhes:{aplicativoId:app,remoteId:obs.id}});
  }

  async function encerrarPendenciaServico(tx:Tx,grupo:string,app:string,remoteId:string,removido:boolean) {
    await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,aplicativoId:app,entidade:"SERVICO",registroId:null,tipo:"IDENTIDADE_REQUER_REVISAO",status:"AGUARDANDO_REVISAO",chaveDedupe:criptografia().hash(`sem-chave:${app}:SERVICO:${remoteId}`,`${grupo}:pendencia`)},
      data:{status:"RESOLVIDA",versao:{increment:1},decididoEm:agora(),motivo:removido?"Serviço excluído na origem.":"Código ou nome do serviço identificado na auditoria."}});
  }

  async function encerrarPendenciaIdentidadeContato(tx:Tx,grupo:string,app:string,remoteId:string,removido:boolean) {
    // Encerra só a pendência individual sem identidade. Conflitos de registros
    // vinculados e resultados de escritas incertas continuam exigindo revisão.
    await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,aplicativoId:app,entidade:"CONTATO",registroId:null,
      tipo:"IDENTIDADE_REQUER_REVISAO",status:"AGUARDANDO_REVISAO",
      chaveDedupe:criptografia().hash(`sem-chave:${app}:CONTATO:${remoteId}`,`${grupo}:pendencia`)},
      data:{status:"RESOLVIDA",versao:{increment:1},decididoEm:agora(),decididoPor:null,
        motivo:removido?"Contato excluído na Olist; identificação não é mais necessária para sincronização.":"Identidade do contato identificada na auditoria; conflitos de equivalência são avaliados separadamente.",
        decisaoJson:{acao:removido?"ENCERRAR_CONTATO_REMOVIDO":"IDENTIDADE_IDENTIFICADA",origem:"AUDITORIA_OLIST"}}});
  }

  async function listar(r:Reserva,e:DadosReserva) {
    const app=e.aplicativoId!; const config=e.execucao.configuracao, cursor=objetoJson(e.cursorJson), entidade=entidadeSync(e.entidade);
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
    let plano=lerPlanoColeta(cursor.plano);
    if(plano && plano.assinaturaEscopo!==assinaturaEscopoSync(entidade,config.participantes.map(p=>p.aplicativoId))) {
      await repo.comReserva(r,async tx=>{
        await tx.olistSyncReciboPagina.deleteMany({where:{etapaId:r.id}});
        await tx.olistSyncEstado.updateMany({where:{configuracaoId:config.id,aplicativoId:app,entidade,ultimaListagemExecucaoId:e.execucaoId},data:{ultimaListagemExecucaoId:null,ultimaCompletaExecucaoId:null}});
        await tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:{identidadeVerificada:true}},select:{id:true}});
      });
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{identidadeVerificada:true}});return;
    }
    if(!plano) {
      const conta=config.participantes.find(p=>p.aplicativoId===app)?.contaIdentidade;
      if(!conta)throw new FalhaSync("CONTA_NAO_VERIFICADA","Confirme a conta antes da coleta.");
      plano=await repo.comReserva(r,tx=>selecionarPlanoColeta(tx,{grupo:config.id,execucao:e.execucaoId,aplicativoId:app,entidade,
        participantesIds:config.participantes.map(p=>p.aplicativoId),contaIdentidade:conta,completa:e.execucao.completa,incrementalHabilitado:true,
        iniciadaEm:agora(),versaoConfiguracao:e.execucao.versaoConfiguracao}));
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{...cursor,plano:{...plano},offset:0}});return;
    }
    if(entidade==="PRODUTO" && plano.modo==="COMPLETA" && cursor.legadoProdutosConferido!==true) {
      // Inclui tombstones antigos que não aparecem mais na API. O predicado SQL
      // reduz candidatos; a decisão final usa a mesma normalização do domínio.
      const apos=typeof cursor.ultimoLegadoProdutoId==="string"?cursor.ultimoLegadoProdutoId:null;
      const antigos=await db.$queryRaw<{id:string;remoteId:string;nome:string}[]>`SELECT id,remote_id AS "remoteId",nome
        FROM olist_sync_estado WHERE configuracao_id=${config.id}::uuid AND aplicativo_id=${app}::uuid AND entidade='PRODUTO'
        AND nome IS NOT NULL AND nome !~* '(^|[^[:alnum:]_])ref($|[^[:alnum:]_])'
        AND (${apos}::uuid IS NULL OR id>${apos}::uuid) ORDER BY id LIMIT 1`;
      const antigo=antigos[0];
      if(antigo && !nomeProdutoElegivelSync(antigo.nome)) {
        let remoto:ObservacaoRemota|null=null;
        const conta=config.participantes.find(p=>p.aplicativoId===app)?.contaIdentidade;
        if(!conta)throw new FalhaSync("CONTA_NAO_VERIFICADA","Confirme a conta antes de revisar o legado.");
        try {remoto=await chamada(r,app,()=>cliente.detalhar(app,"PRODUTO",antigo.remoteId,{
          ...ritmoTransporte(app),reutilizarIdentidade:true,
          validarConta:identidade=>criptografia().hash(identidade.documento,`${config.id}:conta`)===conta,
          antesDeConsultar:async()=>{await repo.comReserva(r,(tx,atual)=>validarChamada(tx,atual,app));},
        }),false,true);}
        catch(error) {if(!(error instanceof FalhaSync) || error.codigo!=="OLIST_404" || error.origemConsulta!=="RECURSO")throw error;}
        await repo.comReserva(r,async tx=>{
          if(remoto && nomeProdutoElegivelSync(remoto.nome))await gravarObservacao(tx,config.id,e.execucaoId,app,"PRODUTO",remoto,{recomparar:true});
          else await ignorarProduto(tx,config.id,e.execucaoId,app,antigo.remoteId);
        });
      }
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{...cursor,legadoProdutosConferido:!antigo,...(antigo?{ultimoLegadoProdutoId:antigo.id}:{})}});return;
    }
    if(entidade==="CONTATO" && !await garantirTiposAuditoria(r,e,cursor))return;
    if(entidade==="CONTATO" && !await garantirVendedoresAuditoria(r,e,cursor))return;
    const offset=typeof cursor.offset==="number"?cursor.offset:0;
    const pagina=await chamada(r,app,()=>cliente.listar(app,entidade,{offset,limit:100,...(plano.desde?{desde:plano.desde,incrementalValidado:true}:{})}));
    if(pagina.total===null || (pagina.itens.length===0 && offset<pagina.total) || (typeof cursor.total==="number" && cursor.total!==pagina.total) || offset+pagina.itens.length>pagina.total)
      throw new FalhaSync("COBERTURA_INCOMPLETA","A paginação mudou ou não comprova a cobertura da janela. Execute uma nova auditoria.");
    if(entidade==="PRODUTO" && pagina.total>100_000)throw new FalhaSync("LIMITE_COLETA_PRODUTOS","A coleta admite até 100 mil produtos por empresa e janela.");
    const terminou=offset+pagina.itens.length>=pagina.total;
    const cota=cotaDaRespostaSync(pagina);
    const elegiveis=pagina.itens.filter(obs=>entidade!=="PRODUTO" || nomeProdutoElegivelSync(obs.nome));
    const totalElegiveis=(typeof cursor.totalElegiveis==="number"?cursor.totalElegiveis:0)+elegiveis.length;
    const proximoCursor={...cursor,totalElegiveis,plano:{...plano},total:pagina.total,offset:offset+pagina.itens.length,
      ...(cota?{cotaLeitura:{...cota,observadaEm:agora().toISOString()}}:{})};
    await repo.comReserva(r,async tx=>{
      if(entidade==="PRODUTO") {
        const c=criptografia();
        const inseridos=await tx.olistSyncReciboPagina.createMany({data:pagina.itens.map(obs=>({etapaId:r.id,digest:c.hash(obs.id,`${config.id}:pagina:${r.id}`)})),skipDuplicates:true});
        if(inseridos.count!==pagina.itens.length)throw new FalhaSync("COBERTURA_INCOMPLETA","A listagem repetiu IDs entre páginas. Execute uma nova auditoria.");
        if(terminou) {
          const recebidos=await tx.olistSyncReciboPagina.count({where:{etapaId:r.id}});
          if(recebidos!==pagina.total)throw new FalhaSync("COBERTURA_INCOMPLETA","A listagem não comprova a cobertura de todos os produtos.");
          await tx.olistSyncReciboPagina.deleteMany({where:{etapaId:r.id}});
        }
        const ignorados=pagina.itens.filter(obs=>!nomeProdutoElegivelSync(obs.nome)).map(obs=>obs.id);
        const antigos=ignorados.length?await tx.olistSyncEstado.findMany({where:{configuracaoId:config.id,aplicativoId:app,entidade,remoteId:{in:ignorados}},orderBy:[{registroId:"asc"},{remoteId:"asc"}],select:{remoteId:true},take:100}):[];
        for(const antigo of antigos)await ignorarProduto(tx,config.id,e.execucaoId,app,antigo.remoteId);
      }
      for(const obs of elegiveis)await gravarObservacao(tx,config.id,e.execucaoId,app,entidade,obs,{listagem:true,completa:plano.modo==="COMPLETA",recomparar:plano.watermarkAnterior===null});
      if(terminou) {
        const unicos=await tx.olistSyncEstado.count({where:{configuracaoId:config.id,aplicativoId:app,entidade,ultimaListagemExecucaoId:e.execucaoId}});
        if(unicos!==totalElegiveis)throw new FalhaSync("COBERTURA_INCOMPLETA","A listagem repetiu registros ou omitiu páginas. Execute uma nova auditoria.");
      }
      await contar(tx,e.execucaoId,"listados",pagina.itens.length);
      await contar(tx,e.execucaoId,"analisados",elegiveis.filter(item=>item.completo).length);
      await tx.olistSyncEtapa.update({where:{id:e.id},data:{...(terminou?{fase:"DETALHAR"}:{}),cursorJson:proximoCursor},select:{id:true}});
    });
    await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:proximoCursor});
  }

  async function detalhar(r:Reserva,e:DadosReserva) {
    const app=e.aplicativoId!, grupo=e.execucao.configuracaoId, entidade=entidadeSync(e.entidade), cursor=objetoJson(e.cursorJson);
    const plano=lerPlanoColeta(cursor.plano);
    if(!plano || plano.assinaturaEscopo!==assinaturaEscopoSync(entidade,e.execucao.configuracao.participantes.map(p=>p.aplicativoId))) {
      // Checkpoints antigos não comprovam janela/presença. Reiniciar somente a
      // coleta dessa conta, mantendo os últimos detalhes já persistidos.
      await repo.comReserva(r,async tx=>{
        if(entidade==="PRODUTO") {
          await tx.olistSyncReciboPagina.deleteMany({where:{etapaId:r.id}});
          await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,aplicativoId:app,entidade,ultimaListagemExecucaoId:e.execucaoId},data:{ultimaListagemExecucaoId:null,ultimaCompletaExecucaoId:null}});
        }
        await tx.olistSyncEtapa.update({where:{id:e.id},data:{fase:"LISTAR",cursorJson:{}},select:{id:true}});
      });
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{}});return;
    }
    const catalogo=await garantirTiposAuditoria(r,e,cursor);
    if(entidade==="CONTATO" && !catalogo)return;
    const vendedores=await garantirVendedoresAuditoria(r,e,cursor);
    if(entidade==="CONTATO" && !vendedores)return;
    if(entidade==="CONTATO" && cursor.pendenciasVendedoresReavaliadas!==true) {
      // O catálogo pode ser corrigido sem alterar o contato nem sua data remota.
      // Releia somente contatos com dependências pendentes, inclusive fora do delta.
      const pendencias=await db.olistSyncPendencia.findMany({where:{configuracaoId:grupo,entidade:"CONTATO",status:"AGUARDANDO_REVISAO",
        registroId:{not:null},tipo:{in:PENDENCIAS_VENDEDOR_CONTATO},...(typeof cursor.ultimaPendenciaVendedorId==="string"?{id:{gt:cursor.ultimaPendenciaVendedorId}}:{})},
        orderBy:{id:"asc"},take:100,select:{id:true,registroId:true}});
      const ids=[...new Set(pendencias.flatMap(p=>p.registroId?[p.registroId]:[]))];
      const proximo={...cursor,pendenciasVendedoresReavaliadas:pendencias.length<100,ultimaPendenciaVendedorId:pendencias.at(-1)?.id??cursor.ultimaPendenciaVendedorId??null};
      await repo.comReserva(r,async tx=>{
        if(ids.length) {
          await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,aplicativoId:app,entidade:"CONTATO",registroId:{in:ids},presente:true},data:{detalhePendente:true}});
          await marcarAfetadosSync(tx,{grupo,execucao:e.execucaoId,entidade:"CONTATO",registroIds:ids});
        }
        await tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:proximo},select:{id:true}});
      });
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:proximo});return;
    }
    // Uma interrupção pode deixar detalhes pendentes fora do próximo delta.
    // A dívida pertence à conta/entidade, não apenas à execução que a descobriu.
    const pendente=await db.olistSyncEstado.findFirst({where:{configuracaoId:grupo,aplicativoId:app,entidade,detalhePendente:true},orderBy:{id:"asc"},select:{id:true,remoteId:true,registroId:true,chave:true,nome:true}});
    const ausente=!pendente && plano.modo==="COMPLETA"?await db.olistSyncEstado.findFirst({where:{configuracaoId:grupo,aplicativoId:app,entidade,presente:true,
      OR:[{ultimaCompletaExecucaoId:null},{ultimaCompletaExecucaoId:{not:e.execucaoId}}]},orderBy:{id:"asc"},select:{id:true,remoteId:true,registroId:true,chave:true,nome:true}}):null;
    const estado=pendente??ausente;
    if(estado) {
      // Entidades sem GET individual não têm exclusão comprovada pela ausência
      // da lista. Conservamos o snapshot, bloqueando a decisão para revisão.
      if(ausente && !CAPACIDADES_SYNC[entidade].detalhar) {
        await repo.comReserva(r,async tx=>{
          await tx.olistSyncEstado.update({where:{id:estado.id},data:{ultimaCompletaExecucaoId:e.execucaoId},select:{id:true}});
          await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:estado.registroId,aplicativoId:app,entidade,tipo:"AUSENCIA_NAO_CONFIRMADA",chave:`ausencia:${app}:${entidade}:${estado.remoteId}`,detalhes:{remoteId:estado.remoteId}});
        });
      } else {
        let obs:ObservacaoRemota|null=null;
        try {obs=await chamada(r,app,()=>cliente.detalhar(app,entidade,estado.remoteId));}
        catch(error) {if(!(error instanceof FalhaSync) || error.codigo!=="OLIST_404")throw error;}
        if(obs && catalogo)obs=resolverTiposContatoSync(obs,catalogo.itens);
        if(obs && vendedores)obs=resolverVendedorContatoSync(obs,vendedores.itens);
        await repo.comReserva(r,async tx=>{
          if(obs)await gravarObservacao(tx,grupo,e.execucaoId,app,entidade,obs,{completa:plano.modo==="COMPLETA",recomparar:plano.watermarkAnterior===null});
          else if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(estado.nome))await ignorarProduto(tx,grupo,e.execucaoId,app,estado.remoteId);
          else {
            await tx.olistSyncEstado.update({where:{id:estado.id},data:{presente:false,detalhePendente:false,...(["CONTATO","SERVICO"].includes(entidade)?{status:"INATIVO_EXCLUIDO"}:{}),ultimaExecucaoId:e.execucaoId,verificadoEm:agora(),...(plano.modo==="COMPLETA"?{ultimaCompletaExecucaoId:e.execucaoId}:{})},select:{id:true}});
            if(entidade==="CONTATO")await encerrarPendenciaIdentidadeContato(tx,grupo,app,estado.remoteId,true);
            if(entidade==="SERVICO")await encerrarPendenciaServico(tx,grupo,app,estado.remoteId,true);
            const registro=estado.chave?await tx.olistSyncRegistro.findUnique({where:{configuracaoId_entidade_chave:{configuracaoId:grupo,entidade,chave:estado.chave}},select:{id:true}}):null;
            await marcarAfetadosSync(tx,{grupo,execucao:e.execucaoId,entidade,registroIds:[estado.registroId,registro?.id].filter((id):id is string=>!!id)});
            await contar(tx,e.execucaoId,"alterados");
          }
          await contar(tx,e.execucaoId,"analisados");await contar(tx,e.execucaoId,"detalhados");
        });
      }
      await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor});return;
    }
    await repo.comReserva(r,async tx=>{
      await tx.olistSyncEtapa.update({where:{id:e.id},data:{status:"CONCLUIDA",leaseToken:null,leaseAte:null},select:{id:true}});
      const faltam=await tx.olistSyncEtapa.count({where:{execucaoId:e.execucaoId,entidade,fase:{in:["LISTAR","DETALHAR"]},status:{not:"CONCLUIDA"}}});
      if(!faltam)await tx.olistSyncEtapa.createMany({data:[{execucaoId:e.execucaoId,entidade,fase:"COMPARAR"}],skipDuplicates:true});
    });
  }

  async function comparar(r:Reserva,e:DadosReserva) {
    const grupo=e.execucao.configuracaoId, entidade=entidadeSync(e.entidade), c=criptografia(), cursor=objetoJson(e.cursorJson);
    await repo.comReserva(r,tx=>transferirAfetadosPendentes(tx,{grupo,execucao:e.execucaoId,entidades:[entidade]}));
    await repo.comReserva(r,tx=>marcarPropostasDesatualizadas(tx,{grupo,execucao:e.execucaoId,entidade,versaoConfiguracao:e.execucao.versaoConfiguracao}));
    const etapas=await db.olistSyncEtapa.findMany({where:{execucaoId:e.execucaoId,entidade,fase:"DETALHAR",status:"CONCLUIDA"},select:{aplicativoId:true,cursorJson:true},take:20});
    const planos=etapas.map(etapa=>({app:etapa.aplicativoId,plano:lerPlanoColeta(objetoJson(etapa.cursorJson).plano)}));
    const assinaturaAtual=assinaturaEscopoSync(entidade,e.execucao.configuracao.participantes.map(p=>p.aplicativoId));
    if(e.execucao.configuracao.participantes.some(p=>!planos.some(item=>item.app===p.aplicativoId && item.plano?.assinaturaEscopo===assinaturaAtual)))
      throw new FalhaSync("COBERTURA_INCOMPLETA","Todos os participantes precisam concluir a coleta antes da comparação.");
    const prova=planos[0].plano!;
    const afetados=await db.olistSyncAfetado.findMany({where:{configuracaoId:grupo,execucaoId:e.execucaoId,entidade,processadoEm:null},orderBy:{registroId:"asc"},take:25,
      select:{registroId:true,identidadeAlterada:true,registro:{select:{id:true,chave:true,nome:true,hashesBaseJson:true,revisao:true,origemRegistradaEm:true,origemTipo:true,aplicativoOrigemId:true}}}});
    const registros=afetados.map(a=>a.registro);
    const identidadesPendentes=registros.length?await db.olistSyncPendencia.findMany({where:{configuracaoId:grupo,entidade,registroId:{in:registros.map(r=>r.id)},tipo:"IDENTIDADE_ALTERADA",status:"AGUARDANDO_REVISAO"},select:{registroId:true},take:25}):[];
    // Uma projeção limitada por lote evita buscar réplicas para cada registro.
    const estadosLote=registros.length?await db.olistSyncEstado.findMany({where:{configuracaoId:grupo,entidade,chave:{in:registros.map(r=>r.chave)},aplicativoId:{in:e.execucao.configuracao.participantes.map(p=>p.aplicativoId)}},orderBy:[{chave:"asc"},{id:"asc"}],take:5001,select:selecaoEstado}):[];
    if(estadosLote.length>5000)throw new FalhaSync("LIMITE_OBSERVACOES","A quantidade de equivalências exige revisão antes de comparar.");
    for(const registro of registros) {
      const estados=estadosLote.filter(s=>s.chave===registro.chave);
      const identidadeAlterada=afetados.find(a=>a.registroId===registro.id)?.identidadeAlterada===true || identidadesPendentes.some(p=>p.registroId===registro.id);
      const replicas:ReplicaComparacao[]=e.execucao.configuracao.participantes.map(p=>{
        const candidatos=estados.filter(s=>s.aplicativoId===p.aplicativoId && s.presente);
        const estado=candidatos.find(s=>s.registroId===registro.id)??candidatos[0];
        if(estado && (estado.detalhePendente || !estado.dadosCriptografados || objetoJson(estado.metadadosJson).completo!==true || entidade==="CONTATO" && objetoJson(estado.metadadosJson).versaoObservacaoContato!==VERSAO_OBSERVACAO_CONTATO))
          throw new FalhaSync("COBERTURA_INCOMPLETA","Uma réplica ainda não possui observação completa.");
        const observacao=estado?.dadosCriptografados?observacaoProtegida(c.decifrar(estado.dadosCriptografados,contextoEstado(grupo,p.aplicativoId,entidade,estado.remoteId))):null;
        if(observacao && candidatos.length>1)observacao.pendencias.push("IDENTIDADE_DUPLICADA");
        if(observacao && identidadeAlterada)observacao.pendencias.push("IDENTIDADE_ALTERADA");
        if(observacao && estados.length>200)observacao.pendencias.push("LIMITE_OBSERVACOES");
        return {aplicativoId:p.aplicativoId,observacao,existia:estados.some(s=>s.aplicativoId===p.aplicativoId && !s.presente)};
      });
      if(entidade==="CONTATO" && replicas.some(p=>!p.observacao)) {
        // Uma identidade por CPF não deve criar outro cadastro onde já existe
        // o mesmo nome sem documento. O caminho inverso é verificado na Olist.
        const nomes=replicas.flatMap(p=>{
          const chave=p.observacao&&!p.observacao.chave?.startsWith("nome:")?chaveContatoPorNome(p.observacao.nome):null;
          return chave?[c.hash(chave,`${grupo}:identidade:CONTATO`)]:[];
        });
        if(nomes.length && await db.olistSyncEstado.findFirst({where:{configuracaoId:grupo,entidade,aplicativoId:{in:replicas.filter(p=>!p.observacao).map(p=>p.aplicativoId)},presente:true,chave:{in:nomes}},select:{id:true}}))
          for(const replica of replicas)replica.observacao?.pendencias.push("POSSIVEL_DUPLICIDADE");
      }
      if(entidade==="SERVICO" && replicas.some(p=>!p.observacao)) {
        const nomes=[...new Set(replicas.flatMap(p=>p.observacao && p.observacao.chave?.startsWith("codigo:") && nomeServicoSync(p.observacao.nome)
          ?[c.hash(`nome:${nomeServicoSync(p.observacao.nome)}`,`${grupo}:identidade:SERVICO`)]:[]))];
        if(nomes.length && await db.olistSyncEstado.findFirst({where:{configuracaoId:grupo,entidade,aplicativoId:{in:replicas.filter(p=>!p.observacao).map(p=>p.aplicativoId)},presente:true,chave:{in:nomes}},select:{id:true}}))
          for(const replica of replicas)replica.observacao?.pendencias.push("POSSIVEL_DUPLICIDADE");
      }
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
          const origem=inferirOrigem(replicas,planos.every(item=>item.plano?.modo==="COMPLETA")), remoto=replicas.find(p=>p.aplicativoId===origem.aplicativoId)?.observacao?.id;
          await tx.olistSyncRegistro.update({where:{id:registro.id},data:{origemTipo:origem.tipo,aplicativoOrigemId:origem.aplicativoId,registroOlistOrigemId:remoto,origemRegistradaEm:agora(),origemExecucaoId:e.execucaoId},select:{id:true}});
        }
        await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,entidade,chave:registro.chave,aplicativoId:{in:replicas.map(p=>p.aplicativoId)}},data:{status:decisao.status==="PROPAGAR"?"DIVERGENTE":decisao.status}});
        if(decisao.status==="AGUARDANDO_REVISAO") {
          const observacoes=Object.fromEntries(replicas.map(p=>[p.aplicativoId,p.observacao?{remoteId:p.observacao.id,hashes:gerarHashesCampos(p.observacao.campos,v=>c.hash(v,`${grupo}:campo`)),situacao:p.observacao.situacao,fingerprint:estados.find(s=>s.aplicativoId===p.aplicativoId && s.remoteId===p.observacao?.id)?.fingerprint??null}:null]));
          await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:registro.id,entidade,tipo:decisao.motivos[0]??"CONFLITO",chave:`registro:${registro.id}`,detalhes:{motivos:decisao.motivos,observacoes,cobertura:{assinaturaEscopo:prova.assinaturaEscopo,versaoContrato:prova.versaoContrato}},severidade:decisao.motivos.some(m=>/DUPLIC|IDENTIDADE|PROTEGIDO/.test(m))?"CRITICA":"ALTA"});
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
        if(entidade==="CONTATO") {
          try {
            for(const destino of [...decisao.aplicativosCriar,...decisao.aplicativosAtualizar]) {
              const conta=e.execucao.configuracao.participantes.find(p=>p.aplicativoId===destino)?.contaIdentidade;
              const catalogo=conta?lerCatalogoTiposContatoSync(objetoJson(etapas.find(p=>p.aplicativoId===destino)?.cursorJson).catalogoTiposContato,conta):null;
              payloadTiposContatoSync(payload,catalogo?.offset===catalogo?.total?catalogo?.itens:undefined);
              if(!decisao.aplicativosCriar.includes(destino) && typeof decisao.campos?.vendedorNome==="string") {
                const vendedores=conta?lerVendedores(objetoJson(etapas.find(p=>p.aplicativoId===destino)?.cursorJson).catalogoVendedoresCriptografado,grupo,destino,conta):null;
                idVendedorPorNomeSync(decisao.campos.vendedorNome,vendedores?.offset===vendedores?.total?vendedores?.itens:undefined);
              }
            }
          } catch(error) {
            if(!(error instanceof FalhaSync))throw error;
            await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:registro.id,entidade,tipo:error.codigo,chave:`registro:${registro.id}`,detalhes:{}});
            await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,registroId:registro.id},data:{status:"AGUARDANDO_REVISAO"}});
            await contar(tx,e.execucaoId,"bloqueados");return;
          }
          await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,registroId:registro.id,status:"AGUARDANDO_REVISAO",tipo:{in:["REFERENCIA_TIPOS_CONTATO","TIPOS_CONTATO_NAO_MAPEADOS","TIPOS_CONTATO_AMBIGUOS"]}},data:{status:"RESOLVIDA",decididoEm:agora()}});
        }
        for(const destino of [...decisao.aplicativosCriar,...decisao.aplicativosAtualizar]) {
          const id=randomUUID();
          const observacaoDestino=replicas.find(p=>p.aplicativoId===destino)?.observacao;
          const alvoContato=entidade==="CONTATO" && decisao.campos.vendedorNome===null ? {...decisao.campos,vendedorNome:observacaoDestino?.campos.vendedorNome??null} : decisao.campos;
          const escrita=entidade==="PRODUTO"?primeiraEscritaProdutoSync(decisao.campos,observacaoDestino?.campos):{campos:alvoContato,somenteProducao:false};
          const acao=decisao.aplicativosCriar.includes(destino)?"CRIAR":"ATUALIZAR";
          const hashesDestino=observacaoDestino?gerarHashesCampos(observacaoDestino.campos,v=>c.hash(v,`${grupo}:campo`)):base;
          const hashesAlvo=gerarHashesCampos(escrita.campos,v=>c.hash(v,`${grupo}:campo`));
          const alterados=Object.keys(hashesAlvo).filter(campo=>hashesAlvo[campo]!==hashesDestino[campo]);
          const fontes=[...new Set(alterados.flatMap(campo=>decisao.fontesPorCampo[campo]??[]))].filter(a=>a!==destino).sort();
          const fonte=fontes[0]??replicas.find(p=>p.observacao)?.aplicativoId;
          if(!fonte)continue;
          const atuais=Object.fromEntries(replicas.map(p=>[p.aplicativoId,p.observacao?{remoteId:p.observacao.id,hashes:gerarHashesCampos(p.observacao.campos,v=>c.hash(v,`${grupo}:campo`)),...(entidade==="CONTATO"?{vendedorVinculo:c.hash(p.observacao.vendedorContatoRemoto?.id??null,`${grupo}:vendedor-local`)}:{})}:null]));
          await tx.olistSyncOperacao.create({data:{id,configuracaoId:grupo,registroId:registro.id,execucaoId:e.execucaoId,sourceAppId:fonte,destinoAppId:destino,acao,revisao,status:"AUTORIZADA",precondicoesJson:{somenteProducao:escrita.somenteProducao,...(entidade==="PRODUTO"?{versaoProdutos:VERSAO_PRODUTOS_SYNC}:{}),...(escrita.producaoPendente?{producaoPendenteCriptografada:c.cifrar(escrita.producaoPendente,`${contextoOperacao(grupo,id)}:producao`)}:{}),replicas:atuais,...(entidade==="CONTATO"?{hashesBaseContato:decisao.hashes,preservarVendedor:decisao.campos.vendedorNome===null,vendedorPreservadoCriptografado:c.cifrar(observacaoDestino?.vendedorContatoRemoto?.id??null,`${contextoOperacao(grupo,id)}:vendedor-preservado`)}:{}),fontesPorCampo:decisao.fontesPorCampo,contas:Object.fromEntries(e.execucao.configuracao.participantes.map(p=>[p.aplicativoId,p.contaIdentidade])),versaoConfiguracao:e.execucao.versaoConfiguracao,...(entidade==="CONTATO"?{versaoObservacaoContato:VERSAO_OBSERVACAO_CONTATO}:{})},payloadCriptografado:c.cifrar(escrita.campos,contextoOperacao(grupo,id))},select:{id:true}});
        }
        } finally {
          // A decisão e o consumo do item são atômicos, inclusive em conflitos.
          await tx.olistSyncAfetado.updateMany({where:{execucaoId:e.execucaoId,entidade,registroId:registro.id,configuracaoId:grupo},data:{processadoEm:agora()}});
          await contar(tx,e.execucaoId,"comparados");
        }
      });
    }
    if(registros.length===25) {await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor});return;}
    await repo.comReserva(r,async tx=>{
      // Fechamento e watermarks na mesma transação: falhas não certificam janela.
      await tx.olistSyncEtapa.update({where:{id:e.id},data:{status:"CONCLUIDA",leaseToken:null,leaseAte:null},select:{id:true}});
      if(!await fecharCobertura(tx,{grupo,execucao:e.execucaoId,entidade,agora:agora()}))
        throw new FalhaSync("COBERTURA_INCOMPLETA","Não foi possível confirmar a cobertura de todos os participantes.");
      if(e.execucao.modo==="AUDITAR_E_APLICAR") {
        for(const p of e.execucao.configuracao.participantes)await tx.olistSyncEtapa.createMany({data:[{execucaoId:e.execucaoId,entidade,aplicativoId:p.aplicativoId,fase:"APLICAR"}],skipDuplicates:true});
      }
    });
  }

  async function aplicar(r:Reserva,e:DadosReserva) {
    const grupo=e.execucao.configuracaoId, app=e.aplicativoId!, entidade=entidadeSync(e.entidade), c=criptografia(), cursor=objetoJson(e.cursorJson);
    const selecaoOperacao={id:true,registroId:true,sourceAppId:true,revisao:true,status:true,acao:true,tentativas:true,precondicoesJson:true,payloadCriptografado:true,remoteId:true,registro:{select:{revisao:true}}} as const;
    const escopo={configuracaoId:grupo,destinoAppId:app,registro:{entidade}};
    // Apura envios anteriores antes de enviar novas alterações. Uma incerteza
    // já consultada nesta execução não monopoliza a fila nem gera outro POST.
    const operacao=typeof cursor.operacaoId==="string"
      ? await db.olistSyncOperacao.findFirst({where:{...escopo,id:cursor.operacaoId,status:{in:["AUTORIZADA","EM_APLICACAO","VERIFICANDO","RESULTADO_INCONCLUSIVO"]}},select:selecaoOperacao})
      : await db.olistSyncOperacao.findFirst({where:{...escopo,OR:[{status:{in:["EM_APLICACAO","VERIFICANDO"]}},{status:"RESULTADO_INCONCLUSIVO",execucaoId:{not:e.execucaoId}}]},orderBy:{id:"asc"},select:selecaoOperacao})
        ?? await db.olistSyncOperacao.findFirst({where:{...escopo,status:"AUTORIZADA",OR:[{erroCodigo:null},{erroCodigo:{not:"AGUARDANDO_COMPONENTES"}}]},orderBy:{id:"asc"},select:selecaoOperacao})
        ?? await db.olistSyncOperacao.findFirst({where:{...escopo,status:"AUTORIZADA"},orderBy:{updatedAt:"asc"},select:selecaoOperacao});
    const catalogos=objetoJson(cursor.catalogosTiposContato);
    const catalogosVendedores=objetoJson(cursor.catalogosVendedoresCriptografados);
    // Orçamento durável por lote; a contagem legada é lida uma única vez.
    let loteConsumidas=typeof cursor.loteConsumidas==="number"&&Number.isSafeInteger(cursor.loteConsumidas)&&cursor.loteConsumidas>=0
      ? cursor.loteConsumidas : await db.olistSyncOperacao.count({where:{...escopo,execucaoId:e.execucaoId,tentativas:{gt:0},status:{not:"AUTORIZADA"}}});
    let falhasConfirmacao=typeof cursor.falhasConfirmacao==="number"&&Number.isSafeInteger(cursor.falhasConfirmacao)&&cursor.falhasConfirmacao>=0?cursor.falhasConfirmacao:0;
    const checkpoint=(valor:CamposSync,disponivelEm?:Date)=>repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{...(valor.operacaoId===cursor.operacaoId && valor.operacaoId?{componentesProduto:cursor.componentesProduto??{},inicioComponentes:cursor.inicioComponentes??null}:{}),...valor,loteConsumidas,falhasConfirmacao,...(entidade==="CONTATO"?{catalogosTiposContato:catalogos,catalogosVendedoresCriptografados:catalogosVendedores}:{})},...(disponivelEm?{disponivelEm}:{})});
    if(!operacao) {await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{},...(typeof cursor.operacaoId==="string"?{}:{status:"CONCLUIDA"})});return;}
    const plan=objetoJson(operacao.precondicoesJson), replicas=objetoJson(plan.replicas);
    const reconciliando=operacao.status!=="AUTORIZADA";
    const campos=operacao.payloadCriptografado?objetoJson(c.decifrar(operacao.payloadCriptografado,contextoOperacao(grupo,operacao.id))):null;
    const bloquear=async(codigo:string,status="OBSOLETA",camposDivergentes:string[]=[])=>{
      if(codigo==="VERIFICACAO_DIVERGENTE")falhasConfirmacao++;
      await repo.comReserva(r,async tx=>{
        await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status,erroCodigo:codigo,...(reconciliando?{execucaoId:e.execucaoId}:{})},select:{id:true}});
        await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:operacao.registroId,aplicativoId:app,entidade,tipo:codigo,chave:`operacao:${operacao.id}`,detalhes:{operacaoId:operacao.id,...(camposDivergentes.length?{camposDivergentes}:{})}});
        if(entidade==="CONTATO" && (codigo.startsWith("VENDEDOR_CONTATO_") || codigo.startsWith("CATALOGO_VENDEDORES_")))
          await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,registroId:operacao.registroId,aplicativoId:app},data:{status:"AGUARDANDO_REVISAO"}});
      });
      await checkpoint({});
    };
    // Reconciliação apura um efeito já enviado; uma revisão nova não apaga essa incerteza.
    if(!campos) {await bloquear("PROPOSTA_OBSOLETA",reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
    if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(campos.descricao)) {
      await repo.comReserva(r,async tx=>{
        if(reconciliando)await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"RESULTADO_INCONCLUSIVO",erroCodigo:"PRODUTO_FORA_ESCOPO",execucaoId:e.execucaoId},select:{id:true}});
        else await tx.olistSyncOperacao.deleteMany({where:{id:operacao.id,status:{in:["AUTORIZADA","PROPOSTA"]}}});
        for(const alvo of Object.keys(replicas)) {
          const id=objetoJson(replicas[alvo]).remoteId;
          if(typeof id==="string") {
            const estado=await tx.olistSyncEstado.findFirst({where:{configuracaoId:grupo,aplicativoId:alvo,entidade,remoteId:id},select:{nome:true}});
            if(estado && !nomeProdutoElegivelSync(estado.nome))await ignorarProduto(tx,grupo,e.execucaoId,alvo,id);
          }
        }
      });
      await checkpoint({});return;
    }
    if(!reconciliando && (operacao.registro.revisao!==operacao.revisao || plan.versaoConfiguracao!==e.execucao.versaoConfiguracao)) {await bloquear("PROPOSTA_OBSOLETA");return;}
    if(entidade==="PRODUTO" && !reconciliando && plan.versaoProdutos!==VERSAO_PRODUTOS_SYNC) {await bloquear("CONTRATO_PRODUTO_DESATUALIZADO");return;}
    if(entidade==="CONTATO" && plan.versaoObservacaoContato!==VERSAO_OBSERVACAO_CONTATO) {await bloquear("CONTRATO_CONTATO_DESATUALIZADO",reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
    if(operacao.status==="AUTORIZADA") {
      if(falhasConfirmacao>=3) {
        await repo.comReserva(r,async tx=>{
          await tx.olistSyncEtapa.update({where:{id:e.id},data:{status:"PAUSADA",leaseToken:null,leaseAte:null,erroCodigo:"CONFIRMACOES_DIVERGENTES"},select:{id:true}});
          await tx.olistSyncEvento.create({data:{configuracaoId:grupo,execucaoId:e.execucaoId,tipo:"APLICACAO_REQUER_DIAGNOSTICO",metadadosJson:{aplicativoId:app,entidade,falhasConfirmacao}},select:{id:true}});
        });
        return;
      }
      if(loteConsumidas>=e.execucao.configuracao.limiteAlteracoes) {
        const consumidas=loteConsumidas;loteConsumidas=0;
        // Libera o consumidor entre lotes, mantendo a mesma execução e coleta.
        await repo.comReserva(r,tx=>tx.olistSyncEvento.create({data:{configuracaoId:grupo,execucaoId:e.execucaoId,tipo:"LOTE_APLICACAO_CONCLUIDO",metadadosJson:{aplicativoId:app,entidade,consumidas,limite:e.execucao.configuracao.limiteAlteracoes}},select:{id:true}}));
        await checkpoint({},new Date(agora().getTime()+5_000));return;
      }
    }
    const fontes=Object.keys(replicas).filter(id=>id!==app && replicas[id]!==null).sort();
    // Orçamento limitado pelo grupo (até 20 filhos), incluindo as leituras de
    // identidade. O destino continua sendo revalidado por último antes do envio.
    const identidadePorNome=entidade==="CONTATO" && chaveContatoSync(campos)?.startsWith("nome:")===true || entidade==="SERVICO" && chaveServicoSync(campos)?.startsWith("nome:")===true;
    const verificarIdentidadeFonte=identidadePorNome || entidade==="SERVICO";
    const producao=entidade==="PRODUTO" && campos.tipo==="F"?producaoCanonicaSync(campos.producao):null;
    const precisaComponentes=!!producao && (operacao.acao==="CRIAR" || plan.somenteProducao===true);
    const componentes=objetoJson(cursor.componentesProduto);
    const janelaValidacaoMs=Math.max(120_000,(fontes.length*(verificarIdentidadeFonte?2:1)+(entidade==="SERVICO"?1:0)+(precisaComponentes?producao!.produtos.length*2:0)+(entidade==="SERVICO"?4:2))*12_000);
    const fase=reconciliando?"VERIFICAR":typeof cursor.fase==="string"?cursor.fase:"FONTES";
    const hashesEsperados=gerarHashesCampos(campos,v=>c.hash(v,`${grupo}:campo`));
    const hashesFinais=typeof plan.producaoPendenteCriptografada==="string"
      ? gerarHashesCampos({...campos,producao:producaoCanonicaSync(c.decifrar(plan.producaoPendenteCriptografada,`${contextoOperacao(grupo,operacao.id)}:producao`))},v=>c.hash(v,`${grupo}:campo`)) : hashesEsperados;
    const identidadeEsperada=(alvo:string)=>objetoJson(plan.contas)[alvo]??e.execucao.configuracao.participantes.find(p=>p.aplicativoId===alvo)?.contaIdentidade;
    const protegerConsulta=(alvo:string,identidadeFresca=false)=>({
      ...ritmoTransporte(alvo), reutilizarIdentidade:!identidadeFresca,
      ...(entidade==="CONTATO" && typeof campos.nome==="string"?{nomeContato:campos.nome}:{}),
      ...(entidade==="SERVICO" && typeof campos.nome==="string"?{nomeServico:campos.nome}:{}),
      validarConta:(identidade:{documento:string})=>c.hash(identidade.documento,`${grupo}:conta`)===identidadeEsperada(alvo),
      antesDeConsultar:async()=>{
        await repo.comReserva(r,(tx,atual)=>validarChamada(tx,atual,alvo));
      },
    });
    async function consultar<T>(alvo:string, executar:()=>Promise<T>):Promise<T|null> {
      try { return await chamada(r,alvo,executar,false,true); }
      catch(error) {
        if(error instanceof FalhaSync && error.status===400 && error.origemConsulta==="RECURSO" && !error.recuperavel && !error.inconclusivo) {
          // Nenhuma escrita ocorreu nesta consulta. Isola só esta operação;
          // resultados de envios anteriores continuam em reconciliação.
          await bloquear("CONSULTA_OLIST_400",reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return null;
        }
        if(error instanceof FalhaSync && entidade==="SERVICO" && ["IDENTIDADE_INCOMPATIVEL","BUSCA_TRUNCADA"].includes(error.codigo)) {await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return null;}
        if(error instanceof FalhaSync && entidade==="CONTATO" && campos && chaveContatoSync(campos)?.startsWith("nome:") && ["IDENTIDADE_INCOMPATIVEL","BUSCA_TRUNCADA"].includes(error.codigo)) {
          await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return null;
        }
        if(!(error instanceof FalhaSync) || error.codigo!=="CONTA_ALTERADA")throw error;
        await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return null;
      }
    }
    const catalogoConta=(alvo:string)=>lerCatalogoTiposContatoSync(catalogos[alvo],String(identidadeEsperada(alvo)??""));
    if(entidade==="CONTATO") {
      for(const alvo of reconciliando?[app]:[...fontes,app]) {
        const conta=identidadeEsperada(alvo);
        if(typeof conta!=="string" || !conta) {await bloquear("CONTA_NAO_VERIFICADA",reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
        let catalogo=catalogoConta(alvo);
        if(catalogo && (agora().getTime()-Date.parse(catalogo.coletadoEm)>VALIDADE_CATALOGO_TIPOS_MS || Date.parse(catalogo.coletadoEm)>agora().getTime()))catalogo=null;
        if(!catalogo || catalogo.offset!==catalogo.total) {
          try {catalogos[alvo]={...await paginaTipos(r,alvo,grupo,conta,catalogo)};}
          catch(error) {
            if(error instanceof FalhaSync && !error.recuperavel && !["JOB_PAUSADO","AGUARDANDO_CONTA","PRONTIDAO_PENDENTE","LEASE_PERDIDA"].includes(error.codigo)) {await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
            throw error;
          }
          await checkpoint({...cursor,catalogosTiposContato:catalogos,catalogosVendedoresCriptografados:catalogosVendedores});return;
        }
      }
      try {payloadTiposContatoSync(campos,catalogoConta(app)?.itens);}
      catch(error) {if(!(error instanceof FalhaSync))throw error;await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
    }
    const catalogoVendedoresConta=(alvo:string)=>lerVendedores(catalogosVendedores[alvo],grupo,alvo,String(identidadeEsperada(alvo)??""));
    let vendedorDestinoId:string|null|undefined;
    if(entidade==="CONTATO") {
      for(const alvo of reconciliando?[app]:[...fontes,app]) {
        const conta=identidadeEsperada(alvo);
        if(typeof conta!=="string" || !conta) {await bloquear("CONTA_NAO_VERIFICADA",reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
        let catalogo=catalogoVendedoresConta(alvo);
        if(catalogo && (agora().getTime()-Date.parse(catalogo.coletadoEm)>VALIDADE_CATALOGO_VENDEDORES_MS || Date.parse(catalogo.coletadoEm)>agora().getTime()))catalogo=null;
        if(!catalogo || catalogo.offset!==catalogo.total) {
          try {catalogosVendedores[alvo]=c.cifrar({...await paginaVendedores(r,alvo,grupo,conta,catalogo)},contextoVendedores(grupo,alvo));}
          catch(error) {
            if(error instanceof FalhaSync && !error.recuperavel && !["JOB_PAUSADO","AGUARDANDO_CONTA","PRONTIDAO_PENDENTE","LEASE_PERDIDA"].includes(error.codigo)) {await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
            throw error;
          }
          await checkpoint({...cursor});return;
        }
      }
      try {
        if(reconciliando && typeof plan.vendedorEnviadoCriptografado==="string") {
          const id=c.decifrar(plan.vendedorEnviadoCriptografado,`${contextoOperacao(grupo,operacao.id)}:vendedor-enviado`);
          if(id!==null && typeof id!=="string")throw new FalhaSync("VENDEDOR_CONTATO_INVALIDO","Revalide o vendedor da operação.");
          vendedorDestinoId=id;
        } else if(plan.preservarVendedor===true) {
          if(typeof plan.vendedorPreservadoCriptografado!=="string")throw new FalhaSync("VENDEDOR_CONTATO_INVALIDO","Reaudite o vínculo do vendedor.");
          const id=c.decifrar(plan.vendedorPreservadoCriptografado,`${contextoOperacao(grupo,operacao.id)}:vendedor-preservado`);
          if(id!==null && typeof id!=="string")throw new FalhaSync("VENDEDOR_CONTATO_INVALIDO","Revalide o vendedor preservado.");
          vendedorDestinoId=id;
        } else vendedorDestinoId=campos.vendedorNome===null?null:idVendedorPorNomeSync(campos.vendedorNome,catalogoVendedoresConta(app)?.itens);
      } catch(error) {if(!(error instanceof FalhaSync))throw error;await bloquear(error.codigo,reconciliando?"RESULTADO_INCONCLUSIVO":"OBSOLETA");return;}
    }
    const ignorarObservado=async(alvo:string,obs:ObservacaoRemota)=>repo.comReserva(r,async tx=>{
      // Uma busca pode encontrar um destino ignorado que nunca teve estado local.
      // Propostas não enviadas são retiradas; efeitos enviados ficam em quarentena.
      if(reconciliando)await tx.olistSyncOperacao.updateMany({where:{id:operacao.id,configuracaoId:grupo},data:{status:"RESULTADO_INCONCLUSIVO",erroCodigo:"PRODUTO_FORA_ESCOPO",execucaoId:e.execucaoId}});
      else await tx.olistSyncOperacao.deleteMany({where:{id:operacao.id,configuracaoId:grupo,status:{in:["AUTORIZADA","PROPOSTA"]}}});
      await ignorarProduto(tx,grupo,e.execucaoId,alvo,obs.id);
      if(alvo===app && await tx.olistSyncRegistro.findFirst({where:{id:operacao.registroId,configuracaoId:grupo},select:{id:true}}))
        await pendencia(tx,{grupo,execucaoId:e.execucaoId,registroId:operacao.registroId,entidade:"PRODUTO",tipo:"DESTINO_FORA_ESCOPO",chave:`registro:${operacao.registroId}`,detalhes:{motivos:["DESTINO_FORA_ESCOPO"]}});
    });
    const observarConta=(alvo:string,obs:ObservacaoRemota)=>entidade==="CONTATO"?resolverVendedorContatoSync(resolverTiposContatoSync(obs,catalogoConta(alvo)?.itens??[]),catalogoVendedoresConta(alvo)?.itens??[]):obs;
    const chaveEsperada=entidade==="PRODUTO"?campos.sku:entidade==="SERVICO"?chaveServicoSync(campos):chaveContatoSync(campos);
    const observacaoPermitida=(obs:ObservacaoRemota)=>obs.completo && obs.chave===chaveEsperada
      && (entidade==="PRODUTO"?obs.situacao==="A" && nomeProdutoElegivelSync(obs.nome):entidade==="SERVICO"?obs.situacao==="A":["A","B"].includes(obs.situacao))
      && !obs.pendencias.some(p=>!p.startsWith("REFERENCIA_")&&p!=="IMAGENS_REQUEREM_VALIDACAO");
    if(fase==="CONTAS") {
      // Compatibilidade com checkpoints antigos: cada consulta agora valida sua
      // própria credencial, em vez de confiar numa identidade lida em outra etapa.
      await checkpoint({operacaoId:operacao.id,fase:"FONTES"});return;
    }
    if(!reconciliando && precisaComponentes && producao && fase!=="COMPONENTE_DETALHE") {
      const componente=producao.produtos.find(p=>typeof componentes[p.sku]!=="string");
      if(componente) {
        if(componente.sku===campos.sku) {await bloquear("PRODUCAO_CICLICA");return;}
        const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,"PRODUTO",componente.sku,protegerConsulta(app)));
        if(!encontrados)return;
        if(encontrados.length!==1 || !nomeProdutoElegivelSync(encontrados[0].nome) || encontrados[0].situacao!=="A") {
          const pendente=await db.olistSyncOperacao.findFirst({where:{configuracaoId:grupo,destinoAppId:app,status:"AUTORIZADA",id:{not:operacao.id},registro:{entidade:"PRODUTO",chave:componente.sku}},select:{id:true}});
          const esperas=typeof plan.esperasComponentes==="number"?plan.esperasComponentes:0;
          if(!encontrados.length && pendente && esperas<100) {
            await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{erroCodigo:"AGUARDANDO_COMPONENTES",precondicoesJson:{...plan,esperasComponentes:esperas+1}},select:{id:true}}));
            await checkpoint({},new Date(agora().getTime()+5_000));return;
          }
          await bloquear("COMPONENTE_NAO_MAPEADO");return;
        }
        // Uma chamada por checkpoint respeita a cota e não perde o progresso.
        const resumo=encontrados[0];
        await checkpoint({operacaoId:operacao.id,fase:"COMPONENTE_DETALHE",componenteSku:componente.sku,componenteId:resumo.id,componentesProduto:componentes,inicioComponentes:cursor.inicioComponentes??agora().getTime(),iniciadaEm:cursor.iniciadaEm??agora().getTime()});return;
      }
    }
    if(fase==="COMPONENTE_DETALHE") {
      if(typeof cursor.componenteId!=="string" || typeof cursor.componenteSku!=="string") {await bloquear("COMPONENTE_NAO_MAPEADO");return;}
      const obs=await consultar(app,()=>cliente.detalhar(app,"PRODUTO",String(cursor.componenteId),protegerConsulta(app)));
      if(!obs)return;
      if(!nomeProdutoElegivelSync(obs.nome) || obs.chave!==cursor.componenteSku || !["S","M","F"].includes(obs.tipo??"") || obs.situacao!=="A" || obs.paiId || obs.pendencias.some(p=>!p.startsWith("REFERENCIA_")&&p!=="IMAGENS_REQUEREM_VALIDACAO")) {
        await bloquear("COMPONENTE_NAO_MAPEADO");return;
      }
      await checkpoint({operacaoId:operacao.id,fase:"FONTES",indice:0,iniciadaEm:cursor.iniciadaEm??agora().getTime(),inicioComponentes:cursor.inicioComponentes??agora().getTime(),componentesProduto:{...componentes,[cursor.componenteSku]:obs.id}});return;
    }
    if(fase==="FONTES") {
      const indice=typeof cursor.indice==="number"?cursor.indice:0, fonte=fontes[indice];
      if(fonte) {
        const anterior=objetoJson(replicas[fonte]);
        if(typeof anterior.remoteId!=="string") {await bloquear("FONTE_INVALIDA");return;}
        const remoto=await consultar(fonte,()=>cliente.detalhar(fonte,entidade,anterior.remoteId as string,protegerConsulta(fonte)));
        const obs=remoto?observarConta(fonte,remoto):null;
        if(!obs)return;
        if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(obs.nome)) {
          await ignorarObservado(fonte,obs);await checkpoint({});return;
        }
        const hashes=serializarCanonico(gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)));
        // Outra réplica pode já ter recebido a mesma revisão. Aceitar apenas o
        // snapshot original ou o alvo exato mantém bloqueadas mudanças divergentes.
        const original=hashesJson(anterior.hashes);
        const esperadoFonte=entidade==="CONTATO" && plan.preservarVendedor===true
          ? {...hashesEsperados,vendedorNome:original.vendedorNome}:hashesEsperados;
        // Outro destino pode estar entre o PUT do cadastro e o da composição
        // desta mesma revisão. Só esse alvo intermediário exato é equivalente.
        const intermediario=entidade==="PRODUTO" && campos.tipo==="F" && original.producao
          ? {...hashesFinais,producao:original.producao}:hashesEsperados;
        if(entidade==="CONTATO" && anterior.vendedorVinculo!==undefined && c.hash(obs.vendedorContatoRemoto?.id??null,`${grupo}:vendedor-local`)!==anterior.vendedorVinculo) {
          // Outro destino pode já ter recebido esta mesma atribuição.
          let avancou=false;
          if(original.vendedorNome!==hashesEsperados.vendedorNome && hashes===serializarCanonico(hashesEsperados) && typeof campos.vendedorNome==="string") {
            try {avancou=obs.vendedorContatoRemoto?.id===idVendedorPorNomeSync(campos.vendedorNome,catalogoVendedoresConta(fonte)?.itens);}
            catch(erro) {if(!(erro instanceof FalhaSync))throw erro;}
          }
          if(!avancou) {await bloquear("FONTE_ALTERADA");return;}
        }
        if(!observacaoPermitida(obs) || ![original,esperadoFonte,hashesEsperados,hashesFinais,intermediario].some(alvo=>hashes===serializarCanonico(alvo))) {await bloquear("FONTE_ALTERADA");return;}
        if(verificarIdentidadeFonte) {
          // A etapa pertence ao destino, mas a próxima leitura usa a fonte.
          // Adia pela cota dessa fonte para não reiniciar a validação a cada GET.
          const janela=await db.olistSyncParticipante.findUnique({where:{configuracaoId_aplicativoId:{configuracaoId:grupo,aplicativoId:fonte}},select:{proximaChamadaEm:true}});
          await checkpoint({operacaoId:operacao.id,fase:"FONTES_NOME",indice,iniciadaEm:cursor.iniciadaEm??agora().getTime()},janela?.proximaChamadaEm??undefined);return;
        }
        await checkpoint({operacaoId:operacao.id,fase:indice+1<fontes.length?"FONTES":"DESTINO",indice:indice+1,iniciadaEm:typeof cursor.iniciadaEm==="number"?cursor.iniciadaEm:agora().getTime()});return;
      }
      await checkpoint({operacaoId:operacao.id,fase:"DESTINO",iniciadaEm:agora().getTime()});return;
    }
    if(fase==="FONTES_NOME") {
      const indice=typeof cursor.indice==="number"?cursor.indice:0,fonte=fontes[indice];
      if(!fonte || !verificarIdentidadeFonte || typeof chaveEsperada!=="string") {await bloquear("FONTE_INVALIDA");return;}
      const anterior=objetoJson(replicas[fonte]);
      const homonimos=await consultar(fonte,()=>cliente.buscarPorChave(fonte,entidade,chaveEsperada,protegerConsulta(fonte)));
      if(!homonimos)return;
      if(homonimos.length!==1 || homonimos[0].id!==anterior.remoteId) {await bloquear("IDENTIDADE_DUPLICADA");return;}
      if(entidade==="SERVICO") {
        const atual=homonimos[0],hashes=serializarCanonico(gerarHashesCampos(atual.campos,v=>c.hash(v,`${grupo}:campo`)));
        if(!observacaoPermitida(atual) || ![hashesJson(anterior.hashes),hashesEsperados].some(alvo=>hashes===serializarCanonico(alvo))) {await bloquear("FONTE_ALTERADA");return;}
      }
      await checkpoint({operacaoId:operacao.id,fase:indice+1<fontes.length?"FONTES":"DESTINO",indice:indice+1,iniciadaEm:cursor.iniciadaEm??agora().getTime()});return;
    }
    if(fase==="DESTINO") {
      const anterior=objetoJson(replicas[app]);
      if(operacao.acao==="CRIAR") {
        const chave=chaveEsperada;
        if(typeof chave!=="string") {await bloquear("IDENTIDADE_INVALIDA");return;}
        const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,entidade,chave,protegerConsulta(app)));
        if(!encontrados)return;
        if(encontrados.length) {
          if(encontrados.length!==1) {await bloquear("IDENTIDADE_DUPLICADA");return;}
          if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(encontrados[0].nome)) {await ignorarObservado(app,encontrados[0]);await checkpoint({});return;}
          await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"VERIFICANDO",remoteId:encontrados[0].id},select:{id:true}}));
          await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});return;
        }
      } else {
        if(typeof anterior.remoteId!=="string") {await bloquear("DESTINO_INVALIDO");return;}
        const remoto=await consultar(app,()=>cliente.detalhar(app,entidade,anterior.remoteId as string,protegerConsulta(app)));
        const obs=remoto?observarConta(app,remoto):null;
        if(!obs)return;
        if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(obs.nome)) {
          await ignorarObservado(app,obs);await checkpoint({});return;
        }
        if(entidade==="CONTATO" && anterior.vendedorVinculo!==undefined && c.hash(obs.vendedorContatoRemoto?.id??null,`${grupo}:vendedor-local`)!==anterior.vendedorVinculo) {await bloquear("DESTINO_ALTERADO");return;}
        if(!observacaoPermitida(obs) || serializarCanonico(gerarHashesCampos(obs.campos,v=>c.hash(v,`${grupo}:campo`)))!==serializarCanonico(hashesJson(anterior.hashes))) {await bloquear("DESTINO_ALTERADO");return;}
      }
      await checkpoint({operacaoId:operacao.id,fase:entidade==="SERVICO" && operacao.acao!=="CRIAR"?"DESTINO_CHAVE_SERVICO":entidade==="SERVICO" && typeof chaveEsperada==="string" && chaveEsperada.startsWith("codigo:")?"DESTINO_NOME_SERVICO":"ESCREVER",iniciadaEm:cursor.iniciadaEm??agora().getTime()});return;
    }
    if(fase==="DESTINO_CHAVE_SERVICO") {
      if(entidade!=="SERVICO" || typeof chaveEsperada!=="string") {await bloquear("IDENTIDADE_INVALIDA");return;}
      const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,"SERVICO",chaveEsperada,protegerConsulta(app)));
      if(!encontrados)return;
      const anterior=objetoJson(replicas[app]);
      if(encontrados.length!==1 || encontrados[0].id!==anterior.remoteId) {await bloquear("IDENTIDADE_DUPLICADA");return;}
      const atual=encontrados[0];
      if(!observacaoPermitida(atual) || serializarCanonico(gerarHashesCampos(atual.campos,v=>c.hash(v,`${grupo}:campo`)))!==serializarCanonico(hashesJson(anterior.hashes))) {await bloquear("DESTINO_ALTERADO");return;}
      await checkpoint({operacaoId:operacao.id,fase:"ESCREVER",iniciadaEm:cursor.iniciadaEm??agora().getTime()});return;
    }
    if(fase==="DESTINO_NOME_SERVICO") {
      const nome=nomeServicoSync(campos.nome);
      if(entidade!=="SERVICO" || !nome || typeof campos.codigo!=="string") {await bloquear("IDENTIDADE_INVALIDA");return;}
      const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,"SERVICO",`nome:${nome}`,{...protegerConsulta(app),codigoServicoReferencia:String(campos.codigo)}));
      if(!encontrados)return;
      if(encontrados.length) {await bloquear("POSSIVEL_DUPLICIDADE");return;}
      await checkpoint({operacaoId:operacao.id,fase:"ESCREVER",iniciadaEm:cursor.iniciadaEm??agora().getTime()});return;
    }
    if(fase==="ESCREVER") {
      if(precisaComponentes && producao!.produtos.length && (typeof cursor.inicioComponentes!=="number" || agora().getTime()-cursor.inicioComponentes>janelaValidacaoMs)) {await bloquear("JANELA_COMPONENTES_EXCEDIDA");return;}
      if(typeof cursor.iniciadaEm!=="number" || agora().getTime()-cursor.iniciadaEm>janelaValidacaoMs) {await bloquear("JANELA_VALIDACAO_EXCEDIDA");return;}
      prepararPayload(entidade,campos,{operacao:operacao.acao==="CRIAR"?"CRIAR":"ATUALIZAR"});
      const anterior=objetoJson(replicas[app]);
      let envioIniciado=false;
      try {
        const resultado=await chamada(r,app,async()=>{
          const protecao={
            ...ritmoTransporte(app),
            ...(entidade==="CONTATO"?{catalogoTiposContato:catalogoConta(app)?.itens,vendedorDestinoId}:{}),
            ...(precisaComponentes?{componentesProduto:new Map(Object.entries(componentes).filter((p):p is [string,string]=>typeof p[1]==="string")),somenteProducao:plan.somenteProducao===true}:{}),
            validarConta:(identidade:{documento:string})=>c.hash(identidade.documento,`${grupo}:conta`)===identidadeEsperada(app),
            antesDeEscrever:async()=>{
              await repo.comReserva(r,async(tx,atual)=>{
                await validarChamada(tx,atual,app,true);
                if(entidade==="CONTATO" && vendedorDestinoId!==undefined)await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{precondicoesJson:{...plan,vendedorEnviadoCriptografado:c.cifrar(vendedorDestinoId,`${contextoOperacao(grupo,operacao.id)}:vendedor-enviado`)}},select:{id:true}});
                if(agora().getTime()-Number(cursor.iniciadaEm)>janelaValidacaoMs || precisaComponentes && producao!.produtos.length>0 && agora().getTime()-Number(cursor.inicioComponentes)>janelaValidacaoMs)throw new FalhaSync("JANELA_VALIDACAO_EXCEDIDA","Revalide os cadastros antes de escrever.");
                const marcada=await tx.olistSyncOperacao.updateMany({where:{id:operacao.id,status:"AUTORIZADA",registro:{revisao:operacao.revisao}},data:{status:"EM_APLICACAO",erroCodigo:null,execucaoId:e.execucaoId,tentativas:{increment:1}}});
                if(marcada.count!==1)throw new FalhaSync("PROPOSTA_OBSOLETA","A proposta mudou antes de enviar a escrita.");
                // Persistido junto do início do envio: interrupção/429 também
                // consome orçamento, sem depender de contagens do catálogo.
                loteConsumidas++;
                await tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:{...objetoJson(atual.cursorJson),loteConsumidas,falhasConfirmacao}},select:{id:true}});
              });
              envioIniciado=true;
            },
          };
          return operacao.acao==="CRIAR"?cliente.criar(app,entidade,campos,protecao):cliente.atualizar(app,entidade,String(anterior.remoteId),campos,protecao);
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
          await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{operacaoId:operacao.id,fase:"CONTAS",loteConsumidas,falhasConfirmacao,...(entidade==="CONTATO"?{catalogosTiposContato:catalogos,catalogosVendedoresCriptografados:catalogosVendedores}:{})},disponivelEm:prazoRetrySync(operacao.tentativas+1,agora(),error.retryAfterMs)});return;
        }
        if(error instanceof FalhaSync && !error.inconclusivo) {await bloquear(error.codigo,"FALHA_PERMANENTE");return;}
        await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"RESULTADO_INCONCLUSIVO",erroCodigo:"RESPOSTA_INCERTA"},select:{id:true}}));
        await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});
      }
      return;
    }
    let remotoId=operacao.remoteId;
    if(!remotoId) {
      const chave=chaveEsperada;
      if(typeof chave!=="string") {await bloquear("RESULTADO_INCONCLUSIVO","RESULTADO_INCONCLUSIVO");return;}
      const encontrados=await consultar(app,()=>cliente.buscarPorChave(app,entidade,chave,protegerConsulta(app,true)));
      if(!encontrados)return;
      if(encontrados.length!==1) {await bloquear("RESULTADO_INCONCLUSIVO","RESULTADO_INCONCLUSIVO");return;}
      if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(encontrados[0].nome)) {await ignorarObservado(app,encontrados[0]);await checkpoint({});return;}
      remotoId=encontrados[0].id;
      await repo.comReserva(r,tx=>tx.olistSyncOperacao.update({where:{id:operacao.id},data:{remoteId:remotoId,status:"VERIFICANDO"},select:{id:true}}));
      await checkpoint({operacaoId:operacao.id,fase:"VERIFICAR"});return;
    }
    const remoto=await consultar(app,()=>cliente.detalhar(app,entidade,remotoId!,protegerConsulta(app,true)));
    const observado=remoto?observarConta(app,remoto):null;
    if(!observado)return;
    if(entidade==="PRODUTO" && !nomeProdutoElegivelSync(observado.nome)) {
      await ignorarObservado(app,observado);await checkpoint({});return;
    }
    const obtidos=gerarHashesCampos(observado.campos,v=>c.hash(v,`${grupo}:campo`));
    const camposDivergentes=Object.keys(hashesEsperados).filter(campo=>hashesEsperados[campo]!==obtidos[campo]);
    if(entidade==="CONTATO" && (observado.vendedorContatoRemoto?.id??null)!==vendedorDestinoId)camposDivergentes.push("vendedorVinculo");
    if(!observacaoPermitida(observado) || camposDivergentes.length) {await bloquear("VERIFICACAO_DIVERGENTE","RESULTADO_INCONCLUSIVO",camposDivergentes);return;}
    await repo.comReserva(r,async tx=>{
      await tx.$queryRaw`SELECT id FROM olist_sync_registro WHERE id=${operacao.registroId}::uuid FOR UPDATE`;
      const registro=await tx.olistSyncRegistro.findUniqueOrThrow({where:{id:operacao.registroId},select:{revisao:true}});
      const revisaoAtual=registro.revisao===operacao.revisao;
      if(revisaoAtual) {
        await gravarObservacao(tx,grupo,e.execucaoId,app,entidade,observado,{aplicacao:true});
        await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,registroId:operacao.registroId,aplicativoId:app},data:{status:plan.producaoPendenteCriptografada?"DIVERGENTE":"SINCRONIZADO",revisaoAplicada:operacao.revisao,ultimaFonteAppId:operacao.sourceAppId}});
        await tx.olistSyncRegistro.update({where:{id:operacao.registroId},data:{ultimaFonteAppId:operacao.sourceAppId},select:{id:true}});
      }
      await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"CONFIRMADA",confirmadaEm:agora(),erroCodigo:null},select:{id:true}});
      if(revisaoAtual && typeof plan.producaoPendenteCriptografada==="string" && operacao.acao==="ATUALIZAR") {
        const finais={...campos,producao:producaoCanonicaSync(c.decifrar(String(plan.producaoPendenteCriptografada),`${contextoOperacao(grupo,operacao.id)}:producao`))};
        const proximasReplicas={...replicas,[app]:{remoteId:remotoId,hashes:obtidos}};
        const restante={...plan};delete restante.producaoPendenteCriptografada;
        // A transição de alvo/etapa é atômica com a confirmação anterior. Uma
        // recuperação só pode reenviar a próxima etapa, nunca o PUT já confirmado.
        await tx.olistSyncOperacao.update({where:{id:operacao.id},data:{status:"AUTORIZADA",confirmadaEm:null,tentativas:0,precondicoesJson:{...restante,somenteProducao:true,replicas:proximasReplicas},payloadCriptografado:c.cifrar(finais,contextoOperacao(grupo,operacao.id))},select:{id:true}});
      }
      const faltantes=await tx.olistSyncOperacao.count({where:{registroId:operacao.registroId,revisao:operacao.revisao,status:{not:"CONFIRMADA"}}});
      if(!faltantes&&revisaoAtual) {
        await tx.olistSyncRegistro.update({where:{id:operacao.registroId},data:{hashesBaseJson:entidade==="CONTATO"?{...hashesEsperados,...Object.fromEntries(Object.entries(hashesJson(plan.hashesBaseContato)).filter(([campo])=>ehBaseVendedorContato(campo)))}:hashesEsperados},select:{id:true}});
        const basesContato=hashesJson(plan.hashesBaseContato);
        const alvos=e.execucao.configuracao.participantes.map(p=>({aplicativoId:p.aplicativoId,hashesJson:{equals:
          entidade==="CONTATO" && basesContato[chaveBaseVendedorContato(p.aplicativoId)]!==undefined
            ? {...hashesEsperados,vendedorNome:basesContato[chaveBaseVendedorContato(p.aplicativoId)]}:hashesEsperados}}));
        // Preservação permite vendedores diferentes. Os demais campos e a revisão
        // continuam precisando corresponder exatamente ao alvo confirmado.
        await tx.olistSyncEstado.updateMany({where:{configuracaoId:grupo,registroId:operacao.registroId,presente:true,OR:alvos},data:{status:"SINCRONIZADO",revisaoAplicada:operacao.revisao}});
        if(entidade==="CONTATO")await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,registroId:operacao.registroId,
          chaveDedupe:c.hash(`registro:${operacao.registroId}`,`${grupo}:pendencia`),status:"AGUARDANDO_REVISAO",tipo:{in:PENDENCIAS_VENDEDOR_CONTATO}},data:{status:"RESOLVIDA",decididoEm:agora()}});
      }
      await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,chaveDedupe:c.hash(`operacao:${operacao.id}`,`${grupo}:pendencia`),status:"AGUARDANDO_REVISAO"},data:{status:"RESOLVIDA",decididoEm:agora()}});
      // O antigo bloqueio por volume não representa conflito de conteúdo.
      await tx.olistSyncPendencia.updateMany({where:{configuracaoId:grupo,aplicativoId:app,entidade,tipo:"LIMITE_ALTERACOES",status:"AGUARDANDO_REVISAO"},data:{status:"RESOLVIDA",decididoEm:agora()}});
      await tx.olistSyncEvento.create({data:{configuracaoId:grupo,execucaoId:e.execucaoId,registroId:operacao.registroId,tipo:"ESCRITA_CONFIRMADA",metadadosJson:{operacaoId:operacao.id,sourceAppId:operacao.sourceAppId,destinoAppId:app,revisao:operacao.revisao,acao:operacao.acao,fontesPorCampo:plan.fontesPorCampo??{}}},select:{id:true}});
      if(!plan.producaoPendenteCriptografada)await contar(tx,e.execucaoId,operacao.acao==="CRIAR"?"criados":"atualizados");
    });
    falhasConfirmacao=0;
    await checkpoint({});
  }

  async function processar(r:Reserva) {
    try {
      // Compartilha a leitura atual com o handler. Gates e lease continuam
      // sendo revalidados antes dos efeitos e de cada HTTP.
      const e=await dadosReserva(r);
      if(e.fase==="LISTAR")await listar(r,e);
      else if(e.fase==="DETALHAR")await detalhar(r,e);
      else if(e.fase==="COMPARAR")await comparar(r,e);
      else if(e.fase==="APLICAR")await aplicar(r,e);
      else throw new FalhaSync("ETAPA_INVALIDA","Etapa não suportada.");
    } catch(error) {
      const falha=error instanceof FalhaSync?error:new FalhaSync("FALHA_INTERNA","Falha ao processar a etapa.",true);
      if(falha.status===429 && falha.recuperavel && !falha.inconclusivo) {
        const e=await dadosReserva(r),cursor=objetoJson(e.cursorJson);
        if(e.fase==="APLICAR" && ["FONTES","FONTES_NOME","DESTINO","DESTINO_NOME_SERVICO","DESTINO_CHAVE_SERVICO","ESCREVER"].includes(String(cursor.fase))) {
          // Um 429 de leitura mantém o orçamento de tentativas da etapa, mas a
          // retomada precisa refazer as pré-condições após o Retry-After.
          cursor.fase="FONTES";cursor.indice=0;delete cursor.iniciadaEm;
          await repo.comReserva(r,tx=>tx.olistSyncEtapa.update({where:{id:r.id},data:{cursorJson:cursor},select:{id:true}}));
        }
      }
      if(["AGUARDANDO_CONTA","COTA_OLIST","JOB_PAUSADO"].includes(falha.codigo)) {
        const e=await dadosReserva(r);
        const cursor=objetoJson(e.cursorJson);
        if(e.fase==="APLICAR" && ["AGUARDANDO_CONTA","COTA_OLIST"].includes(falha.codigo)
          && ["FONTES","FONTES_NOME","DESTINO","DESTINO_NOME_SERVICO","DESTINO_CHAVE_SERVICO","ESCREVER"].includes(String(cursor.fase))) {
          // Espera de cota não é mudança do cadastro. Refaz pré-condições sem
          // descartar a proposta nem reutilizar uma janela vencida após a pausa.
          cursor.fase="FONTES";cursor.indice=0;delete cursor.iniciadaEm;
        }
        await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor,disponivelEm:new Date(agora().getTime()+Math.max(250,falha.retryAfterMs||10_000))});
      } else if(falha.codigo==="PRONTIDAO_PENDENTE") {
        await repo.salvarCheckpoint({etapaId:r.id,leaseToken:r.leaseToken,cursor:{},status:"CONCLUIDA"});
      } else {
        await repo.falharEtapa(r,falha.codigo,falha.recuperavel?prazoRetrySync(r.tentativas,agora(),falha.retryAfterMs).getTime()-agora().getTime():null);
      }
    }
    // Enquanto há outra fase ativa, uma consulta de existência dispensa a
    // transação de finalização. O fechamento mantém sua checagem sob lock.
    const ativa=await db.olistSyncEtapa.findFirst({where:{execucaoId:r.execucaoId,status:{in:["PENDENTE","PROCESSANDO","AGUARDANDO_RETRY"]}},select:{id:true}});
    if(!ativa)await repo.concluirExecucaoQuandoPossivel(r.execucaoId);
  }

  async function agendar() {
    const configs=await db.olistSyncConfiguracao.findMany({where:{ativo:true,OR:[{proximaExecucaoEm:null},{proximaExecucaoEm:{lte:agora()}}]},orderBy:{id:"asc"},take:20,select:{id:true,horaDiaria:true,timezone:true,autorizadoPor:true,proximaExecucaoEm:true}});
    let agendadas=0;
    for(const config of configs) {
      if(!(await repo.disponibilidade(config.id,"agendar-sincronizacao-olist")).habilitado)continue;
      if(!config.proximaExecucaoEm) {await db.olistSyncConfiguracao.update({where:{id:config.id},data:{proximaExecucaoEm:proximoHorarioSync(agora(),config.horaDiaria,config.timezone)},select:{id:true}});continue;}
      try {
        await repo.enfileirar({configuracaoId:config.id,modo:"AUDITAR_E_APLICAR",idempotencia:idAgendamento(config.id,config.proximaExecucaoEm),solicitadoPor:config.autorizadoPor,origem:"AGENDADA",completa:false});
        await db.olistSyncConfiguracao.updateMany({where:{id:config.id,proximaExecucaoEm:config.proximaExecucaoEm},data:{proximaExecucaoEm:proximoHorarioSync(agora(),config.horaDiaria,config.timezone)}}); agendadas++;
      } catch { /* Outra execução ativa ou controle pausado: não perde a data pendente. */ }
    }
    return agendadas;
  }

  async function executar(prazo=agora().getTime()+240_000) {
    const agendadas=await agendar(); let etapas=0;
    let ultimaRecuperacao=-Infinity, reservasProntasSemProgresso=0;
    // Reserva também OAuth inicial, uma renovação após 401 e duas consultas de 20s.
    // Uma etapa iniciada perto do fim não pode ultrapassar o orçamento do cron.
    const margemEtapaMs=120_000;
    while(agora().getTime()<prazo-margemEtapaMs) {
      // Recuperação global é manutenção periódica; gates/locks da reserva e
      // autorização antes de cada HTTP permanecem ativos em todas as etapas.
      const recuperar=agora().getTime()-ultimaRecuperacao>=30_000;
      if(recuperar)ultimaRecuperacao=agora().getTime();
      const r=await repo.reservarEtapa({agora:agora(),leaseMs:180_000,recuperar});
      if(!r) {
        const proxima=await repo.proximaJanelaEtapa({agora:agora(),limiteMs:12_000});
        if(!proxima)break;
        const espera=Math.ceil(proxima.getTime()-agora().getTime());
        // A janela pode vencer durante o I/O do banco. Isso pede nova reserva,
        // não saída até o próximo cron. Contenção repetida não pode gerar spin.
        if(espera<=0) {
          if(++reservasProntasSemProgresso>3 || agora().getTime()+100>=prazo-margemEtapaMs)break;
          await aguardar(100);
          continue;
        }
        // Só uma janela curta de trabalho já elegível mantém a invocação viva.
        // Pausas, fila vazia, retries longos e falta de orçamento terminam sem polling.
        if(espera>12_000 || agora().getTime()+espera>=prazo-margemEtapaMs)break;
        await aguardar(espera);
        continue;
      }
      reservasProntasSemProgresso=0;
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
