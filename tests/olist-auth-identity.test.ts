import test from 'node:test';
import assert from 'node:assert/strict';

test('identidade autenticada prioriza UUID, não troca tenant por e-mail e respeita desativação',async t=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='fake';
  let encontrado: {id:string;ativo:boolean;aplicativoId:string}|null={id:'auth-id',ativo:true,aplicativoId:'app-a'};
  let candidatos=[{id:'legacy-id',ativo:true,aplicativoId:'app-b'}];
  let consultasEmail=0;
  Object.assign(globalThis,{prisma:{usuario:{
    findFirst:async({where}:{where:Record<string,unknown>})=>{assert.deepEqual(where,{id:'auth-id'});return encontrado;},
    findMany:async({take}:{take:number})=>{consultasEmail++;assert.equal(take,2);return candidatos;},
  }}});
  let confirmado=true;
  const {supabaseAdmin}=await import('../src/lib/supabase-admin');
  t.mock.method(supabaseAdmin.auth,'getUser',async()=>({data:{user:{id:'auth-id',email:'usuario@example.test',email_confirmed_at:confirmado?'2026-11-01T00:00:00Z':undefined}},error:null}));
  const {getUsuarioAutenticado}=await import('../src/lib/usuario-autenticado');
  const request=()=>new Request('https://example.test',{headers:{authorization:'Bearer test'}});
  assert.equal((await getUsuarioAutenticado(request())).aplicativoId,'app-a');
  assert.equal(consultasEmail,0);
  encontrado={id:'auth-id',ativo:false,aplicativoId:'app-a'};
  await assert.rejects(getUsuarioAutenticado(request()),/desativado/);assert.equal(consultasEmail,0);
  encontrado=null;confirmado=false;
  await assert.rejects(getUsuarioAutenticado(request()),/inequívoco/);assert.equal(consultasEmail,0);
  confirmado=true;
  assert.equal((await getUsuarioAutenticado(request())).id,'legacy-id');
  candidatos.push({id:'legacy-other',ativo:true,aplicativoId:'app-c'});
  await assert.rejects(getUsuarioAutenticado(request()),/inequívoco/);
});
