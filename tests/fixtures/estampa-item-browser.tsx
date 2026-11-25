import {useState} from "react";
import {createRoot} from "react-dom/client";
import {EstampaItemPedido} from "../../src/components/estampa-item-pedido";
const variante=new URLSearchParams(location.search).has("variante");
window.fetch=async input=>{const url=new URL(String(input),location.href);return Response.json({itens:url.searchParams.get("busca")==="NOVA"?[]:[{codigo:variante?"A":"6841"}],mais:false});};
function App(){const [valor,setValor]=useState("");return <main className="p-4"><EstampaItemPedido codigoEstampa={variante ? "6841" : undefined} valor={valor} api="/teste" token="teste" disabled={false} aoAlterar={setValor}/><button type="button">Continuar</button><output>{valor}</output></main>;}
createRoot(document.getElementById("root")!).render(<App/>);
