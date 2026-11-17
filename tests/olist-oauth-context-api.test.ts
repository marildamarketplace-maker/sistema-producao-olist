import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { NextRequest } from 'next/server';
import { assinarContextoOlist, verificarContextoOlist, COOKIE_CONTEXTO_OLIST } from '../src/lib/olist-oauth-contexto';

test('OAuth vincula callback ao usuário e aplicativo assinados e não recebe refresh token na URL',async t=>{
  process.env.OLIST_OAUTH_STATE_SECRET='segredo-local-teste-contexto-mais-32';
  let autorizado=true, chamadas=0, gravacoes=0;
  Object.assign(globalThis,{prisma:{
    usuario:{findFirst:async({where}:{where:Record<string,unknown>})=>{assert.equal(where.id,'usuario-a');assert.equal(where.aplicativoId,'app-a');assert.equal(where.ativo,true);assert.equal(where.podeEditarConfiguracao,true);return autorizado?{id:'usuario-a'}:null;}},
    aplicativo:{findUnique:async()=>({id:'app-a',nome:'Teste',olistClientId:'client-local',olistClientSecret:'secret-local'})},
    integracaoOlistToken:{upsert:async({where,create}:{where:{aplicativoId_provider:{aplicativoId:string}};create:Record<string,unknown>})=>{gravacoes++;assert.equal(where.aplicativoId_provider.aplicativoId,'app-a');assert.equal(create.accessToken,'access-local');return{id:'integracao'};}},
  }});
  t.mock.method(axios,'post',async(_url:unknown,_body:unknown,options:unknown)=>{chamadas++;assert.equal((options as {timeout:number}).timeout,20_000);return{status:200,data:{access_token:'access-local',refresh_token:'refresh-local',expires_in:3600}};});
  const {GET}=await import('../src/app/api/olist/callback/route');
  const cookie=assinarContextoOlist('app-a','usuario-a');const state=verificarContextoOlist(cookie)!.state;
  const request=(query:string)=>new NextRequest(`https://example.test/api/olist/callback?${query}`,{headers:{cookie:`${COOKIE_CONTEXTO_OLIST}=${cookie}; olist_aplicativo_id=app-adulterado`}});
  assert.equal((await GET(request(`refresh_token=refresh-local&state=${state}`))).status,400);
  assert.equal((await GET(request('code=test&state=adulterado'))).status,400);
  assert.equal(chamadas,0);
  autorizado=false;assert.equal((await GET(request(`code=test&state=${state}`))).status,403);assert.equal(chamadas,0);
  autorizado=true;const resposta=await GET(request(`code=test&state=${state}`));
  assert.equal(resposta.status,307);assert.equal(gravacoes,1);assert.equal(chamadas,1);
  assert.match(resposta.headers.get('set-cookie')??'',/olist_oauth_contexto=;.*Max-Age=0/);
});
