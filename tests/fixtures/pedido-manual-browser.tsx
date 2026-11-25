import { createRoot } from "react-dom/client";
import { CriarPedidoManual } from "../../src/components/criar-pedido-manual";
import type { EntradaPedidoManual } from "../../src/lib/pedido-manual-contrato";
const id = (n:number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
declare global { interface Window { testeManual: { envios:EntradaPedidoManual[]; falhar:boolean; falharCarteira:boolean; vendedorAtual:number; consultas:string[] } } }
const params = new URLSearchParams(location.search);
if (!params.has("preservar")) sessionStorage.clear();
document.documentElement.classList.toggle("dark",params.get("tema")==="dark");
window.testeManual = {envios:[],falhar:false,falharCarteira:false,vendedorAtual:20,consultas:[]};
window.fetch = async (input,init) => {
  const url = new URL(typeof input === "string"?input:input instanceof URL?input.href:input.url,location.href);
  const query = url.searchParams;
  if (init?.method === "POST") {
    const body=JSON.parse(String(init.body)) as EntradaPedidoManual;
    window.testeManual.envios.push(body);
    if(window.testeManual.falhar) throw new Error("Conexão interrompida após envio");
    const vendedorEsperado=body.aplicativoId===id(2)?window.testeManual.vendedorAtual:21;
    if(body.selecoes.vendedorId!==vendedorEsperado) return Response.json({error:"Use o vendedor vinculado nesta conta."},{status:403});
    return Response.json({id:id(10),status:"PENDENTE",createdAt:new Date().toISOString(),aplicativo:{id:body.aplicativoId,nome:"Conta própria"}},{status:201});
  }
  window.testeManual.consultas.push(url.search);
  if(query.has("pedidoId")) return Response.json({id:id(10),status:"PENDENTE",createdAt:new Date().toISOString(),aplicativo:{id:id(2),nome:"Conta própria"}});
  if(!query.has("aplicativoId")) return Response.json({aplicativos:params.has("contaUnica")?[{id:id(2),nome:"Conta própria"}]:[{id:id(2),nome:"Conta própria"},{id:id(3),nome:"Filial com nome muito longo para verificar responsividade"}],aplicativoPadraoId:id(2),habilitado:true});
  if(!query.has("recurso")) {
    if(window.testeManual.falharCarteira) return Response.json({error:"Usuário vendedor sem vínculo nesta empresa."},{status:403});
    return Response.json({conta:{id:query.get("aplicativoId"),nome:"Conta"},vendedorId:query.get("aplicativoId")===id(2)?window.testeManual.vendedorAtual:21,vendedorFixo:true});
  }
  return Response.json({itens:query.get("recurso")==="clientes"?[{id:30,nome:"Cliente com nome comercial longo para validar leitura e seleção",referencia:"C30"}]:[],pagina:1,mais:false});
};
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-6xl p-4"><CriarPedidoManual token="teste" usuarioId={id(1)} podeGerenciarFila={false} /></main>);
