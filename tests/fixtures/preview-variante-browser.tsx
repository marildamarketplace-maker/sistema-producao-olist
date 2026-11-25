import {useState} from "react";
import {createRoot} from "react-dom/client";
import {PreviewVariantePedido} from "../../src/components/preview-variante-pedido";
window.fetch=async input=>Response.json({previewUrl:new URL(String(input),location.href).searchParams.get("variante")==="B"?"https://example.com/preview.webp":null});
function App(){const [v,setV]=useState("B");return <main className="flex gap-2 p-4"><label>Variante<input className="input" value={v} onChange={e=>setV(e.target.value)}/></label><PreviewVariantePedido key={v} codigo="6841" variante={v} api="/teste" token="teste"/><label>Tamanho<input className="input"/></label></main>;}
createRoot(document.getElementById("root")!).render(<App/>);
