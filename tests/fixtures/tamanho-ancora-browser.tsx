import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TamanhoItemPedido, type CacheTamanhosPedido } from "../../src/components/tamanho-item-pedido";
import type { ItemPedidoManual } from "../../src/lib/pedido-manual-contrato";
const cache: CacheTamanhosPedido = new Map();
window.fetch = async () => Response.json({itens:[{id:"00000000-0000-0000-0000-000000000001",titulo:"70x70",sku:"70",consumo:0.35}],mais:false});
function App(){ const [item,setItem]=useState<ItemPedidoManual>({id:"a",tecidoNome:"Oxford",quantidade:1,quantidadeTecido:0.35,estampa:"1",variante:"A",tamanho:"",tipoProduto:"Lenço",corteLaser:false});return <div className="grid grid-cols-2 gap-4 p-4"><TamanhoItemPedido item={item} api="/teste" token="teste" cache={cache} aoDigitar={tamanho=>setItem({...item,tamanho})} aoSelecionar={()=>{}}/><div style={{height:400}}>Coluna alta com mensagens de validação</div></div>;}
createRoot(document.getElementById("root")!).render(<App/>);
