import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prepararBancoVendedores,cadastrarFornecedorTeste,confirmarVendedorTeste,
  idsVendedores as i,idVendedorTeste as id } from "./helpers/vendedores-fornecedores-banco";

const url=process.env.VENDEDORES_CONCURRENCY_TEST_DATABASE_URL;
const barreira=()=>{
  let liberar=()=>{};
  const promessa=new Promise<void>(resolve=>{liberar=resolve;});
  return {promessa,liberar};
};

test("vendedores fornecedores: protocolo real entre sessões PostgreSQL",{skip:!url,timeout:45_000},async t=>{
  const endereco=new URL(url!);
  assert.ok(["localhost","127.0.0.1"].includes(endereco.hostname),"Somente banco local descartável.");
  assert.match(endereco.pathname,/^\/vendedores_test_concurrency(?:_[a-z0-9]+)?$/);
  const sql=new Client({connectionString:url!});
  await sql.connect();t.after(()=>sql.end());
  assert.equal((await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'")).rows[0].total,0,"Exige banco de teste vazio.");
  const fixture={exec:async(text:string)=>{await sql.query(text);},query:async<T>(text:string,params?:unknown[])=>{
    const result=await sql.query(text,params);return {rows:result.rows as T[]};
  }};
  await prepararBancoVendedores(fixture);
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:url!,max:4})});
  t.after(()=>db.$disconnect());
  Object.assign(globalThis,{prisma:db});
  const {bloquearRelacaoFornecedor}=await import("../src/lib/fornecedor-relacao");
  const {substituirVendedoresExternosOlist,substituirVendedoresOlist}=await import("../src/lib/usuario-vendedor-olist");
  const modoAnterior=process.env.OLIST_VENDEDORES_COMPAT_LEGADO;
  process.env.OLIST_VENDEDORES_COMPAT_LEGADO="false";
  t.after(()=>{if(modoAnterior===undefined) delete process.env.OLIST_VENDEDORES_COMPAT_LEGADO;else process.env.OLIST_VENDEDORES_COMPAT_LEGADO=modoAnterior;});
  const versao=async()=>Number((await sql.query("SELECT vinculos_olist_versao AS v FROM usuario WHERE id=$1",[i.usuario])).rows[0].v);
  const aguardarLock=async()=>{
    const fim=Date.now()+5_000;
    while(Date.now()<fim) {
      const r=await sql.query("SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'");
      if(r.rows[0].total>0)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail("A sessão concorrente não atingiu a barreira de lock.");
  };
  await cadastrarFornecedorTeste(fixture);await cadastrarFornecedorTeste(fixture,i.duplicado);
  await cadastrarFornecedorTeste(fixture,i.outroFornecedor,i.outraMatriz);
  await confirmarVendedorTeste(fixture);await confirmarVendedorTeste(fixture,i.outraMatriz,i.outraMatriz,300);

  await t.test("duas exclusões de duplicados são serializadas por par e revogam ao terminar o último",async()=>{
    const adquirido=barreira(),seguir=barreira();
    const a=db.$transaction(async tx=>{
      await bloquearRelacaoFornecedor(tx,i.cliente,i.matriz);adquirido.liberar();await seguir.promessa;
      await tx.fornecedor.delete({where:{id:i.fornecedor},select:{id:true}});
    },{timeout:10_000});
    await adquirido.promessa;
    const b=db.$transaction(async tx=>{
      await bloquearRelacaoFornecedor(tx,i.cliente,i.matriz);
      await tx.fornecedor.delete({where:{id:i.duplicado},select:{id:true}});
    },{timeout:10_000});
    try {await aguardarLock();}finally {seguir.liberar();}
    await Promise.all([a,b]);
    const r=await sql.query("SELECT revogado_em FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.filial]);
    assert.ok(r.rows[0].revogado_em);
  });
  await t.test("edição interna preserva fornecedor externo; no-op não altera revisão da empresa",async()=>{
    await cadastrarFornecedorTeste(fixture,id(24));
    const expected=await versao();
    await db.$transaction(tx=>substituirVendedoresExternosOlist(tx,i.usuario,i.cliente,i.matriz,[{aplicativoId:i.filial,vendedorOlistId:201}],expected,i.operador));
    const revisao=Number((await sql.query("SELECT revisao FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.filial])).rows[0].revisao);
    const same=await versao();
    await db.$transaction(tx=>substituirVendedoresExternosOlist(tx,i.usuario,i.cliente,i.matriz,[{aplicativoId:i.filial,vendedorOlistId:201}],same,i.operador));
    assert.equal(Number((await sql.query("SELECT revisao FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.filial])).rows[0].revisao),revisao);
    const interno=await versao();
    await db.$transaction(tx=>substituirVendedoresOlist(tx,i.usuario,i.cliente,[],interno));
    const r=await sql.query("SELECT aplicativo_id,revogado_em FROM usuario_vendedor_olist WHERE usuario_id=$1 ORDER BY aplicativo_id",[i.usuario]);
    assert.deepEqual(r.rows.map(v=>v.aplicativo_id),[i.filial,i.outraMatriz]);
    assert.ok(r.rows.every(v=>v.revogado_em===null));
  });
  await t.test("encerrar × salvar rejeita versão anterior sem reativar vínculo",async()=>{
    const expected=await versao(),adquirido=barreira(),seguir=barreira();
    const a=db.$transaction(async tx=>{
      await bloquearRelacaoFornecedor(tx,i.cliente,i.matriz);adquirido.liberar();await seguir.promessa;
      await tx.fornecedor.update({where:{id:id(24)},data:{ativo:false},select:{id:true}});
    },{timeout:10_000});
    await adquirido.promessa;
    const b=db.$transaction(tx=>substituirVendedoresExternosOlist(tx,i.usuario,i.cliente,i.matriz,[{aplicativoId:i.filial,vendedorOlistId:201}],expected,i.operador),{timeout:10_000});
    const rejeitado=assert.rejects(b,/vínculos foram alterados/i);
    try {await aguardarLock();}finally {seguir.liberar();}
    await a;await rejeitado;
    assert.ok((await sql.query("SELECT revogado_em FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.filial])).rows[0].revogado_em);
  });
  await t.test("recadastro concorrente não permite confirmar com versão anterior ao encerramento",async()=>{
    await cadastrarFornecedorTeste(fixture,id(25));await confirmarVendedorTeste(fixture);
    const expected=await versao(),adquirido=barreira(),seguir=barreira();
    const a=db.$transaction(async tx=>{
      await bloquearRelacaoFornecedor(tx,i.cliente,i.matriz);adquirido.liberar();await seguir.promessa;
      await tx.fornecedor.update({where:{id:id(25)},data:{ativo:false},select:{id:true}});
      await tx.$executeRaw`INSERT INTO fornecedores(id,aplicativo_id,aplicativo_pai_id) VALUES(${id(26)}::uuid,${i.cliente}::uuid,${i.matriz}::uuid)`;
    },{timeout:10_000});
    await adquirido.promessa;
    const b=db.$transaction(tx=>substituirVendedoresExternosOlist(tx,i.usuario,i.cliente,i.matriz,[{aplicativoId:i.filial,vendedorOlistId:200}],expected,i.operador),{timeout:10_000});
    const rejeitado=assert.rejects(b,/vínculos foram alterados/i);
    try {await aguardarLock();}finally {seguir.liberar();}
    await a;await rejeitado;
    assert.ok((await sql.query("SELECT revogado_em FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[i.usuario,i.filial])).rows[0].revogado_em);
  });
  await t.test("reparentar × confirmar não transporta confirmação para outro grupo",async()=>{
    const expected=await versao(),inserido=barreira(),seguir=barreira();
    const a=db.$transaction(async tx=>{
      await substituirVendedoresExternosOlist(tx,i.usuario,i.cliente,i.matriz,[{aplicativoId:i.filial,vendedorOlistId:200}],expected,i.operador);
      inserido.liberar();await seguir.promessa;
    },{timeout:10_000});
    await inserido.promessa;
    const b=db.aplicativo.update({where:{id:i.filial},data:{aplicativoPaiId:i.outraMatriz},select:{id:true}});
    const rejeitado=assert.rejects(b,/vínculos incompatíveis/);
    try {await aguardarLock();}finally {seguir.liberar();}
    await a;await rejeitado;
    assert.equal((await sql.query("SELECT aplicativo_pai_id FROM aplicativo WHERE id=$1",[i.filial])).rows[0].aplicativo_pai_id,i.matriz);
  });
});
