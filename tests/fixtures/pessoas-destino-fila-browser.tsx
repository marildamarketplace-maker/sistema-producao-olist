import {createRoot} from "react-dom/client";
import {PessoasDestinoFila} from "../../src/components/pessoas-destino-fila";
declare global {interface Window {consultasPessoas:number}}
window.consultasPessoas=0;
window.fetch=async()=>{window.consultasPessoas++;return Response.json({aplicativo:{id:"filial",nome:"Conta de destino"},cliente:{id:130,nome:"Cliente no destino com nome longo",documento:"123",email:"cliente@example.test",telefone:"111"},vendedor:{id:120,nome:"Vendedor no destino",documento:null,email:"vendedor@example.test",telefone:"222"}});};
createRoot(document.getElementById("root")!).render(<main className="p-4"><PessoasDestinoFila pedidoId="pedido" token="teste"/></main>);
