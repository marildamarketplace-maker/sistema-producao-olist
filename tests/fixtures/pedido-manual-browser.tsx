import { createRoot } from "react-dom/client";
import { CriarPedidoManual } from "../../src/components/criar-pedido-manual";
import type { EntradaPedidoProducao } from "../../src/lib/pedido-producao-contrato";
import type { EntradaPedidoManual } from "../../src/lib/pedido-manual-contrato";
const id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
declare global { interface Window { testeManual: { envios:(EntradaPedidoManual | EntradaPedidoProducao)[]; falhar:boolean; consumoAlterado:boolean; fonteAtual:string; falharCarteira:boolean; semVinculoAplicativoId:string|null; conflitoExistente:boolean; clienteSemDocumento:boolean; vendedorAtual:number; consultas:string[]; referenciaAtual:string; contextoAtual:string } } }
const params = new URLSearchParams(location.search);
if (!params.has("preservar")) sessionStorage.clear();
document.documentElement.classList.toggle("dark",params.get("tema")==="dark");
window.testeManual = {envios:[],falhar:false,consumoAlterado:false,fonteAtual:"b".repeat(64),falharCarteira:false,semVinculoAplicativoId:null,conflitoExistente:false,clienteSemDocumento:false,vendedorAtual:20,consultas:[],referenciaAtual:id(2),contextoAtual:"contexto-validado-local"};
let falhouInicial=false;
let falhouVendedor=false;
window.fetch = async (input,init) => {
  const url = new URL(typeof input === "string"?input:input instanceof URL?input.href:input.url,location.href);
  const query = url.searchParams;
  if (init?.method === "POST") {
    const body=JSON.parse(String(init.body)) as EntradaPedidoManual | EntradaPedidoProducao;
    window.testeManual.envios.push(body);
    if(window.testeManual.consumoAlterado) return Response.json({error:"O consumo do tamanho mudou. Selecione o tamanho novamente.",codigo:"ITENS_METRAGEM_DESATUALIZADA"},{status:409});
    if(window.testeManual.falhar) throw new Error("Conexão interrompida após envio");
    if(window.testeManual.conflitoExistente) return Response.json({error:"Esta confirmação já foi usada para outro conteúdo. As alterações atuais não foram aplicadas.",pedidoExistente:{id:id(10),status:"CANCELADO",createdAt:new Date().toISOString(),aplicativo:{id:id(3),nome:"Destino atual do pedido aceito"}}},{status:409});
    const vendedorEsperado=[id(2),id(4),id(5)].includes(body.aplicativoId)?window.testeManual.vendedorAtual:window.testeManual.vendedorAtual+100;
    if(body.selecoes.vendedorId!==vendedorEsperado) return Response.json({error:"Use o vendedor vinculado nesta conta."},{status:403});
    return Response.json({id:id(10),status:"PENDENTE",createdAt:new Date().toISOString(),aplicativo:{id:body.aplicativoId,nome:"Conta própria"},filaExterna:Boolean(body.fornecedorManual)},{status:201});
  }
  window.testeManual.consultas.push(url.search);
  if (query.get("acao") === "tamanhos") return Response.json({ itens: [
    { id: id(70), titulo: "70 × 70", sku: "70", consumo: 0.5 },
    { id: id(90), titulo: "90 × 90", sku: "90", consumo: 0.8 },
    { id: id(99), titulo: "Sem consumo", sku: "99", consumo: null },
  ], mais: false });
  if (query.has("solicitacaoId") && query.get("acao") === "origem") return Response.json({
    itens: [...[40,41].map((n,index) => ({ id:id(n), tecidoNome:`Oxford da produção ${index+1}`, modalidade:"PRODUTO_SUBLIMADO", quantidade:3, quantidadeTecido:1.5, estampa:"6861",variante:"A",tamanho:"50x50",tipoProduto:"Lenço",corteLaser:false })), {id:id(42), tecidoNome:"", quantidade:1, quantidadeTecido:0, estampa:"", variante:null, tamanho:"", tipoProduto:"", corteLaser:false}], observacao:"Observação original da produção",revisao:"a".repeat(64),revisaoFonte:window.testeManual.fonteAtual,
  });
  if(query.get("acao")==="resolver") {
    if(window.testeManual.falharCarteira) return Response.json({error:"Usuário vendedor sem vínculo nesta empresa."},{status:403});
    if(window.testeManual.clienteSemDocumento) return Response.json({error:"Cadastre o CPF/CNPJ do cliente no aplicativo de referência antes de criar o pedido."},{status:409});
    const referenciaId=query.get("aplicativoOrigemId")??id(2), externa=[id(4),id(5),id(7)].includes(referenciaId);
    const unica=externa?params.has("fornecedorSemFiliais"):params.has("contaUnica"), destino=externa?(unica?id(4):id(7)):unica?id(2):id(3);
    if(window.testeManual.semVinculoAplicativoId && [referenciaId,destino].includes(window.testeManual.semVinculoAplicativoId)) return Response.json({error:"Aguardando configuração de vendedor pelo fornecedor."},{status:403});
    const vendedorOrigem=window.testeManual.vendedorAtual+(referenciaId===id(7)?100:0);
    const vendedorDestino=referenciaId===destino?vendedorOrigem:window.testeManual.vendedorAtual+100;
    return Response.json({...(query.has("solicitacaoId")?{contextoConsulta:window.testeManual.contextoAtual}:{}),referencia:{aplicativoId:referenciaId,vendedor:{id:vendedorOrigem,nome:`Vendedor vinculado · ID ${vendedorOrigem}`,cpfCnpj:null},cliente:{id:30,nome:"Cliente com nome comercial longo para validar leitura e seleção",cpfCnpj:"52998224725",uf:"MG"}},
      ...(params.has("semAplicativoDestino")?{}:{aplicativoDestino:{id:destino,nome:externa?(unica?"MV Tecidos fornecedor com nome longo":"Filial B do fornecedor"):unica?"Conta própria":"Filial com nome muito longo para verificar responsividade"}}),
      ...(externa?{fornecedorManual:{fornecedorId:id(6),matrizId:id(4),aplicativoSolicitanteId:id(2),autorId:id(1),referencia:{aplicativoId:referenciaId,vendedorOlistId:vendedorOrigem,revisao:1},destino:{aplicativoId:destino,vendedorOlistId:vendedorDestino,revisao:1}}}:{}),
      decisao:{tipo:unica?"CONTA_UNICA":"PADRAO",regraId:null,regraNome:null,versao:unica?0:1,aplicativoId:destino,motivo:unica?"Única conta disponível.":"Aplicativo padrão configurado pelo pai."},selecoes:{vendedorId:vendedorDestino,clienteId:referenciaId===destino?30:130,vendedorFixo:true}});
  }
  if(query.has("pedidoId")) return Response.json({id:id(10),status:"PENDENTE",createdAt:new Date().toISOString(),aplicativo:{id:id(2),nome:"Conta própria"}});
  if(!query.has("aplicativoId")) {
    if(params.has("falhaInicial")&&!falhouInicial){falhouInicial=true;return Response.json({error:"Falha temporária ao carregar contas."},{status:502});}
    const aplicativos=params.has("contaUnica")?[{id:id(2),nome:"Conta própria"}]:[{id:id(2),nome:"Conta própria"},{id:id(3),nome:"Filial com nome muito longo para verificar responsividade"}];
    const contasFornecedor=params.has("fornecedorSemFiliais")?[{id:id(4),nome:"MV Tecidos fornecedor com nome longo",fornecedorId:id(6)}]:[
      {id:id(5),nome:"Filial A do fornecedor com nome longo para validar responsividade",fornecedorId:id(6)},
      {id:id(7),nome:"Filial B do fornecedor",fornecedorId:id(6)},
    ];
    if(params.has("disponibilidade")) {
      const modo=params.get("disponibilidade");
      const contas=modo==="semFornecedor"?[]:contasFornecedor.map((a,index)=>({...a,bloqueio:modo==="semVendedor"||index===0?"Vendedor não vinculado nesta conta do fornecedor.":null,vendedorId:modo==="semVendedor"||index===0?null:120}));
      return Response.json({aplicativos:contas,aplicativoPadraoId:contas.find(a=>!a.bloqueio)?.id??""});
    }
    return Response.json({aplicativos:params.has("fornecedor")?[...aplicativos,...contasFornecedor]:aplicativos,aplicativoPadraoId:window.testeManual.referenciaAtual});
  }
  if(!query.has("recurso")) {
    if(params.has("falhaVendedor")&&!falhouVendedor){falhouVendedor=true;return Response.json({error:"Falha temporária ao carregar vendedor."},{status:502});}
    if(params.has("padraoSemVinculo")&&query.get("aplicativoId")===id(2)) return Response.json({error:"Usuário vendedor sem vínculo nesta empresa."},{status:403});
    if(window.testeManual.semVinculoAplicativoId===query.get("aplicativoId")) return Response.json({error:"Aguardando configuração de vendedor pelo fornecedor."},{status:403});
    if(window.testeManual.falharCarteira) return Response.json({error:"Usuário vendedor sem vínculo nesta empresa."},{status:403});
    return Response.json({conta:{id:query.get("aplicativoId"),nome:"Conta"},vendedorId:params.has("livre")?null:[id(2),id(4),id(5)].includes(query.get("aplicativoId")??"")?window.testeManual.vendedorAtual:query.get("aplicativoId")===id(7)?window.testeManual.vendedorAtual+100:21,vendedorFixo:!params.has("livre")});
  }
  const pagina=Number(query.get("pagina")??1);
  const produtos=[
    {id:6887,nome:"BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887",preco:15.99},
    {id:5168,nome:"FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168 1J3B4C6D2B",preco:18.99},
  ];
  const paginado=params.has("catalogoPaginado")&&query.get("recurso")==="produtos";
  return Response.json({itens:query.get("recurso")==="clientes"?[{id:30,nome:"Cliente com nome comercial longo para validar leitura e seleção",referencia:"C30"}]:query.get("recurso")==="vendedores"?[{id:20,nome:"Vendedor",referencia:"V20"}]:query.get("recurso")==="produtos"?(paginado&&pagina===1?Array.from({length:50},(_,index)=>({id:1000+index,nome:`Oxford Ref. ${1000+index}`,preco:10})):produtos):[],pagina,mais:paginado&&pagina===1});
};
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-6xl p-4"><CriarPedidoManual token="teste" usuarioId={id(1)} podeGerenciarFila={false} solicitacaoId={params.get("solicitacaoId") ?? undefined} /></main>);
