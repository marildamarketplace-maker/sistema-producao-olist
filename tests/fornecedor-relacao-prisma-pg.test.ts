import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { z } from "zod";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
import { prepararBancoVendedores, idsVendedores as i } from "./helpers/vendedores-fornecedores-banco";

const retornoPostgres=z.object({
  fields:z.array(z.object({name:z.string(),dataTypeID:z.number()})),
  rows:z.array(z.record(z.string(),z.unknown())),
});

test("lock de fornecedor usa tipo suportado pelo PrismaPg sem alterar os parâmetros do par",async t=>{
  const db=criarPostgresMemoria();
  const pool=new Pool();
  const prisma=new PrismaClient({adapter:new PrismaPg(pool)});
  const chamadas:Array<{texto:string;valores:unknown[];tipos:number[]}>=[];
  try {
    await prepararBancoVendedores(db);
    // Somente o transporte pg é substituído. SQL e metadados vêm do PostgreSQL
    // descartável, e a desserialização usa PrismaClient/PrismaPg instalados.
    t.mock.method(pool,"query",async(...args:unknown[])=>{
      const consulta=z.object({text:z.string(),values:z.array(z.unknown()),rowMode:z.literal("array")}).parse(args[0]);
      const resultado=retornoPostgres.parse(await db.query(consulta.text,consulta.values));
      chamadas.push({texto:consulta.text,valores:consulta.values,tipos:resultado.fields.map(c=>c.dataTypeID)});
      return {command:"SELECT",rowCount:resultado.rows.length,oid:0,fields:resultado.fields,
        rows:resultado.rows.map(linha=>resultado.fields.map(campo=>linha[campo.name]))};
    });
    await assert.rejects(prisma.$queryRaw`SELECT public.fornecedor_relacao_bloquear(${i.cliente}::uuid,${i.matriz}::uuid)`,
      (error:unknown)=>{
        assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(error.code,"P2010");
        assert.match(error.message,/Failed to deserialize column of type 'void'/);
        return true;
      });
    assert.deepEqual(chamadas[0].tipos,[2278],"a função publicada retorna oid2278 (void)");

    Object.assign(globalThis,{prisma});
    const {bloquearRelacaoFornecedor,bloquearRelacoesFornecedor}=await import("../src/lib/fornecedor-relacao");
    await bloquearRelacaoFornecedor(prisma,i.cliente,i.matriz);
    assert.deepEqual(chamadas[1].tipos,[25],"o helper retorna oid25 (text), aceito pelo adapter real");
    assert.deepEqual(chamadas[1].valores,[i.cliente,i.matriz]);
    assert.match(chamadas[1].texto,/fornecedor_relacao_bloquear\(\$1::uuid,\$2::uuid\)/);

    await bloquearRelacoesFornecedor(prisma,[
      {clienteId:i.outroCliente,matrizId:i.matriz},
      {clienteId:i.cliente,matrizId:i.matriz},
      {clienteId:i.cliente,matrizId:i.matriz},
    ]);
    assert.deepEqual(chamadas.slice(2).map(c=>c.valores),[[i.cliente,i.matriz],[i.outroCliente,i.matriz]],
      "ordem dos locks e deduplicação permanecem preservadas");
    assert.ok(chamadas.slice(1).every(c=>c.tipos.length===1&&c.tipos[0]===25));
  }finally {
    await prisma.$disconnect();
    await pool.end();
    await db.close();
  }
});
