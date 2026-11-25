import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import axios from "axios";
import type { VendedorOrigemFila } from "../src/lib/vendedor-fila-contrato";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const cliente = id(1), matriz = id(2), conta = id(3), autor = id(4), operador = id(5);
const filaId = id(6), solicitacaoId = id(7), fornecedorId = id(8);

test("produção: proveniência do vendedor, revisão e revogação protegem a reserva", async t => {
  let relacaoAtiva = true, vinculoAtivo = true, autorAtivo = true, operadorPermitido = true;
  let revisao = 3, vendedorId = 101, posts = 0, reservas = 0, consultasAutor = 0;
  let envio: Record<string, unknown> | null = null;
  const ordem: string[] = [];
  const fake = {
    aplicativo: { findUnique: async ({ where }: {where:{id:string}}) => ({ id: where.id, aplicativoPaiId: where.id === conta ? matriz : null,
      nome: "Conta de teste", olistClientId: "fake", olistClientSecret: "fake" }) },
    fornecedor: { findFirst: async ({ where }: {where:{aplicativoId:string;aplicativoPaiId:string;ativo:boolean}}) => {
      assert.equal(where.aplicativoId,cliente); assert.equal(where.aplicativoPaiId,matriz); assert.equal(where.ativo,true);
      return relacaoAtiva ? {id:fornecedorId} : null;
    } },
    usuario: { findFirst: async ({ where }: {where:{id:string;aplicativoId:string;ativo:true;podeGerenciarFilaPedidos?:true}}) => {
      if (where.podeGerenciarFilaPedidos) {
        assert.equal(where.id,operador); assert.equal(where.aplicativoId,matriz);
        return operadorPermitido ? {id:operador} : null;
      }
      consultasAutor++; assert.equal(where.id,autor); assert.equal(where.aplicativoId,cliente);
      return autorAtivo ? {id:autor} : null;
    } },
    usuarioVendedorOlist: { findFirst: async ({where}:{where:{usuarioId:string;aplicativoId:string;revogadoEm:null}}) => {
      assert.equal(where.usuarioId,autor); assert.equal(where.aplicativoId,conta); assert.equal(where.revogadoEm,null);
      return vinculoAtivo ? {vendedorOlistId:vendedorId,revisao,origemAplicativoId:cliente,fornecedorMatrizId:matriz} : null;
    } },
    $queryRaw: async (consulta: TemplateStringsArray | Prisma.Sql, ...valores: unknown[]) => {
      const sql = "text" in consulta ? consulta : Prisma.sql(consulta,...valores);
      if (sql.text.includes("fornecedor_relacao_bloquear")) ordem.push("relacao");
      else if (sql.text.includes("FROM usuario")) ordem.push(`usuario:${sql.values[0]}`);
      else if (sql.text.includes("FROM solicitacoes_producao")) ordem.push("solicitacao");
      else if (sql.text.includes("FROM aplicativo")) ordem.push("destino");
      return [{id:conta}];
    },
    pedidoFornecedorSolicitacao: { findFirst: async () => null,
      create: async ({data}:{data:Record<string,unknown>}) => ({...data,id:id(9)}) },
    envioFornecedor: {
      findUnique: async () => envio,
      upsert: async ({create}:{create:Record<string,unknown>}) => { reservas++; envio={...create}; },
      update: async ({data}:{data:Record<string,unknown>}) => { envio={...envio,...data}; },
      updateMany: async ({data}:{data:Record<string,unknown>}) => { envio={...envio,...data}; return {count:1}; },
    },
    pedidoFornecedorQueue: { updateMany: async () => ({count:1}) },
    integracaoOlistToken: {findUnique: async () => ({accessToken:"fake",expiresAt:new Date(Date.now()+3600_000)})},
  };
  Object.assign(fake, {$transaction: async <T,>(operar:(tx:typeof fake)=>Promise<T>)=>operar(fake)});
  Object.assign(globalThis,{prisma:fake});
  t.mock.method(axios,"post",async ()=>{posts++;return {status:200,data:{id:789}};});
  const { capturarVendedorFila, bloquearVendedorFila } = await import("../src/lib/vendedor-fila-producao");
  const { enviarFornecedor } = await import("../src/lib/envio-fornecedor");
  const entrada = {usuarioId:autor,aplicativoSolicitanteId:cliente,matrizId:matriz,aplicativoId:conta,vendedorOlistId:101,
    fonte:"VINCULO" as const,revisaoEsperada:3};
  const origem = await capturarVendedorFila(entrada);
  assert.deepEqual(origem,{tipo:"VINCULO",usuarioId:autor,aplicativoSolicitanteId:cliente,matrizId:matriz,aplicativoId:conta,vendedorOlistId:101,revisao:3});
  const enviar = (origemVendedor:VendedorOrigemFila=origem) => enviarFornecedor({solicitacaoId,fornecedorId,aplicativoId:conta,
    usuarioId:operador,origemVendedor,payload:{vendedor:{id:origemVendedor.vendedorOlistId},itens:[]},fila:{id:filaId,versao:1,matrizId:matriz}});

  await t.test("fila sem proveniência é rejeitada mesmo se um caller ignorar o contrato TypeScript",async()=>{
    type Contexto=Parameters<typeof enviarFornecedor>[0];
    const adulterado={solicitacaoId,fornecedorId,aplicativoId:conta,usuarioId:operador,payload:{},fila:{id:filaId,versao:1,matrizId:matriz}} as unknown as Contexto;
    await assert.rejects(enviarFornecedor(adulterado),/origem do vendedor/);
    assert.equal(posts,0);assert.equal(reservas,0);
  });
  await t.test("mudança da revisão invalida a seleção mesmo mantendo o mesmo número", async () => {
    revisao=4;
    await assert.rejects(capturarVendedorFila(entrada),/Vínculo do vendedor alterado/);
    await assert.rejects(enviar(),/Vínculo do vendedor alterado/);
    assert.equal(posts,0);assert.equal(reservas,0);
    revisao=3;
  });
  await t.test("revogação e autor inativo bloqueiam antes de reservar ou chamar Olist", async () => {
    vinculoAtivo=false;await assert.rejects(enviar(),/Vínculo do vendedor alterado/);
    vinculoAtivo=true;autorAtivo=false;await assert.rejects(enviar(),/Vínculo do vendedor alterado/);
    autorAtivo=true;assert.equal(posts,0);assert.equal(reservas,0);
  });
  await t.test("mudança do ID e encerramento da relação não reaproveitam proveniência antiga", async () => {
    vendedorId=202;await assert.rejects(enviar(),/Vínculo do vendedor alterado/);vendedorId=101;
    relacaoAtiva=false;await assert.rejects(enviar(),/relação de fornecimento/);relacaoAtiva=true;
    assert.equal(posts,0);assert.equal(reservas,0);
  });
  await t.test("escolha manual é explícita e depende da relação ativa, sem inferir vínculo por ID", async () => {
    vinculoAtivo=false;
    const antes=consultasAutor;
    const manual=await capturarVendedorFila({...entrada,fonte:"MANUAL"});
    assert.equal(manual.tipo,"MANUAL");assert.equal(consultasAutor,antes);
    assert.equal("revisao" in manual,false);
    await bloquearVendedorFila(fake as unknown as Prisma.TransactionClient,manual);
    relacaoAtiva=false;await assert.rejects(bloquearVendedorFila(fake as unknown as Prisma.TransactionClient,manual),/relação de fornecimento/);
    relacaoAtiva=true;vinculoAtivo=true;
  });
  await t.test("revogar permissão do operador também impede a reserva",async()=>{
    operadorPermitido=false;await assert.rejects(enviar(),/Permissão para gerenciar/);operadorPermitido=true;
    assert.equal(posts,0);assert.equal(reservas,0);
  });
  await t.test("reserva válida revalida par e atores antes de reservar e faz um único POST",async()=>{
    ordem.length=0;
    await enviar();
    assert.equal(reservas,1);assert.equal(posts,1);
    assert.equal(ordem[0],"relacao");
    assert.ok(ordem.indexOf(`usuario:${autor}`)<ordem.indexOf("solicitacao"));
    assert.ok(ordem.indexOf(`usuario:${operador}`)<ordem.indexOf("solicitacao"));
    assert.equal(envio?.estado,"CONCLUIDO");
    await assert.rejects(enviar(),/Solicitação já enviada/);
    assert.equal(posts,1);
  });
});
