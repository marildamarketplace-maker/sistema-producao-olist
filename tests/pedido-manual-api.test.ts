import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { pedidoManualLegadoSchema, pedidoManualSchema, montarDadosPedidoManual } from "../src/lib/pedido-manual-contrato";
const id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;

test("API manual autoriza conta/carteira, grava PENDENTE e retorna comprovante idempotente sem criar na Olist", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const usuario = { id:id(1), aplicativoId:id(2), ativo:true, podeCriarOlistPedido:true, podeSelecionarFilialFornecedor:true,
    podeGerenciarFilaPedidos:false, vinculosOlistVersao:1 };
  let vinculado = true, noGrupo = true, carteira = 20, falharDetalhe = false, consultas = 0;
  let mudouVinculo = false;
  let versaoConfiguracao = 1, criacoesTentadas = 0;
  let aposLookupVazio: (() => void) | null = null;
  let ufCliente: string | null = null;
  const documentoCliente = "04252011000110";
  let cpfCnpjCliente: string | null = documentoCliente;
  let pausaConsulta: { iniciou: () => void; liberar: Promise<void> } | null = null;
  let clienteEstado = "A", vendedorEstado = "A";
  const registros: Array<{ id:string; status:string; createdAt:Date; hashEntrada:string; aplicativoFilial:{id:string;nome:string}; autorId:string; aplicativoSolicitanteId:string; chaveIdempotencia:string; tipoOrigem:string; dadosPedido:unknown }> = [];
  const contas = [id(2),id(3)];
  const chamadas: URL[] = [];
  const tx = {
    usuario: { findFirst:async () => usuario, findUnique:async () => ({...usuario}) },
    aplicativo: {
      findFirst:async ({where}:{where:{id:string}}) => contas.includes(where.id)?{id:where.id,nome:"Conta"}:null,
      findMany:async ({where}:{where:{OR?:unknown}}) => (where.OR?contas:[id(3)]).map(id => ({id,nome:"Conta"})),
      findUnique:async () => ({olistClientId:"fake",olistClientSecret:"fake"}),
    },
    usuarioVendedorOlist: { findFirst:async ({where}:{where:{aplicativoId?:unknown}}) =>
      (where.aplicativoId ? vinculado : noGrupo)?{vendedorOlistId:20}:null },
    integracaoOlistToken:{findUnique:async () => ({accessToken:"fake",expiresAt:new Date(Date.now()+3600_000)})},
    formaPagamentoOlistPlano:{findFirst:async () => null},
    direcionamentoPedidos:{findUnique:async()=>({versao:versaoConfiguracao,aplicativoPadraoId:id(3),regras:[]})},
    pedidoFornecedorQueue:{
      findFirst:async ({where}:{where:{id?:string;autorId:string;aplicativoSolicitanteId:string;chaveIdempotencia?:string}}) => {
        const existente = registros.find(r => r.autorId === where.autorId && r.aplicativoSolicitanteId === where.aplicativoSolicitanteId &&
          (where.id ? r.id === where.id : r.chaveIdempotencia === where.chaveIdempotencia)) ?? null;
        if (!existente && where.chaveIdempotencia && aposLookupVazio) {
          const concluir = aposLookupVazio; aposLookupVazio = null; concluir();
        }
        return existente;
      },
      create:async ({data}:{data:Omit<(typeof registros)[number],"id"|"createdAt"|"aplicativoFilial"> & {aplicativoFilialId:string}}) => {
        criacoesTentadas++;
        if (registros.some(r => r.chaveIdempotencia === data.chaveIdempotencia)) throw new Prisma.PrismaClientKnownRequestError("unique",{code:"P2002",clientVersion:"7"});
        const r = {...data,id:id(10+registros.length),createdAt:new Date(),aplicativoFilial:{id:data.aplicativoFilialId,nome:"Conta"}};
        registros.push(r); return r;
      },
    },
    $queryRaw:async (strings:TemplateStringsArray,...values:unknown[]) => {
      const sql = strings.join("?"); assert.match(sql,/FOR SHARE|FOR UPDATE/);
      if(sql.includes("direcionamento_pedidos")) return [{versao:versaoConfiguracao,aplicativoPadraoId:id(3)}];
      if (sql.includes("FROM aplicativo")) return contas.includes(String(values[0]))?[{id:values[0]}]:[];
      return [{id:usuario.id}];
    },
  };
  Object.assign(globalThis,{prisma:{...tx,$transaction:async (fn:(client:typeof tx)=>unknown)=>fn({...tx,usuario:{...tx.usuario,findUnique:async () => ({...usuario,vinculosOlistVersao:mudouVinculo?2:1})}})}});
  const {supabaseAdmin} = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth,"getUser",async () => ({data:{user:{id:usuario.id,email:"test@example.test"}},error:null}));
  t.mock.method(axios,"get",async (url:string) => {
    consultas++; const u = new URL(url); chamadas.push(u);
    if (pausaConsulta) { const pausa=pausaConsulta;pausaConsulta=null;pausa.iniciou();await pausa.liberar; }
    if (falharDetalhe) throw new Error("segredo-interno");
    const data = u.pathname.endsWith("/vendedores")?{itens:[{id:20,contato:{nome:"Vendedor",codigo:"VEN20",cpfCnpj:null},situacao:vendedorEstado}],paginacao:{total:1}}
      : u.pathname.endsWith("/contatos/30")?{id:30,nome:"Cliente",cpfCnpj:cpfCnpjCliente,situacao:clienteEstado,vendedor:{id:carteira},endereco:{uf:ufCliente}}
      : {itens:[{id:30,nome:"Cliente",situacao:"A"}],paginacao:{total:1}};
    return {status:200,data,headers:{"content-type":"application/json"}};
  });
  t.mock.method(axios,"post",async () => {throw new Error("Enfileirar não pode criar na Olist");});
  const {GET,POST} = await import("../src/app/api/olist/pedidos/manuais/route");
  const req = (query="",body?:unknown) => new Request(`https://example.test/api?${query}`,{method:body?"POST":"GET",headers:{Authorization:"Bearer fake"},...(body?{body:JSON.stringify(body)}:{})});
  const entrada = {versao:2,origemManual:{aplicativoId:id(3),vendedor:{id:20,nome:"Vendedor",cpfCnpj:null},cliente:{id:30,nome:"Cliente",cpfCnpj:documentoCliente,uf:null}},
    decisaoDirecionamento:{tipo:"PADRAO",regraId:null,regraNome:null,versao:1,aplicativoId:id(3),motivo:"Aplicativo padrão configurado pelo pai."},
    chaveIdempotencia:id(4),aplicativoId:id(3),observacao:null,selecoes:{vendedorId:20,clienteId:30},itens:[{
    id:id(5),tecidoNome:"Oxford",quantidade:10,quantidadeTecido:2.5,estampa:"A",variante:null,tamanho:"30x30",tipoProduto:"Lenço",corteLaser:true}]};
  function registrarAceiteConcorrente(valor: unknown) {
    const parsed = pedidoManualSchema.parse(valor);
    const registro = { id:id(100+registros.length),status:"PENDENTE",createdAt:new Date(),
      hashEntrada:createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
      aplicativoFilial:{id:parsed.aplicativoId,nome:"Conta"},autorId:usuario.id,aplicativoSolicitanteId:usuario.aplicativoId,
      chaveIdempotencia:parsed.chaveIdempotencia,tipoOrigem:"MANUAL",dadosPedido:montarDadosPedidoManual(parsed) };
    registros.push(registro); return registro;
  }
  await t.test("exige sessão, usuário ativo e permissão",async () => {
    assert.equal((await GET(new Request("https://example.test"))).status,401);
    usuario.ativo=false; assert.equal((await GET(req())).status,401); usuario.ativo=true;
    usuario.podeCriarOlistPedido=false; assert.equal((await POST(req("",entrada))).status,403); usuario.podeCriarOlistPedido=true;
    const inicial=await GET(req()); assert.equal(inicial.status,200);
    assert.deepEqual(Object.keys(await inicial.json()).sort(),["aplicativoPadraoId","aplicativos"]);
    assert.equal(registros.length,0);
  });
  await t.test("conta padrão, filho autorizado e vendedor fixo; netos e grupos externos são bloqueados",async () => {
    assert.equal((await (await GET(req())).json()).aplicativoPadraoId,id(3));
    assert.deepEqual((await (await GET(req())).json()).aplicativos,[{id:id(3),nome:"Conta"}]);
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
    assert.equal((await POST(req("",{...entrada,selecoes:{...entrada.selecoes,vendedorId:99}}))).status,409);
    carteira=99; assert.equal((await POST(req("",entrada))).status,403); carteira=20;
    falharDetalhe=true; const r=await POST(req("",entrada)); assert.equal(r.status,502); assert.doesNotMatch(await r.text(),/segredo/); falharDetalhe=false;
    mudouVinculo=true; assert.equal((await POST(req("",entrada))).status,409); mudouVinculo=false;
    assert.equal(registros.length,0);
  });
  await t.test("cliente sem documento bloqueia resolução e inclusão mesmo que o navegador envie documento",async () => {
    const antes=registros.length,criadas=criacoesTentadas;
    try {
      for (const documento of [null,"","   "]) {
        cpfCnpjCliente=documento;
        const resolucao=await GET(req(`acao=resolver&aplicativoOrigemId=${id(3)}&vendedorOrigemId=20&clienteOrigemId=30`));
        assert.equal(resolucao.status,409);assert.match((await resolucao.json()).error,/CPF\/CNPJ/);
        const inclusao=await POST(req("",{...entrada,chaveIdempotencia:id(140)}));
        assert.equal(inclusao.status,409);assert.match((await inclusao.json()).error,/CPF\/CNPJ/);
      }
      assert.equal(registros.length,antes);assert.equal(criacoesTentadas,criadas);
    } finally { cpfCnpjCliente=documentoCliente; }
    const resolucao=await GET(req(`acao=resolver&aplicativoOrigemId=${id(3)}&vendedorOrigemId=20&clienteOrigemId=30`));
    assert.equal(resolucao.status,200,"cadastrar o documento permite resolver novamente");
    const semDocumento={...entrada,chaveIdempotencia:id(141),origemManual:{...entrada.origemManual,cliente:{...entrada.origemManual.cliente,cpfCnpj:null}}};
    assert.equal((await POST(req("",semDocumento))).status,409,"o snapshot enviado também deve corresponder ao cadastro atual");
    assert.equal(registros.length,antes);
  });
  await t.test("confirmação concorrente, repetição e comprovante mantêm um único pedido",async () => {
    const respostas=await Promise.all([POST(req("",entrada)),POST(req("",entrada))]);
    assert.deepEqual(respostas.map(r=>r.status).sort(),[200,201]);
    assert.equal((await respostas[0].clone().json()).id,(await respostas[1].clone().json()).id);
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
    const novas=chamadas.slice(antes); assert.ok(novas.length<=6);
    assert.ok(novas.every(u=>/contatos|vendedores/.test(u.pathname)));
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
  await t.test("resolução não expõe payload bruto e inclusão não aceita destino, regra ou origem forjados",async()=>{
    carteira=20;vinculado=true;noGrupo=true;
    const preview=await GET(req(`acao=resolver&aplicativoOrigemId=${id(3)}&vendedorOrigemId=20&clienteOrigemId=30`));
    assert.equal(preview.status,200);const dados=await preview.json();
    assert.deepEqual(Object.keys(dados.selecoes).sort(),["clienteId","vendedorFixo","vendedorId"]);
    for(const patch of [
      {aplicativoId:id(2)},
      {origemManual:{...entrada.origemManual,cliente:{...entrada.origemManual.cliente,uf:"SP"}}},
      {decisaoDirecionamento:{...entrada.decisaoDirecionamento,versao:99}},
    ]) assert.equal((await POST(req("",{...entrada,...patch,chaveIdempotencia:id(83)}))).status,409);
    assert.equal((await POST(req("",{...entrada,chaveIdempotencia:id(84),origemManual:{...entrada.origemManual,aplicativoId:id(2)}}))).status,403);
  });
  await t.test("retry mantém redirecionamento/cancelamento e contrato antigo só recupera aceite",async()=>{
    const registro=registros[0];registro.status="CANCELADO";registro.aplicativoFilial={id:id(88),nome:"Destino atual"};
    versaoConfiguracao=2;
    const antes=consultas;const retorno=await POST(req("",entrada));assert.equal(retorno.status,200);
    const atual=await retorno.json();assert.equal(atual.status,"CANCELADO");assert.equal(atual.aplicativo.id,id(88));assert.equal(consultas,antes);
    const legado=pedidoManualLegadoSchema.parse({chaveIdempotencia:id(85),aplicativoId:entrada.aplicativoId,
      observacao:entrada.observacao,selecoes:entrada.selecoes,itens:entrada.itens});
    assert.equal((await POST(req("",legado))).status,409);
    registros.push({...registro,id:id(89),chaveIdempotencia:id(85),hashEntrada:createHash("sha256").update(JSON.stringify(legado)).digest("hex")});
    assert.equal((await POST(req("",legado))).status,200);assert.equal(consultas,antes);
    versaoConfiguracao=1;
  });
  await t.test("aceite concorrente após lookup vazio prevalece sobre regras alteradas e não cria outro pedido",async()=>{
    const body={...entrada,chaveIdempotencia:id(130)},antes=registros.length,criadas=criacoesTentadas;
    aposLookupVazio=()=>{registrarAceiteConcorrente(body);versaoConfiguracao=2;};
    try {
      const retorno=await POST(req("",body));
      assert.equal(retorno.status,200,await retorno.clone().text());
      const aceito=registros.find(r=>r.chaveIdempotencia===body.chaveIdempotencia);assert.ok(aceito);
      const recibo=await retorno.json();assert.equal(recibo.id,aceito.id);
      assert.equal(registros.length,antes+1);assert.equal(criacoesTentadas,criadas);
      assert.equal(recibo.aplicativo.id,id(3));
    } finally { aposLookupVazio=null;versaoConfiguracao=1; }
  });
  await t.test("aceite concorrente de outro conteúdo mantém conflito de hash e não cria nem sobrescreve pedido",async()=>{
    const body={...entrada,chaveIdempotencia:id(131)},antes=registros.length,criadas=criacoesTentadas;
    aposLookupVazio=()=>{registrarAceiteConcorrente({...body,observacao:"Conteúdo confirmado em outra requisição"});versaoConfiguracao=2;};
    try {
      const retorno=await POST(req("",body));assert.equal(retorno.status,409);
      const conflito=await retorno.json();assert.equal(conflito.pedidoExistente?.id,registros.at(-1)?.id);
      assert.equal(registros.length,antes+1);assert.equal(criacoesTentadas,criadas);
      assert.equal((registros.at(-1)?.dadosPedido as {observacao:string}).observacao,"Conteúdo confirmado em outra requisição");
    } finally { aposLookupVazio=null;versaoConfiguracao=1; }
  });
  await t.test("falha durante validação concorrente permite recuperar a mesma chave após o primeiro aceite",{timeout:3000},async()=>{
    const body={...entrada,chaveIdempotencia:id(132)},antes=registros.length,criadas=criacoesTentadas;
    let avisarInicio:()=>void=()=>undefined,liberarConsulta:()=>void=()=>undefined;
    const iniciou=new Promise<void>(resolve=>{avisarInicio=resolve;});
    const liberar=new Promise<void>(resolve=>{liberarConsulta=resolve;});
    pausaConsulta={iniciou:avisarInicio,liberar};
    const primeiro=POST(req("",body));
    try {
      await iniciou;
      ufCliente="SP";
      const segunda=await POST(req("",body));assert.equal(segunda.status,409);
      assert.equal(registros.length,antes,"a primeira requisição continua em validação");
      ufCliente=null;liberarConsulta();
      const aceita=await primeiro;assert.equal(aceita.status,201,await aceita.clone().text());
      assert.equal(registros.length,antes+1);assert.equal(criacoesTentadas,criadas+1);
      const consultasAntes=consultas,recuperada=await POST(req("",body));assert.equal(recuperada.status,200);
      assert.equal((await recuperada.json()).id,registros.at(-1)?.id);assert.equal(consultas,consultasAntes);
      const corrigida=await POST(req("",{...body,observacao:"Correção iniciada enquanto o aceite estava em andamento"}));
      assert.equal(corrigida.status,409);assert.equal((await corrigida.json()).pedidoExistente?.id,registros.at(-1)?.id);
      assert.equal(criacoesTentadas,criadas+1);
    } finally { ufCliente=null;pausaConsulta=null;liberarConsulta();await primeiro; }
  });
  await t.test("mesma chave com conteúdos concorrentes cria uma fila e devolve o comprovante no conflito",async()=>{
    const body={...entrada,chaveIdempotencia:id(133)},antes=registros.length;
    const retornos=await Promise.all([POST(req("",body)),POST(req("",{...body,observacao:"Outra confirmação"}))]);
    assert.deepEqual(retornos.map(r=>r.status).sort(),[201,409]);
    assert.equal(registros.length,antes+1);
    const conflito=retornos.find(r=>r.status===409);assert.ok(conflito);
    assert.equal((await conflito.json()).pedidoExistente?.id,registros.at(-1)?.id);
  });
  await t.test("aceites anteriores sem documento continuam recuperáveis sem consultar a Olist",async()=>{
    const semDocumento={...entrada,chaveIdempotencia:id(142),origemManual:{...entrada.origemManual,cliente:{...entrada.origemManual.cliente,cpfCnpj:null}}};
    const aceito=registrarAceiteConcorrente(semDocumento),antes=consultas,criadas=criacoesTentadas;
    try {
      cpfCnpjCliente=null;
      const recuperado=await POST(req("",semDocumento));
      assert.equal(recuperado.status,200);assert.equal((await recuperado.json()).id,aceito.id);
      const legado=pedidoManualLegadoSchema.parse({chaveIdempotencia:id(143),aplicativoId:entrada.aplicativoId,
        observacao:entrada.observacao,selecoes:entrada.selecoes,itens:entrada.itens});
      registros.push({...aceito,id:id(144),chaveIdempotencia:legado.chaveIdempotencia,hashEntrada:createHash("sha256").update(JSON.stringify(legado)).digest("hex")});
      assert.equal((await POST(req("",legado))).status,200);
      assert.equal(consultas,antes);assert.equal(criacoesTentadas,criadas);
    } finally { cpfCnpjCliente=documentoCliente; }
  });
});
