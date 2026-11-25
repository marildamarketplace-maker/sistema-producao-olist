"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { z } from "zod";
const resposta = z.object({ itens: z.array(z.object({ codigo: z.string() })), mais: z.boolean() });
export function EstampaItemPedido({ valor, api, token, disabled, aoAlterar, codigoEstampa, erro: erroCampo }: { erro?: string; valor: string; codigoEstampa?: string; api?: string; token?: string; disabled: boolean; aoAlterar: (codigo: string) => void }) {
 const variante = codigoEstampa !== undefined;
 const titulo = variante ? "Variante" : "Estampa";
 const id=useId(); const seta=useRef<HTMLButtonElement>(null);
 const [aberto,setAberto]=useState(false),[pagina,setPagina]=useState(1),[erro,setErro]=useState(false),[carregando,setCarregando]=useState(false);
 const cache = useRef(new Map<string, { ate: number; dados: z.infer<typeof resposta> }>());
 const [dados,setDados]=useState<z.infer<typeof resposta>>({itens:[],mais:false});
 useEffect(()=>{
  if(!aberto||!api||!token||disabled)return;
  if(variante && !codigoEstampa?.trim()){setDados({itens:[],mais:false});setCarregando(false);return;}
  const chave=JSON.stringify([api,token,codigoEstampa,valor.trim().toLocaleLowerCase("pt-BR"),pagina]);
  const anterior=cache.current.get(chave);
  if(anterior && anterior.ate>Date.now()){setDados(anterior.dados);setCarregando(false);setErro(false);return;}
  const controller=new AbortController();setCarregando(true);setErro(false);
  const timer=setTimeout(()=>{
   const url=new URL(api,location.href);url.searchParams.set("acao","estampas");url.searchParams.set("busca",valor);url.searchParams.set("pagina",String(pagina));
   if(variante){url.searchParams.set("campo","variante");url.searchParams.set("codigo",codigoEstampa ?? "");}
   void fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error();return resposta.parse(await r.json());}).then(d=>{if(!controller.signal.aborted){if(cache.current.size>=30)cache.current.clear();cache.current.set(chave,{ate:Date.now()+60000,dados:d});setDados(d);}}).catch(()=>{if(!controller.signal.aborted)setErro(true);}).finally(()=>{if(!controller.signal.aborted)setCarregando(false);});
  },150);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[aberto,api,token,valor,pagina,disabled,codigoEstampa,variante]);
 return <div className="relative min-w-0 self-start space-y-2" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setAberto(false);}} onKeyDown={e=>{if(e.key==="Escape"){setAberto(false);seta.current?.focus();}}}>
  <label htmlFor={id} className="block text-sm">{titulo}</label>
  <div className="flex gap-2"><input aria-invalid={Boolean(erroCampo)} aria-describedby={erroCampo ? `${id}-erro` : undefined} id={id} className="input aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-200 min-h-11 min-w-0 flex-1" maxLength={100} value={valor} disabled={disabled} onFocus={()=>setAberto(true)} onClick={()=>setAberto(true)} onChange={e=>{aoAlterar(e.target.value);setPagina(1);setAberto(true);}}/><button ref={seta} type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 focus-visible:outline focus-visible:outline-2" disabled={disabled} aria-label={`Selecionar ${titulo.toLocaleLowerCase("pt-BR")}`} aria-expanded={aberto} aria-controls={`${id}-lista`} onClick={()=>setAberto(v=>!v)}><ChevronDown className="h-5 w-5" aria-hidden="true"/></button></div>
  {erroCampo && <p id={`${id}-erro`} role="alert" className="text-xs text-red-700">{erroCampo}</p>}
  {aberto&&api&&<div id={`${id}-lista`} className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 space-y-2 overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white p-3 shadow-lg">
   {carregando?<p role="status" className="text-xs">Buscando opções...</p>:erro?<p role="alert" className="text-xs">Não foi possível consultar. Você pode manter o código digitado.</p>:<>{dados.itens.map((e,index)=><button key={`${e.codigo}-${index}`} type="button" className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2" onClick={()=>{aoAlterar(e.codigo);setAberto(false);seta.current?.focus();}}>{e.codigo}</button>)}{!dados.itens.length&&<p role="status" className="text-xs">Nenhuma opção encontrada. O valor digitado será mantido.</p>}<div className="flex flex-wrap gap-2">{pagina>1&&<button type="button" className="min-h-11 px-3" onClick={()=>setPagina(p=>p-1)}>Anterior</button>}{dados.mais&&<button type="button" className="min-h-11 px-3" onClick={()=>setPagina(p=>p+1)}>Mais resultados</button>}</div></>}
  </div>}
 </div>;
}
