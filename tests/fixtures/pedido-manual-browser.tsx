import { createRoot } from "react-dom/client";
import { CriarPedidoManual } from "../../src/components/criar-pedido-manual";
import type { EntradaPedidoManual } from "../../src/lib/pedido-manual-contrato";
const id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
declare global { interface Window { testeManual: { envios:EntradaPedidoManual[]; falhar:boolean; falharCarteira:boolean; conflitoExistente:boolean; clienteSemDocumento:boolean; vendedorAtual:number; consultas:string[]; referenciaAtual:string } } }
const params = new URLSearchParams(location.search);
if (!params.has("preservar")) sessionStorage.clear();
document.documentElement.classList.toggle("dark",params.get("tema")==="dark");
window.testeManual = {envios:[],falhar:false,falharCarteira:false,conflitoExistente:false,clienteSemDocumento:false,vendedorAtual:20,consultas:[],referenciaAtual:id(2)};
let falhouInicial=false;
window.fetch = async (input,init) => {
  const url = new URL(typeof input === "string"?input:input instanceof URL?input.href:input.url,location.href);
  const query = url.searchParams;
  if (init?.method === "POST") {
    const body=JSON.parse(String(init.body)) as EntradaPedidoManual;
    window.testeManual.envios.push(body);
    if(window.testeManual.falhar) throw new Error("Conexão interrompida após envio");
    if(window.testeManual.conflitoExistente) return Response.json({error:"Esta confirmação já foi usada para outro conteúdo. As alterações atuais não foram aplicadas.",pedidoExistente:{id:id(10),status:"CANCELADO",createdAt:new Date().toISOString(),aplicativo:{id:id(3),nome:"Destino atual do pedido aceito"}}},{status:409});
    const vendedorEsperado=body.aplicativoId===id(2)?window.testeManual.vendedorAtual:window.testeManual.vendedorAtual+100;
    if(body.selecoes.vendedorId!==vendedorEsperado) return Response.json({error:"Use o vendedor vinculado nesta conta."},{status:403});
    return Response.json({id:id(10),status:"PENDENTE",createdAt:new Date().toISOString(),aplicativo:{id:body.aplicativoId,nome:"Conta própria"}},{status:201});
  }
  window.testeManual.consultas.push(url.search);
  if(query.get("acao")==="resolver") {
    if(window.testeManual.falharCarteira) return Response.json({error:"Usuário vendedor sem vínculo nesta empresa."},{status:403});
    if(window.testeManual.clienteSemDocumento) return Response.json({error:"Cadastre o CPF/CNPJ do cliente no aplicativo de referência antes de criar o pedido."},{status:409});
    const unica=params.has("contaUnica"), destino=unica?id(2):id(3);
    return Response.json({referencia:{aplicativoId:id(2),vendedor:{id:window.testeManual.vendedorAtual,nome:`Vendedor vinculado · ID ${window.testeManual.vendedorAtual}`,cpfCnpj:null},cliente:{id:30,nome:"Cliente com nome comercial longo para validar leitura e seleção",cpfCnpj:"52998224725",uf:"MG"}},
      decisao:{tipo:unica?"CONTA_UNICA":"PADRAO",regraId:null,regraNome:null,versao:unica?0:1,aplicativoId:destino,motivo:unica?"Única conta disponível.":"Aplicativo padrão configurado pelo pai."},selecoes:{vendedorId:unica?window.testeManual.vendedorAtual:window.testeManual.vendedorAtual+100,clienteId:unica?30:130,vendedorFixo:true}});
  }
  if(query.has("pedidoId")) return Response.json({id:id(10),status:"PENDENTE",createdAt:new Date().toISOString(),aplicativo:{id:id(2),nome:"Conta própria"}});
  if(!query.has("aplicativoId")) {
    if(params.has("falhaInicial")&&!falhouInicial){falhouInicial=true;return Response.json({error:"Falha temporária ao carregar contas."},{status:502});}
    return Response.json({aplicativos:params.has("contaUnica")?[{id:id(2),nome:"Conta própria"}]:[{id:id(2),nome:"Conta própria"},{id:id(3),nome:"Filial com nome muito longo para verificar responsividade"}],aplicativoPadraoId:window.testeManual.referenciaAtual});
  }
  if(!query.has("recurso")) {
    if(window.testeManual.falharCarteira) return Response.json({error:"Usuário vendedor sem vínculo nesta empresa."},{status:403});
    return Response.json({conta:{id:query.get("aplicativoId"),nome:"Conta"},vendedorId:params.has("livre")?null:query.get("aplicativoId")===id(2)?window.testeManual.vendedorAtual:21,vendedorFixo:!params.has("livre")});
  }
  return Response.json({itens:query.get("recurso")==="clientes"?[{id:30,nome:"Cliente com nome comercial longo para validar leitura e seleção",referencia:"C30"}]:query.get("recurso")==="vendedores"?[{id:20,nome:"Vendedor",referencia:"V20"}]:[],pagina:1,mais:false});
};
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-6xl p-4"><CriarPedidoManual token="teste" usuarioId={id(1)} podeGerenciarFila={false} /></main>);
