import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { Prisma } from "@prisma/client";
const id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;

test("API manual autoriza conta/carteira, grava PENDENTE e retorna comprovante idempotente sem criar na Olist", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const usuario = { id:id(1), aplicativoId:id(2), ativo:true, podeCriarOlistPedido:true, podeSelecionarFilialFornecedor:true,
    podeGerenciarFilaPedidos:false, vinculosOlistVersao:1 };
  let vinculado = true, noGrupo = true, carteira = 20, falharDetalhe = false, consultas = 0;
  let mudouVinculo = false;
  let clienteEstado = "A", vendedorEstado = "A";
  const registros: Array<{ id:string; status:string; createdAt:Date; hashEntrada:string; aplicativoFilial:{id:string;nome:string}; autorId:string; aplicativoSolicitanteId:string; chaveIdempotencia:string; tipoOrigem:string; dadosPedido:unknown }> = [];
  const contas = [id(2),id(3)];
  const chamadas: URL[] = [];
  const tx = {
    usuario: { findFirst:async () => usuario, findUnique:async () => ({...usuario}) },
    aplicativo: {
      findFirst:async ({where}:{where:{id:string}}) => contas.includes(where.id)?{id:where.id,nome:"Conta"}:null,
      findMany:async () => contas.map(id => ({id,nome:"Conta"})),
      findUnique:async () => ({olistClientId:"fake",olistClientSecret:"fake"}),
    },
    usuarioVendedorOlist: { findFirst:async ({where}:{where:{aplicativoId?:unknown}}) =>
      (where.aplicativoId ? vinculado : noGrupo)?{vendedorOlistId:20}:null },
    integracaoOlistToken:{findUnique:async () => ({accessToken:"fake",expiresAt:new Date(Date.now()+3600_000)})},
    formaPagamentoOlistPlano:{findFirst:async () => null},
    pedidoFornecedorQueue:{
      findFirst:async ({where}:{where:{id?:string;autorId:string;aplicativoSolicitanteId:string;chaveIdempotencia?:string}}) =>
        registros.find(r => r.autorId === where.autorId && r.aplicativoSolicitanteId === where.aplicativoSolicitanteId &&
          (where.id ? r.id === where.id : r.chaveIdempotencia === where.chaveIdempotencia)) ?? null,
      create:async ({data}:{data:Omit<(typeof registros)[number],"id"|"createdAt"|"aplicativoFilial"> & {aplicativoFilialId:string}}) => {
        if (registros.some(r => r.chaveIdempotencia === data.chaveIdempotencia)) throw new Prisma.PrismaClientKnownRequestError("unique",{code:"P2002",clientVersion:"7"});
        const r = {...data,id:id(10+registros.length),createdAt:new Date(),aplicativoFilial:{id:data.aplicativoFilialId,nome:"Conta"}};
        registros.push(r); return r;
      },
    },
    $queryRaw:async (strings:TemplateStringsArray,...values:unknown[]) => {
      const sql = strings.join("?"); assert.match(sql,/FOR SHARE/);
      if (sql.includes("FROM aplicativo")) return contas.includes(String(values[0]))?[{id:values[0]}]:[];
      return [{id:usuario.id}];
    },
  };
  Object.assign(globalThis,{prisma:{...tx,$transaction:async (fn:(client:typeof tx)=>unknown)=>fn({...tx,usuario:{...tx.usuario,findUnique:async () => ({...usuario,vinculosOlistVersao:mudouVinculo?2:1})}})}});
  const {supabaseAdmin} = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth,"getUser",async () => ({data:{user:{id:usuario.id,email:"test@example.test"}},error:null}));
  t.mock.method(axios,"get",async (url:string) => {
    consultas++; const u = new URL(url); chamadas.push(u);
    if (falharDetalhe) throw new Error("segredo-interno");
    const data = u.pathname.endsWith("/vendedores")?{itens:[{id:20,contato:{nome:"Vendedor",codigo:"VEN20"},situacao:vendedorEstado}],paginacao:{total:1}}
      : u.pathname.endsWith("/contatos/30")?{id:30,nome:"Cliente",situacao:clienteEstado,vendedor:{id:carteira}}
      : {itens:[{id:30,nome:"Cliente",situacao:"A"}],paginacao:{total:1}};
    return {status:200,data,headers:{"content-type":"application/json"}};
  });
  t.mock.method(axios,"post",async () => {throw new Error("Enfileirar não pode criar na Olist");});
  const {GET,POST} = await import("../src/app/api/olist/pedidos/manuais/route");
  const req = (query="",body?:unknown) => new Request(`https://example.test/api?${query}`,{method:body?"POST":"GET",headers:{Authorization:"Bearer fake"},...(body?{body:JSON.stringify(body)}:{})});
  const entrada = {chaveIdempotencia:id(4),aplicativoId:id(2),observacao:null,selecoes:{vendedorId:20,clienteId:30},itens:[{
    id:id(5),tecidoNome:"Oxford",quantidade:10,quantidadeTecido:2.5,estampa:"A",variante:null,tamanho:"30x30",tipoProduto:"Lenço",corteLaser:true}]};
  await t.test("exige sessão, usuário ativo e permissão",async () => {
    assert.equal((await GET(new Request("https://example.test"))).status,401);
    usuario.ativo=false; assert.equal((await GET(req())).status,401); usuario.ativo=true;
    usuario.podeCriarOlistPedido=false; assert.equal((await POST(req("",entrada))).status,403); usuario.podeCriarOlistPedido=true;
    const inicial=await GET(req()); assert.equal(inicial.status,200);
    assert.deepEqual(Object.keys(await inicial.json()).sort(),["aplicativoPadraoId","aplicativos"]);
    assert.equal(registros.length,0);
  });
  await t.test("conta padrão, filho autorizado e vendedor fixo; netos e grupos externos são bloqueados",async () => {
    assert.equal((await (await GET(req())).json()).aplicativoPadraoId,id(2));
    for(const conta of contas) {
      const r=await GET(req(`aplicativoId=${conta}`)); assert.equal(r.status,200); assert.equal((await r.json()).vendedorFixo,true);
    }
    const vendedores=await (await GET(req(`aplicativoId=${id(2)}&recurso=vendedores`))).json();
    assert.equal(vendedores.itens[0].nome,"Vendedor"); assert.equal(vendedores.itens[0].referencia,"VEN20");
    assert.equal((await GET(req(`aplicativoId=${id(99)}`))).status,403);
    usuario.podeSelecionarFilialFornecedor=false;
    assert.equal((await GET(req(`aplicativoId=${id(3)}`))).status,403); usuario.podeSelecionarFilialFornecedor=true;
    vinculado=false; assert.equal((await GET(req(`aplicativoId=${id(3)}`))).status,403);
    noGrupo=false; assert.equal((await (await GET(req(`aplicativoId=${id(3)}`))).json()).vendedorFixo,false);
    vinculado=true; noGrupo=true;
  });
  await t.test("filtro de carteira é do servidor e confirmação valida detalhe do cliente",async () => {
    assert.equal((await GET(req(`aplicativoId=${id(2)}&recurso=clientes&idVendedor=999&busca=Ana&pagina=2`))).status,200);
    const busca=chamadas.at(-1)!; assert.equal(busca.searchParams.get("idVendedor"),"20");
    assert.equal(busca.searchParams.get("offset"),"50"); assert.equal(busca.searchParams.get("limit"),"50");
    assert.equal((await GET(req(`aplicativoId=${id(2)}&recurso=clientes&pagina=1001`))).status,400);
    assert.equal((await POST(req("",{...entrada,selecoes:{...entrada.selecoes,vendedorId:99}}))).status,403);
    carteira=99; assert.equal((await POST(req("",entrada))).status,403); carteira=20;
    falharDetalhe=true; const r=await POST(req("",entrada)); assert.equal(r.status,502); assert.doesNotMatch(await r.text(),/segredo/); falharDetalhe=false;
    mudouVinculo=true; assert.equal((await POST(req("",entrada))).status,409); mudouVinculo=false;
    assert.equal(registros.length,0);
  });
  await t.test("confirmação concorrente, repetição e comprovante mantêm um único pedido",async () => {
    const respostas=await Promise.all([POST(req("",entrada)),POST(req("",entrada))]);
    for(const r of respostas) assert.equal(r.status,201);
    assert.equal(registros.length,1); assert.equal(registros[0].status,"PENDENTE"); assert.equal(registros[0].tipoOrigem,"MANUAL");
    const antes=consultas; const repetida=await POST(req("",entrada)); assert.equal(repetida.status,200); assert.equal(consultas,antes);
    assert.equal((await POST(req("",{...entrada,observacao:"mudou"}))).status,409);
    const recibo=await GET(req(`pedidoId=${registros[0].id}`)); assert.equal(recibo.status,200);
    assert.deepEqual(Object.keys(await recibo.json()).sort(),["aplicativo","createdAt","id","status"]);
    usuario.id=id(90); assert.equal((await GET(req(`pedidoId=${registros[0].id}`))).status,404); usuario.id=id(1);
    usuario.aplicativoId=id(91); assert.equal((await GET(req(`pedidoId=${registros[0].id}`))).status,404); usuario.aplicativoId=id(2);
  });
  await t.test("aceite de 100 itens valida apenas cliente e vendedor, sem ler dados comerciais opcionais",async () => {
    clienteEstado="B"; vendedorEstado="B";
    const itens=Array.from({length:100},(_,i)=>({...entrada.itens[0],id:id(1000+i)}));
    const selecoes={...entrada.selecoes,formaId:40,planoId:id(90),laser:{id:50,preco:10},
      tecidos:itens.map((item,i)=>({tecidoId:item.id,id:2000+i,preco:10}))};
    const antes=chamadas.length;
    const r=await POST(req("",{...entrada,chaveIdempotencia:id(81),itens,selecoes}));
    assert.equal(r.status,201);
    const novas=chamadas.slice(antes); assert.equal(novas.length,2);
    assert.deepEqual(novas.map(u=>u.pathname.split("/").slice(-2).join("/")),["contatos/30","v3/vendedores"]);
    const snapshot=registros.at(-1)!.dadosPedido as {itens:unknown[];olist:{selecoes:unknown}};
    assert.equal(snapshot.itens.length,100); assert.deepEqual(snapshot.olist.selecoes,selecoes);
    assert.equal(registros.at(-1)!.status,"PENDENTE");
    clienteEstado="A"; vendedorEstado="A";
  });
  await t.test("usuário sem vínculos seleciona vendedor e cliente fora de uma carteira fixa",async () => {
    vinculado=false; noGrupo=false; carteira=99;
    const r=await POST(req("",{...entrada,chaveIdempotencia:id(80)}));
    assert.equal(r.status,201); assert.equal(registros.length,3);
  });
});
