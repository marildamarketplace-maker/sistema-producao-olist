import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const matriz=id(1),cliente=id(2),admin=id(3),alvo=id(4),filial=id(5);

test("detalhe externo mantém versão e vínculos no mesmo snapshot e rejeita salvar a leitura anterior",async t=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="fake";
  type Estado={versao:number;vendedorId:number;relacaoAtiva:boolean};
  const estado:Estado={versao:1,vendedorId:200,relacaoAtiva:true};
  let permitido=true,corridaPendente=true,leiturasAlvoGlobais=0,leiturasAlvoSnapshot=0,leiturasComerciais=0;
  let leituraConcluida:()=>void=()=>{};
  const vinculosLidos=new Promise<void>(resolve=>{leituraConcluida=resolve;});
  let salvarConcorrente:()=>Promise<void>=async()=>{};
  const opcoes={AND:[
    {OR:[{id:matriz},{aplicativoPaiId:matriz}]},
    {id:{not:cliente}},
    {OR:[{aplicativoPaiId:null},{aplicativoPaiId:{not:cliente}}]},
  ]};
  const identidade={id:alvo,nome:"Cliente",aplicativoId:cliente,aplicativo:{id:cliente,nome:"C"}};
  const perfil=()=>({id:admin,ativo:true,aplicativoId:matriz,podeEditarConfiguracao:permitido,
    aplicativo:{aplicativoPaiId:null}});

  // A visão só é congelada se a API realmente pedir RepeatableRead. O gate faz
  // a versão ser lida depois do commit202, embora os vínculos já tenham lido200.
  const banco=(snapshot:Estado|undefined,simularCorrida:boolean)=>{
    const ler=()=>snapshot??estado;
    return {
      usuario:{
        findFirst:async({where}:{where:{id:string;aplicativoId?:unknown;aplicativo?:unknown}})=>{
          if(where.id===admin) return perfil();
          assert.deepEqual(where.aplicativoId,{not:matriz});
          assert.deepEqual(where.aplicativo,{fornecedores:{some:{aplicativoPaiId:matriz,ativo:true}}});
          if(snapshot) leiturasAlvoSnapshot++;else if(simularCorrida) leiturasAlvoGlobais++;
          return where.id===alvo&&ler().relacaoAtiva?identidade:null;
        },
        findUnique:async()=>perfil(),
        findUniqueOrThrow:async()=>{
          if(simularCorrida) await vinculosLidos;
          return {vinculosOlistVersao:ler().versao};
        },
      },
      usuarioVendedorOlist:{
        findMany:async({where,select,take}:{where:unknown;select:unknown;take:number})=>{
          leiturasComerciais++;
          assert.deepEqual(where,{usuarioId:alvo,origemAplicativoId:cliente,fornecedorMatrizId:matriz,aplicativo:opcoes});
          assert.deepEqual(select,{aplicativoId:true,vendedorOlistId:true,confirmadoEm:true,revogadoEm:true});
          assert.equal(take,1001);
          const anteriores=[{aplicativoId:filial,vendedorOlistId:ler().vendedorId,confirmadoEm:new Date(),revogadoEm:null}];
          if(simularCorrida&&corridaPendente){
            corridaPendente=false;
            await salvarConcorrente();
            leituraConcluida();
          }
          return anteriores;
        },
        updateMany:async()=>({count:0}),
      },
      aplicativo:{findMany:async({where,select,take}:{where:unknown;select:unknown;take:number})=>{
        assert.deepEqual(where,opcoes);assert.deepEqual(select,{id:true,nome:true});assert.equal(take,1001);
        return [{id:matriz,nome:"M"},{id:filial,nome:"F"}];
      }},
      fornecedor:{findFirst:async()=>ler().relacaoAtiva?{id:id(6)}:null},
      $queryRaw:async(consulta:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>{
        const sql="text" in consulta?consulta:Prisma.sql(consulta,...valores);
        if(sql.text.includes("vinculos_olist_versao"))return [{vinculosOlistVersao:ler().versao}];
        if(sql.text.includes("FROM aplicativo"))return [{id:filial}];
        return [{id:admin},{id:alvo}];
      },
      $executeRaw:async(consulta:TemplateStringsArray,...valores:unknown[])=>{
        const sql=Prisma.sql(consulta,...valores);
        assert.match(sql.text,/INSERT INTO usuario_vendedor_olist/);
        assert.equal(snapshot,undefined,"mutações não usam o snapshot de leitura do GET");
        const [usuarioId,clienteId,matrizId,operadorId,json]=valores;
        assert.deepEqual([usuarioId,clienteId,matrizId,operadorId],[alvo,cliente,matriz,admin]);
        const entradas=JSON.parse(String(json)) as Array<{aplicativoId:string;vendedorOlistId:number}>;
        assert.equal(entradas.length,1);assert.equal(entradas[0].aplicativoId,filial);
        estado.vendedorId=entradas[0].vendedorOlistId;estado.versao++;
        return 1;
      },
    };
  };
  const transacoes:Array<{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number}>=[];
  const fake={...banco(undefined,true),
    $transaction:async<T>(operar:(tx:ReturnType<typeof banco>)=>Promise<T>,opcoesTx:{
      isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number;
    })=>{
      transacoes.push(opcoesTx);
      assert.equal(opcoesTx.maxWait,5000);assert.equal(opcoesTx.timeout,10000);
      if(opcoesTx.isolationLevel!==undefined){
        assert.equal(opcoesTx.isolationLevel,Prisma.TransactionIsolationLevel.RepeatableRead);
        return operar(banco({...estado},true));
      }
      return operar(banco(undefined,false));
    },
  };
  Object.assign(globalThis,{prisma:fake});
  const {supabaseAdmin}=await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth,"getUser",async()=>({data:{user:{id:admin,email:"admin@example.test"}},error:null}));
  const {GET,PATCH}=await import("../src/app/api/usuarios/clientes/route");
  const request=(usuarioId=alvo)=>new Request(`https://example.test/api/usuarios/clientes?usuarioId=${usuarioId}`,{
    headers:{Authorization:"Bearer fake"},
  });
  const patch=(versao:number,vendedorId:number)=>PATCH(new Request("https://example.test/api/usuarios/clientes",{
    method:"PATCH",headers:{Authorization:"Bearer fake","Content-Type":"application/json"},
    body:JSON.stringify({usuarioId:alvo,vinculosOlistVersao:versao,vendedoresOlist:[{aplicativoId:filial,vendedorOlistId:vendedorId}]}),
  }));
  salvarConcorrente=async()=>{
    assert.equal((await patch(1,202)).status,200);
    assert.deepEqual(estado,{versao:2,vendedorId:202,relacaoAtiva:true});
  };

  const resposta=await GET(request());
  assert.equal(resposta.status,200);
  assert.equal(resposta.headers.get("cache-control"),"private, no-store");
  const dados=await resposta.json();
  assert.equal(dados.usuario.vendedoresOlist[0].vendedorOlistId,200);
  assert.equal(dados.usuario.vinculosOlistVersao,1,"vendedor200 nunca deve carregar a versão2 do commit concorrente");
  assert.equal(leiturasAlvoGlobais,1,"somente o lookup preliminar do PATCH concorrente usa o cliente global; o alvo do GET pertence à transação");
  assert.equal(leiturasAlvoSnapshot,1);
  assert.equal(transacoes[0].isolationLevel,Prisma.TransactionIsolationLevel.RepeatableRead);
  assert.equal((await patch(dados.usuario.vinculosOlistVersao,200)).status,409);
  assert.deepEqual(estado,{versao:2,vendedorId:202,relacaoAtiva:true},"PATCH antigo preserva o vendedor202 confirmado pelo outro administrador");

  const antes=leiturasComerciais;
  estado.relacaoAtiva=false;
  assert.equal((await GET(request())).status,404);
  estado.relacaoAtiva=true;
  assert.equal((await GET(request(id(99)))).status,404);
  permitido=false;
  assert.equal((await GET(request())).status,403);
  assert.equal(leiturasComerciais,antes,"sem relação, usuário alheio ou permissão não lê detalhes comerciais");
  assert.equal(dados.usuario.email,undefined);assert.equal(dados.usuario.permissions,undefined);
});
