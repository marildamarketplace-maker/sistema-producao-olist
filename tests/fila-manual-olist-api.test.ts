import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import type { PedidoFornecedorQueue, EnvioPedidoManual, Prisma } from "@prisma/client";
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;

test("fila manual: revisão, reserva durável, concorrência, redirecionamento, cancelamento e conciliação",async t=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="fake";
  const matriz=id(2),filial=id(3),filaId=id(10),autorId=id(1),adminId=id(8),planoId=id(4),previaId=id(20);
  const selecoes={clienteId:30,vendedorId:20,formaId:40,planoId,tipoVenda:"VENDA",tecidos:[{tecidoId:id(5),id:50,preco:10}],laser:null};
  const dados={versao:1,observacao:"Observação",olist:{filialId:matriz,selecoes},itens:[{produtoId:id(5),sku:"",tecido:{id:id(5),nome:"Oxford",referencia:null},
    quantidade:10,unidade:"UN",quantidadeTecido:2.5,unidadeTecido:"MT",estampa:"6861",variante:"A",tamanho:"30x30",tipoProduto:"Lenço",corteLaser:false}]};
  let fila:PedidoFornecedorQueue;
  let envio:EnvioPedidoManual|null=null;
  let previa:{id:string;usuarioId:string;filaId:string;filialId:string;versao:number;selecoes:unknown;payload:unknown;expiraEm:Date}|null=null;
  let posts=0,permitido=true,modo="sucesso",carteira=20,vinculo:number|null=20,marcadorCorreto=true;
  let consultas=0, detalhesProdutos=0;
  const urlsConsultadas:string[]=[];
  let referenciaNova=false,semVinculoDestino=false,autorVersao=0,mudarAutorNaTransacao=false,emTransacao=false,revogarOperadorNaTransacao=false;
  const reset=()=>{
    fila={id:filaId,aplicativoSolicitanteId:matriz,aplicativoFornecedorId:matriz,aplicativoFilialId:matriz,solicitacaoProducaoId:null,fornecedorId:null,
      tipoOrigem:"MANUAL",autorId,chaveIdempotencia:id(6),hashEntrada:"hash",vendedorFixo:true,createdAt:new Date(),direcionadoEm:new Date(),direcionadoPorId:autorId,
      status:"PENDENTE",versao:0,dadosPedido:structuredClone(dados) as Prisma.JsonObject};
    envio=null;previa=null;posts=0;modo="sucesso";carteira=20;vinculo=20;marcadorCorreto=true;
    referenciaNova=false;semVinculoDestino=false;autorVersao=0;mudarAutorNaTransacao=false;revogarOperadorNaTransacao=false;permitido=true;
  };
  reset();
  type Patch={status?:PedidoFornecedorQueue["status"];versao?:{increment:number};dadosPedido?:Prisma.JsonValue;aplicativoFilialId?:string;direcionadoEm?:Date;direcionadoPorId?:string};
  const aplicar=(data:Patch)=>{const {versao,...resto}=data;Object.assign(fila,resto);if(versao)fila.versao+=versao.increment;};
  const tx={
    usuario:{findFirst:async({where}:{where:{id:string}})=>where.id===autorId?{id:autorId,ativo:true,aplicativoId:matriz,podeSelecionarFilialFornecedor:true,vinculosOlistVersao:autorVersao}:{id:adminId,ativo:true,aplicativoId:matriz},
      findUnique:async({where}:{where:{id:string}})=>where.id===autorId?{id:autorId,ativo:true,aplicativoId:matriz,podeSelecionarFilialFornecedor:true,vinculosOlistVersao:autorVersao}:{id:adminId,ativo:true,aplicativoId:matriz,podeGerenciarFilaPedidos:permitido}},
    usuarioVendedorOlist:{findFirst:async({where}:{where:{usuarioId:string;aplicativoId?:string}})=>{assert.equal(where.usuarioId,autorId,"usar vínculo do autor, não do administrador");
      if(referenciaNova)return where.aplicativoId===filial?(semVinculoDestino?null:{vendedorOlistId:120}):{vendedorOlistId:20};
      return vinculo===null?null:{vendedorOlistId:vinculo};}},
    aplicativo:{findFirst:async({where}:{where:{id?:string;aplicativoPaiId?:string}})=>where.aplicativoPaiId===matriz?{id:filial,nome:"Conta filha"}:[matriz,filial].includes(where.id??"")?{id:where.id,nome:"Conta"}:null,
      findUnique:async()=>({olistClientId:"fake",olistClientSecret:"fake"})},
    integracaoOlistToken:{findUnique:async({where}:{where:{aplicativoId_provider:{aplicativoId:string}}})=>({accessToken:`fake-${where.aplicativoId_provider.aplicativoId}`,expiresAt:new Date(Date.now()+3600_000)})},
    formaPagamentoOlistPlano:{findFirst:async()=>({planoPagamento:{nome:"30/60"}})},
    pedidoFornecedorQueue:{
      findFirst:async({where}:{where:{id:string;aplicativoFornecedorId:string}})=>where.id===fila.id&&where.aplicativoFornecedorId===matriz?structuredClone(fila):null,
      updateMany:async({where,data}:{where:{id:string;versao?:number;status?:{in?:string[];not?:string}|string;aplicativoFilialId?:string};data:Patch})=>{
        if(where.id!==fila.id || (where.versao!==undefined&&where.versao!==fila.versao) || (where.aplicativoFilialId&&where.aplicativoFilialId!==fila.aplicativoFilialId))return {count:0};
        if(typeof where.status==="string"&&where.status!==fila.status)return {count:0};
        if(typeof where.status==="object"&&where.status.in&&!where.status.in.includes(fila.status))return {count:0};
        if(typeof where.status==="object"&&where.status.not===fila.status)return {count:0};
        aplicar(data);return {count:1};
      },update:async({data}:{data:Patch})=>{aplicar(data);return structuredClone(fila);},
    },
    envioPedidoManual:{findUnique:async()=>envio?structuredClone(envio):null,
      upsert:async({create}:{create:EnvioPedidoManual})=>{envio=structuredClone(create);return envio;},
      update:async({where,data}:{where:{tentativaId?:string;estado?:string|{in:string[]}};data:Partial<EnvioPedidoManual>})=>{
        assert.ok(envio);if(where.tentativaId)assert.equal(where.tentativaId,envio.tentativaId);Object.assign(envio,data);return envio;
      },
      updateMany:async({where,data}:{where:{tentativaId?:string;estado?:{in:string[]}};data:Partial<EnvioPedidoManual>})=>{
        if(!envio||(where.tentativaId&&where.tentativaId!==envio.tentativaId)||(where.estado&&!where.estado.in.includes(envio.estado)))return {count:0};
        Object.assign(envio,data);return {count:1};
      },
    },
    previaFornecedor:{create:async({data}:{data:NonNullable<typeof previa>})=>{previa={...data,id:previaId};return previa;},
      findFirst:async({where}:{where:{id:string;versao:number;usuarioId:string;filialId:string}})=>previa&&previa.id===where.id&&previa.versao===where.versao&&previa.usuarioId===where.usuarioId&&previa.filialId===where.filialId&&previa.expiraEm>new Date()?previa:null},
    $queryRaw:async(sql:TemplateStringsArray,...values:unknown[])=>{
      const texto=sql.join("?");assert.doesNotMatch(texto,/solicitacoes_producao/);
      if(texto.includes("FROM usuario"))return [{id:autorId}];
      if(texto.includes("aplicativo_pai_id IS NULL"))return [];
      if(texto.includes("FROM aplicativo"))return [matriz,filial].includes(String(values[0]))?[{id:values[0]}]:[];
      assert.match(texto,/pedido_fornecedor_queue[\s\S]*FOR UPDATE/);return [{id:filaId}];
    },
  };
  let corrente:Promise<unknown>=Promise.resolve();
  Object.assign(globalThis,{prisma:{...tx,$transaction:(fn:(c:typeof tx)=>unknown)=>{const next=corrente.then(async()=>{if(mudarAutorNaTransacao){autorVersao++;mudarAutorNaTransacao=false;}if(revogarOperadorNaTransacao){permitido=false;revogarOperadorNaTransacao=false;}emTransacao=true;try{return await fn(tx);}finally{emTransacao=false;}});corrente=next.catch(()=>undefined);return next;}}});
  const {supabaseAdmin}=await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth,"getUser",async()=>({data:{user:{id:adminId,email:"test@example.test"}},error:null}));
  t.mock.method(axios,"get",async(url:string,opcoes?:{headers?:{Authorization?:string}})=>{
    consultas++;urlsConsultadas.push(url);const parsed=new URL(url),p=parsed.pathname; if (p.endsWith("/produtos/50")) detalhesProdutos++; let data:unknown;
    if(referenciaNova){
      assert.equal(emTransacao,false,"consultas Olist devem ocorrer fora dos locks da fila");
      const destino=opcoes?.headers?.Authorization?.endsWith(filial)??false;
      const vendedorId=destino?120:20,clienteId=destino?130:30;
      const vendedor={id:vendedorId,situacao:"A",contato:{id:destino?210:200,nome:"Vendedor",cpfCnpj:"98765432100",codigo:destino?"VEN-D":"VEN-O"}};
      const cliente={id:clienteId,nome:"Cliente",cpfCnpj:"12345678909",situacao:"A",vendedor:{id:vendedorId},endereco:{uf:destino?"SP":"MG"}};
      if(p.endsWith("/vendedores"))data={itens:[vendedor],paginacao:{total:1}};
      else if(p.endsWith("/contatos"))data={itens:[parsed.searchParams.get("cpfCnpj")==="98765432100"?{...vendedor.contato,situacao:"A"}:cliente],paginacao:{total:1}};
      else if(/\/contatos\/(30|130)$/.test(p))data=cliente;
      else if(p.endsWith("/contatos/999"))data={...cliente,id:999,nome:"Outra pessoa",cpfCnpj:"11111111111"};
      else data={id:Number(p.split("/").at(-1)),nome:"Cadastro",situacao:"A",vendedor:{id:vendedorId}};
      return {status:200,data,headers:{"content-type":"application/json"}};
    }
    if(p.endsWith("/vendedores"))data={itens:[{id:20,nome:"Vendedor",situacao:"A"}],paginacao:{total:1}};
    else if(p.endsWith("/pedidos/123"))data={id:123,observacoesInternas:marcadorCorreto?`Outra observação\nPedido manual da fila: ${filaId}`:"Outro pedido"};
    else data={id:Number(p.split("/").at(-1)),nome:"Cadastro",situacao:"A",vendedor:{id:carteira}};
    return {status:200,data,headers:{"content-type":"application/json"}};
  });
  t.mock.method(axios,"post",async(_url:string,payload:Record<string,unknown>)=>{
    posts++;assert.match(String(payload.observacoesInternas),new RegExp(`Pedido manual da fila: ${filaId}`));
    if(modo==="timeout")throw new Error("network-secret");
    if(modo==="rejeitado")return {status:400,data:{error:"invalid"}};
    return {status:200,data:{id:123}};
  });
  const rota=await import("../src/app/api/fornecedores/fila/[id]/olist/route");
  const admin=await import("../src/app/api/fornecedores/fila/administracao/route");
  const req=(body?:unknown,method=body?"POST":"GET")=>new Request("https://example.test/api",{method,headers:{Authorization:"Bearer fake"},...(body?{body:JSON.stringify(body)}:{})});
  const ctx={params:Promise.resolve({id:filaId})};
  const preview=(s:unknown=selecoes)=>rota.POST(req({acao:"preview",versao:fila.versao,selecoes:s}),ctx);
  const confirmar=()=>rota.POST(req({acao:"confirmar",previaId}),ctx);
  const cancelar=()=>admin.POST(req({acao:"CANCELAR",pedidoId:filaId,versao:fila.versao}));
  const adicionarReferencia=()=>{
    referenciaNova=true;
    fila.dadosPedido={...dados,origemManual:{aplicativoId:matriz,vendedor:{id:20,nome:"Vendedor",cpfCnpj:"98765432100"},
      cliente:{id:30,nome:"Cliente",cpfCnpj:"12345678909",uf:"MG"}},direcionamentoManual:{
      inicial:{tipo:"PADRAO",regraId:null,regraNome:null,versao:3,aplicativoId:matriz,motivo:"Aplicativo padrão"},alteracoes:[],
    }} as Prisma.JsonObject;
  };
  await t.test("prévia informa os campos inválidos sem consultar nem criar na Olist", async () => {
    reset();
    const response = await preview({ ...selecoes, planoId: "", tecidos: selecoes.tecidos.map(t => ({ ...t, preco: -1 })) });
    assert.equal(response.status, 400);
    const resultado = await response.json();
    assert.match(resultado.campos.planoId, /Selecione um plano de pagamento/);
    assert.match(resultado.campos["tecidos.0.preco"], /Produto 1.*preço/);
    assert.ok(!resultado.error.includes("gere outra prévia"));
    assert.equal(consultas, 0);
    assert.equal(posts, 0);
  });
  await t.test("vendedor salvo não é substituído pelo administrador; carteira é verificada na prévia",async()=>{
    const inicial=await (await rota.GET(req(),ctx)).json();assert.equal(inicial.vendedorFixo,true);assert.equal(inicial.selecoes.vendedorId,20);
    const antes=consultas;assert.equal((await preview({...selecoes,vendedorId:99})).status,403);assert.equal(consultas,antes);
    carteira=99;assert.equal((await preview()).status,403);carteira=20;
    vinculo=null;assert.equal((await preview()).status,409);vinculo=25;
    const alterado=await (await rota.GET(req(),ctx)).json();assert.equal(alterado.selecoes.vendedorId,25);assert.equal(alterado.selecoes.clienteId,undefined);
    vinculo=20;
  });
  await t.test("prévia conserva quantidade, usa versão e duas confirmações fazem um único POST",async()=>{
    const r=await preview();assert.equal(r.status,200);const p=await r.json();assert.equal(p.payload.itens[0].quantidade,2.5);assert.match(p.payload.itens[0].infoAdicional,/<QTD>10,00<\/QTD><UN>UN<\/UN>/);assert.equal(posts,0);
    const results=await Promise.all([confirmar(),confirmar()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal(posts,1);assert.equal(fila.status,"CONCLUIDO");assert.equal((await rota.GET(req(),ctx)).status,200);
    assert.equal((await cancelar()).status,409);
  });
  await t.test("timeout bloqueia reenvio, cancelamento e redirecionamento até conciliar",async()=>{
    reset();assert.equal((await preview()).status,200);modo="timeout";
    const r=await confirmar();assert.equal(r.status,409);assert.doesNotMatch(await r.text(),/network-secret/);
    assert.equal(fila.status,"FALHADO");assert.equal((await preview()).status,409);assert.equal(posts,1);
    assert.equal((await cancelar()).status,409);
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao:fila.versao,filialId:filial},"PATCH"))).status,409);
    assert.ok(envio);marcadorCorreto=false;
    const conciliar=()=>rota.POST(req({acao:"vincular",tentativaId:envio!.tentativaId,pedidoOlistId:"123",justificativa:"Conferido manualmente"}),ctx);
    assert.equal((await conciliar()).status,400);marcadorCorreto=true;assert.equal((await conciliar()).status,200);
    assert.equal(fila.status,"CONCLUIDO");assert.equal(posts,1);
  });
  await t.test("ausência confirmada libera nova prévia e reserva interrompida é recuperável",async()=>{
    reset();await preview();modo="timeout";await confirmar();assert.ok(envio);
    envio.estado="RESERVADO";envio.iniciadoEm=new Date(0);fila.status="PROCESSAR";
    const inicial=await (await rota.GET(req(),ctx)).json();assert.equal(inicial.envio.estado,"INCERTO");assert.equal(fila.status,"FALHADO");
    assert.equal((await rota.POST(req({acao:"confirmar-ausencia",tentativaId:envio.tentativaId,justificativa:"Conferi a conta sem pedido",ausenciaConfirmada:true}),ctx)).status,200);
    assert.equal((await preview()).status,200);modo="sucesso";assert.equal((await confirmar()).status,200);assert.equal(posts,2);
  });
  await t.test("rejeição explícita permite correção; trocar conta invalida seleções e prévias",async()=>{
    reset();await preview();modo="rejeitado";assert.equal((await confirmar()).status,409);
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao:fila.versao,filialId:filial},"PATCH"))).status,200);
    assert.equal(fila.aplicativoFilialId,filial);assert.equal((fila.dadosPedido as Prisma.JsonObject).olist,undefined);
    assert.equal((await confirmar()).status,409);assert.equal(posts,1);
    const result=await (await rota.GET(req(),ctx)).json();assert.equal(result.selecoes,null);assert.equal(result.vendedorOlistPadraoId,20);
  });
  await t.test("produto repetido consulta o detalhe uma vez por validação e agrupa a metragem",async()=>{
    reset(); const segundo={...dados.itens[0],produtoId:id(6),tecido:{...dados.itens[0].tecido,id:id(6)}};
    fila.dadosPedido={...dados,itens:[dados.itens[0],segundo]} as Prisma.JsonObject;
    const antes=detalhesProdutos;
    const r=await preview({...selecoes,tecidos:[...selecoes.tecidos,{tecidoId:id(6),id:50,preco:10}]});
    assert.equal(r.status,200);assert.equal(detalhesProdutos-antes,1);
    assert.equal((await r.json()).payload.itens[0].quantidade,5);
  });
  await t.test("fila manual própria é cancelável mesmo quando o aplicativo é filial",async()=>{
    reset();assert.equal((await cancelar()).status,200);assert.equal(fila.status,"CANCELADO");assert.equal((await preview()).status,409);
    reset();permitido=false;assert.equal((await rota.GET(req(),ctx)).status,403);assert.equal((await cancelar()).status,403);permitido=true;
  });
  await t.test("troca preserva referência comercial e histórico para recuperação por campo no novo destino",async()=>{
    reset();adicionarReferencia();
    assert.equal((await preview()).status,200);
    const antes=urlsConsultadas.length;
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao:fila.versao,filialId:filial},"PATCH"))).status,200);
    const {dadosPedidoFilaSchema}=await import("../src/lib/fila-fornecedor-contrato");
    const snapshot=dadosPedidoFilaSchema.parse(fila.dadosPedido);
    assert.equal(fila.aplicativoFilialId,filial);
    assert.deepEqual(snapshot.olist,{filialId:filial,selecoes:{vendedorId:120,tipoVenda:"VENDA"}});
    assert.deepEqual(snapshot.olistAnterior,{filialId:matriz,selecoes});
    assert.equal(snapshot.origemManual?.cliente.uf,"MG");
    assert.equal(snapshot.direcionamentoManual?.inicial.aplicativoId,matriz);
    assert.equal(snapshot.direcionamentoManual?.alteracoes.length,1);
    assert.equal(snapshot.direcionamentoManual?.alteracoes[0].usuarioId,adminId);
    assert.equal((await confirmar()).status,409,"a prévia anterior não vale no novo destino");
    const novas=urlsConsultadas.slice(antes).map(url=>new URL(url));
    const consultasVendedores=novas.filter(u=>u.pathname.endsWith("/vendedores"));
    assert.equal(consultasVendedores.length,0,"trocar o destino preserva referência sem bloquear na resolução remota");
    assert.ok(consultasVendedores.every(u=>u.searchParams.get("limit")==="100"&&u.searchParams.get("offset")==="0"),"a busca por ID mantém páginas limitadas");
    const destinoSelecoes={...selecoes,clienteId:130,vendedorId:120};
    assert.equal((await preview(destinoSelecoes)).status,200);
    assert.equal(dadosPedidoFilaSchema.parse(fila.dadosPedido).direcionamentoManual?.alteracoes.length,1,"regravação preserva metadados");
    assert.equal((await confirmar()).status,200);
    assert.equal(posts,1);assert.equal(fila.aplicativoFilialId,filial);assert.equal(envio?.aplicativoId,filial);
  });
  await t.test("falha de vínculo ou mudança concorrente não altera o destino novo nem seus IDs",async()=>{
    reset();adicionarReferencia();semVinculoDestino=true;
    const versao=fila.versao;
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao,filialId:filial},"PATCH"))).status,409);
    assert.equal(fila.aplicativoFilialId,matriz);assert.equal(fila.versao,versao);
    semVinculoDestino=false;mudarAutorNaTransacao=true;
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao,filialId:filial},"PATCH"))).status,409);
    assert.equal(fila.aplicativoFilialId,matriz);assert.equal(fila.versao,versao);
    assert.equal(posts,0);
  });
  await t.test("novo pedido bloqueia troca para pai com filhos e não aceita outro cliente na aprovação",async()=>{
    reset();adicionarReferencia();
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao:fila.versao,filialId:filial},"PATCH"))).status,200);
    const antes=fila.versao;
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao:antes,filialId:matriz},"PATCH"))).status,403);
    assert.equal(fila.aplicativoFilialId,filial);assert.equal(fila.versao,antes);
    assert.equal((await preview({...selecoes,clienteId:999,vendedorId:120})).status,409);
    assert.equal(posts,0);
  });
  await t.test("alteração do autor entre validação e reserva final bloqueia envio sem POST externo",async()=>{
    reset();adicionarReferencia();
    assert.equal((await preview()).status,200);
    const versao=fila.versao;mudarAutorNaTransacao=true;
    assert.equal((await confirmar()).status,409);
    assert.equal(fila.status,"PENDENTE");assert.equal(fila.versao,versao);assert.equal(posts,0);assert.equal(envio,null);
  });
  await t.test("revogar permissão do operador durante consultas bloqueia redirecionamento e reserva",async()=>{
    reset();adicionarReferencia();revogarOperadorNaTransacao=true;
    assert.equal((await admin.PATCH(req({pedidoId:filaId,versao:fila.versao,filialId:filial},"PATCH"))).status,403);
    assert.equal(fila.aplicativoFilialId,matriz);assert.equal(fila.versao,0);
    reset();adicionarReferencia();assert.equal((await preview()).status,200);
    revogarOperadorNaTransacao=true;assert.equal((await confirmar()).status,403);
    assert.equal(posts,0);assert.equal(envio,null);assert.equal(fila.status,"PENDENTE");
  });
});
