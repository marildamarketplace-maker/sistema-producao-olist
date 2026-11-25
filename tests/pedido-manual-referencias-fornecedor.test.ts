import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const cliente=id(1),matrizA=id(2),matrizB=id(3),filialA=id(4),filialB=id(5),neto=id(6);
type Conta={id:string;nome:string;aplicativoPaiId:string|null};
type Fornecedor={id:string;aplicativoPai:{id:string;nome:string}};
type Estado={internos:Conta[];fornecedores:Fornecedor[];contas:Conta[]};
const conta=(id:string,nome:string,aplicativoPaiId:string|null=null):Conta=>({id,nome,aplicativoPaiId});
const fornecedor=(id:string,matrizId:string,nome:string):Fornecedor=>({id,aplicativoPai:{id:matrizId,nome}});

test("referências manuais expandem fornecedores em uma consulta global limitada e preservam a origem nativa",async t=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="fake";
  let estado:Estado={internos:[],fornecedores:[],contas:[]};
  let mudarDuranteLeitura:(()=>void)|undefined;
  let consultas=0,consultasFiliais=0;
  const ordenar=(a:{nome:string;id:string},b:{nome:string;id:string})=>a.nome.localeCompare(b.nome)||a.id.localeCompare(b.id);
  const fake={
    $transaction:async<T>(operar:(tx:{aplicativo:{findMany:(consulta:unknown)=>Promise<unknown[]>};fornecedor:{findMany:(consulta:unknown)=>Promise<unknown[]>}})=>Promise<T>,opcoes:{isolationLevel:Prisma.TransactionIsolationLevel;maxWait:number;timeout:number})=>{
      assert.deepEqual(opcoes,{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:5000,timeout:10000});
      const snapshot=structuredClone(estado);
      return operar({
        aplicativo:{findMany:async(consulta:unknown)=>{
          consultas++;
          const q=consulta as {where:{OR?:unknown;aplicativoPaiId?:{in:string[]}};select:unknown;orderBy:unknown;take:number};
          assert.equal(q.take,1001);
          if(q.where.OR){
            assert.deepEqual(q.where,{OR:[{id:cliente},{aplicativoPaiId:cliente}]});
            assert.deepEqual(q.select,{id:true,nome:true});
            assert.deepEqual(q.orderBy,[{nome:"asc"},{id:"asc"}]);
            return snapshot.internos.slice().sort(ordenar).slice(0,q.take).map(({id,nome})=>({id,nome}));
          }
          consultasFiliais++;
          const ids=q.where.aplicativoPaiId?.in??[];
          assert.ok(ids.length>0);assert.equal(ids.length,new Set(ids).size,"consulta usa matrizes únicas");
          assert.deepEqual(q.select,{id:true,nome:true,aplicativoPaiId:true});
          assert.deepEqual(q.orderBy,[{aplicativoPaiId:"asc"},{nome:"asc"},{id:"asc"}]);
          return snapshot.contas.filter(a=>a.aplicativoPaiId!==null&&ids.includes(a.aplicativoPaiId))
            .sort((a,b)=>a.aplicativoPaiId!.localeCompare(b.aplicativoPaiId!)||ordenar(a,b)).slice(0,q.take);
        }},
        fornecedor:{findMany:async(consulta:unknown)=>{
          consultas++;
          const q=consulta as {where:unknown;select:unknown;orderBy:unknown;take:number};
          assert.deepEqual(q.where,{aplicativoId:cliente,ativo:true,aplicativoPai:{aplicativoPaiId:null}});
          assert.deepEqual(q.select,{id:true,aplicativoPai:{select:{id:true,nome:true}}},"não carrega filiais aninhadas por cadastro duplicado");
          assert.deepEqual(q.orderBy,[{aplicativoPaiId:"asc"},{id:"asc"}]);assert.equal(q.take,1001);
          const linhas=snapshot.fornecedores.slice().sort((a,b)=>a.aplicativoPai.id.localeCompare(b.aplicativoPai.id)||a.id.localeCompare(b.id)).slice(0,q.take);
          mudarDuranteLeitura?.();mudarDuranteLeitura=undefined;
          return linhas;
        }},
      });
    },
  };
  Object.assign(globalThis,{prisma:fake});
  const {listarReferenciasPedidoManual}=await import("../src/lib/pedido-manual-acesso");
  const listar=()=>listarReferenciasPedidoManual(cliente);
  const reset=(novo:Estado)=>{estado=novo;consultas=0;consultasFiliais=0;};

  await t.test("dois fornecedores: filhos de um e matriz do outro, sem duplicados ou netos",async()=>{
    reset({internos:[conta(cliente,"Cliente")],fornecedores:[fornecedor(id(20),matrizA,"M A"),fornecedor(id(21),matrizA,"M A"),fornecedor(id(22),matrizB,"M B")],
      contas:[conta(filialB,"Filial B",matrizA),conta(filialA,"Filial A",matrizA),conta(neto,"Neto",filialA),conta(id(7),"Alheio",id(8))]});
    assert.deepEqual(await listar(),[{id:cliente,nome:"Cliente"},{id:filialA,nome:"Filial A",fornecedorId:id(20)},
      {id:filialB,nome:"Filial B",fornecedorId:id(20)},{id:matrizB,nome:"M B",fornecedorId:id(22)}]);
    assert.equal(consultas,3);assert.equal(consultasFiliais,1);
  });
  await t.test("filial cliente com filho próprio não reaparece como fornecedor após ser omitida pela regra nativa",async()=>{
    const filhoProprio=id(9);
    reset({internos:[conta(cliente,"Cliente",matrizA),conta(filhoProprio,"Filho próprio",cliente)],
      fornecedores:[fornecedor(id(20),matrizA,"M A")],contas:[conta(cliente,"Cliente",matrizA),conta(filialA,"Irmã",matrizA),conta(filhoProprio,"Filho próprio",cliente)]});
    assert.deepEqual(await listar(),[{id:filhoProprio,nome:"Filho próprio"},{id:filialA,nome:"Irmã",fornecedorId:id(20)}]);
  });
  await t.test("fornecedor próprio não marca filhos nativos nem reintroduz a matriz escondida",async()=>{
    reset({internos:[conta(cliente,"Cliente"),conta(filialA,"A",cliente),conta(filialB,"B",cliente)],
      fornecedores:[fornecedor(id(20),cliente,"Cliente")],contas:[conta(filialA,"A",cliente),conta(filialB,"B",cliente)]});
    assert.deepEqual(await listar(),[{id:filialA,nome:"A"},{id:filialB,nome:"B"}]);
  });
  await t.test("sem fornecedor mantém somente a primeira ordenação nativa e dispensa consulta de filiais",async()=>{
    reset({internos:[conta(cliente,"0 Pai"),conta(filialB,"B",cliente),conta(filialA,"A",cliente)],fornecedores:[],contas:[]});
    assert.deepEqual(await listar(),[{id:filialA,nome:"A"},{id:filialB,nome:"B"}]);
    assert.equal(consultas,2);assert.equal(consultasFiliais,0);
  });
  await t.test("snapshot impede combinar cadastros e filiais de momentos diferentes",async()=>{
    reset({internos:[conta(cliente,"Cliente")],fornecedores:[fornecedor(id(20),matrizA,"M A")],contas:[]});
    mudarDuranteLeitura=()=>{estado.contas.push(conta(filialA,"Nova filial",matrizA));};
    assert.deepEqual(await listar(),[{id:cliente,nome:"Cliente"},{id:matrizA,nome:"M A",fornecedorId:id(20)}]);
    assert.deepEqual(await listar(),[{id:cliente,nome:"Cliente"},{id:filialA,nome:"Nova filial",fornecedorId:id(20)}]);
  });
  await t.test("mil cadastros duplicados não multiplicam consultas ou a expansão de filiais",async()=>{
    reset({internos:[conta(cliente,"Cliente")],fornecedores:Array.from({length:1000},(_,n)=>fornecedor(id(100+n),matrizA,"M A")),
      contas:Array.from({length:999},(_,n)=>conta(id(2000+n),`Filial ${String(n).padStart(4,"0")}`,matrizA))});
    const opcoes=await listar();assert.equal(opcoes.length,1000);assert.equal(consultas,3);assert.equal(consultasFiliais,1);
    assert.ok(opcoes.slice(1).every(app=>app.fornecedorId===id(100)));
  });
  await t.test("filiais globais e total de opções excedidos falham em vez de truncar ou oferecer matriz como conta única",async()=>{
    reset({internos:[conta(cliente,"Cliente")],fornecedores:[fornecedor(id(20),matrizA,"M A")],
      contas:Array.from({length:1001},(_,n)=>conta(id(2000+n),`Filial ${n}`,matrizA))});
    await assert.rejects(listar(),(error:unknown)=>error instanceof Error&&"status" in error&&error.status===409);
    assert.equal(consultasFiliais,1);
    estado.contas.pop();
    await assert.rejects(listar(),/Limite de aplicativos/ ,"1000 filiais mais a referência nativa também excedem o total");
    estado.fornecedores=Array.from({length:1001},(_,n)=>fornecedor(id(100+n),matrizA,"M A"));
    consultasFiliais=0;
    await assert.rejects(listar(),/Limite de aplicativos/);assert.equal(consultasFiliais,0);
  });
});
