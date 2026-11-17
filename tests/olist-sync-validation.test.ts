import test from 'node:test';
import assert from 'node:assert/strict';
import { configuracaoSchema, filtrosSchema, decisaoSchema, execucaoSchema, origemSchema, proximoHorarioSync, prazoRetrySync } from '../src/lib/olist-sync/validacao';
import { assinarContextoOlist, verificarContextoOlist } from '../src/lib/olist-oauth-contexto';

test('agenda usa calendário de São Paulo e consolida próxima ocorrência futura',()=>{
  assert.equal(proximoHorarioSync(new Date('2026-11-16T04:59:30Z'),'02:00').toISOString(),'2026-11-16T05:00:00.000Z');
  assert.equal(proximoHorarioSync(new Date('2026-11-16T05:00:01Z'),'02:00').toISOString(),'2026-11-17T05:00:00.000Z');
});
test('entradas limitam paginação, empresas, alterações e recusam campos imprevistos',()=>{
  assert.equal(filtrosSchema.parse({}).limit,25);
  for(const limit of [0,101,-1,2.5])assert.equal(filtrosSchema.safeParse({limit}).success,false);
  assert.equal(filtrosSchema.parse({origemTipo:'DESCONHECIDA'}).origemTipo,'DESCONHECIDA');
  const entrada={versao:1,ativo:false,entidades:['PRODUTO'],participantesIds:[crypto.randomUUID(),crypto.randomUUID()],horaDiaria:'02:00',limiteAlteracoes:100,prontidao:{sincronizacaoNativaCompativel:false,semanticaPutValidada:false,incrementalValidado:false}};
  assert.equal(configuracaoSchema.safeParse(entrada).success,true);
  assert.equal(configuracaoSchema.safeParse({...entrada,limiteAlteracoes:101}).success,false);
  assert.equal(configuracaoSchema.safeParse({...entrada,aplicativoPaiId:crypto.randomUUID()}).success,false);
  assert.equal(decisaoSchema.safeParse({versao:1,acao:'IGNORAR',motivo:'curto'}).success,false);
});
test('retries têm backoff limitado e respeitam Retry-After dentro do limite',()=>{
  const inicio=new Date('2026-11-16T00:00:00Z');
  assert.equal(prazoRetrySync(1,inicio,0,0).getTime()-inicio.getTime(),60_000);
  assert.equal(prazoRetrySync(5,inicio,0,0).getTime()-inicio.getTime(),480_000);
  assert.equal(prazoRetrySync(1,inicio,600_000,0).getTime()-inicio.getTime(),600_000);
});
test('contexto OAuth assina aplicativo, usuário e state, expira e rejeita adulteração',()=>{
  process.env.OLIST_OAUTH_STATE_SECRET='teste-chave-assinatura-olist-nao-real-32';
  const agora=Date.now(), cookie=assinarContextoOlist('app-a','user-a',agora);
  const contexto=verificarContextoOlist(cookie,agora)!;
  assert.equal(contexto.aplicativoId,'app-a'); assert.equal(contexto.usuarioId,'user-a');
  assert.ok(contexto.state);
  assert.equal(verificarContextoOlist(cookie,agora+600_001),null);
  const [corpo,assinatura]=cookie.split('.');
  const novo=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(corpo,'base64url').toString()),aplicativoId:'app-b'})).toString('base64url');
  assert.equal(verificarContextoOlist(`${novo}.${assinatura}`,agora),null);
  assert.equal(verificarContextoOlist(undefined,agora),null);
});

test('configuração recusa participantes repetidos, excesso de filhos e entidades duplicadas',()=>{
  const ids=Array.from({length:21},()=>crypto.randomUUID());
  const base={versao:1,ativo:false,entidades:['PRODUTO'],participantesIds:ids.slice(0,2),horaDiaria:'02:00',limiteAlteracoes:10,
    prontidao:{sincronizacaoNativaCompativel:false,semanticaPutValidada:false,incrementalValidado:false}};
  for(const participantesIds of [[],[ids[0]],[ids[0],ids[0]],ids])assert.equal(configuracaoSchema.safeParse({...base,participantesIds}).success,false);
  assert.equal(configuracaoSchema.safeParse({...base,participantesIds:ids.slice(0,20)}).success,true);
  assert.equal(configuracaoSchema.safeParse({...base,entidades:['PRODUTO','PRODUTO']}).success,false);
  assert.equal(configuracaoSchema.safeParse({...base,horaDiaria:'24:00'}).success,false);
  assert.equal(configuracaoSchema.safeParse({...base,prontidao:{...base.prontidao,ignorarPermissoes:true}}).success,false);
});

test('aceite de execução exige idempotência válida e não aceita um pai fornecido pelo cliente',()=>{
  const base={modo:'AUDITAR',idempotencia:crypto.randomUUID()};
  assert.deepEqual(execucaoSchema.parse(base),{...base,completa:true});
  for(const input of [{...base,idempotencia:'repetir'}, {...base,modo:'APAGAR'}, {...base,aplicativoPaiId:crypto.randomUUID()}, {...base,completa:'true'}]) {
    assert.equal(execucaoSchema.safeParse(input).success,false);
  }
});

test('declaração de origem exige versão, justificativa e ID remoto sem interpolação',()=>{
  const base={revisao:1,aplicativoOrigemId:crypto.randomUUID(),registroOlistOrigemId:'123',motivo:'Origem conferida no cadastro original',idempotencia:crypto.randomUUID()};
  assert.equal(origemSchema.safeParse(base).success,true);
  for(const input of [{...base,revisao:0},{...base,motivo:'          '},{...base,registroOlistOrigemId:'../123'}, {...base,registroOlistOrigemId:'1'.repeat(31)}, {...base,forcar:true}]) {
    assert.equal(origemSchema.safeParse(input).success,false);
  }
});

test('equivalência manual recusa duas identidades da mesma empresa e IDs malformados',()=>{
  const app=crypto.randomUUID();
  const base={versao:1,acao:'VINCULAR',motivo:'Equivalência conferida por responsável',vinculos:[{aplicativoId:app,registroOlistId:'123'},{aplicativoId:crypto.randomUUID(),registroOlistId:'456'}]};
  assert.equal(decisaoSchema.safeParse(base).success,true);
  assert.equal(decisaoSchema.safeParse({...base,vinculos:[base.vinculos[0],{aplicativoId:app,registroOlistId:'456'}]}).success,false);
  assert.equal(decisaoSchema.safeParse({...base,vinculos:[base.vinculos[0],{aplicativoId:crypto.randomUUID(),registroOlistId:'1?alterar=true'}]}).success,false);
});

test('backoff preserva limite e a agenda atravessa virada de ano no fuso do grupo',()=>{
  const inicio=new Date('2026-12-31T23:59:00Z');
  assert.equal(proximoHorarioSync(inicio,'00:00').toISOString(),'2027-01-01T03:00:00.000Z');
  assert.equal(prazoRetrySync(20,inicio,0,0).getTime()-inicio.getTime(),480_000);
  const comJitter=prazoRetrySync(1,inicio,0,0.999).getTime()-inicio.getTime();
  assert.ok(comJitter>=60_000 && comJitter<75_000);
  assert.equal(prazoRetrySync(1,inicio,86_400_000,0).getTime()-inicio.getTime(),1_800_000);
});
