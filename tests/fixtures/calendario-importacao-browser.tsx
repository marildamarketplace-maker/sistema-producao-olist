import { createRoot } from "react-dom/client";
import Pagina from "../../src/app/controle-midia/calendario/importar/page";
import { entradaImportacaoSchema, prepararImportacao } from "../../src/lib/calendario-comercial/importacao";
const auth={session:{access_token:"token",user:{id:"auth"}},usuario:{id:"usuario",aplicativo_id:"app",podeVisualizarTarefasMidia:true}};
export function useAuth(){return auth;}
const salvos=new Set<string>();let chamadas=0,falhou=false;
export async function validarImportacaoCalendario(_token:string,entrada:unknown){
  const dados=entradaImportacaoSchema.parse(entrada);
  return {ok:true,previa:await prepararImportacao(dados,{
    produtos:async skus=>skus.filter(s=>s.startsWith("SKU-")).map(s=>({id:s,sku:s,ativo:true})),
    existentes:async pares=>pares.filter(p=>salvos.has(`${p.produtoId}:${p.eventoId}`)),
  })};
}
export async function importarLoteCalendario(_token:string,lote:{eventoId:string;skus:string[]}){
  chamadas++;
  for(const sku of lote.skus)salvos.add(`${sku}:${lote.eventoId}`);
  // Simula confirmação perdida após o commit: retomar deve ser idempotente.
  if(chamadas===2&&!falhou){falhou=true;return {ok:false,erro:"Falha simulada. Retome para continuar."};}
  return {ok:true,processados:lote.skus.length};
}
declare global {interface Window {importacaoTeste:{total:()=>number;chamadas:()=>number}}}
window.importacaoTeste={total:()=>salvos.size,chamadas:()=>chamadas};
const root=document.getElementById("root");if(root)createRoot(root).render(<Pagina/>);
