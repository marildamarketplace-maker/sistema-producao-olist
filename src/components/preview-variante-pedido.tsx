"use client";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
const resposta = z.object({ previewUrl: z.string().nullable() });
export function PreviewVariantePedido({ codigo, variante, api, token }: { codigo: string; variante: string; api?: string; token?: string }) {
 const [url,setUrl]=useState<string|null>(null),[modal,setModal]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),fechar=useRef<HTMLButtonElement>(null);
 const id=useId();
 useEffect(()=>{
  if(!api||!token||!codigo.trim()||!variante.trim())return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   const endpoint=new URL(api,location.href);endpoint.searchParams.set("acao","estampas");endpoint.searchParams.set("campo","preview");endpoint.searchParams.set("codigo",codigo);endpoint.searchParams.set("variante",variante);
   void fetch(endpoint,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error();return resposta.parse(await r.json());}).then(d=>{if(controller.signal.aborted)return;const imagem=d.previewUrl?new URL(d.previewUrl):null;setUrl(imagem&&["https:","http:"].includes(imagem.protocol)?imagem.href:null);}).catch(()=>{if(!controller.signal.aborted)setUrl(null);});
  },300);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[api,token,codigo,variante]);
 useEffect(()=>{
  if(!modal)return;
  const elemento=dialog.current,anterior=document.activeElement;
  elemento?.showModal();fechar.current?.focus();
  return ()=>{elemento?.close();if(anterior instanceof HTMLElement)anterior.focus();};
 },[modal]);
 if(!url)return null;
 return <>
  <button type="button" className="mt-7 h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-300 bg-white focus-visible:outline focus-visible:outline-2" aria-label={`Ampliar estampa ${codigo}, variante ${variante}`} onClick={()=>setModal(true)}><Image src={url} alt={`Estampa ${codigo}, variante ${variante}`} width={64} height={64} unoptimized className="h-full w-full object-contain" onError={()=>setUrl(null)}/></button>
  {modal&&<dialog ref={dialog} aria-labelledby={id} onCancel={()=>setModal(false)} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-slate-900 backdrop:bg-black/50">
   <div className="mb-3 flex items-center justify-between gap-3"><h2 id={id} className="text-sm font-semibold">Estampa {codigo} · Variante {variante}</h2><button ref={fechar} type="button" className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm" onClick={()=>setModal(false)}>Fechar</button></div>
   <Image src={url} alt={`Estampa ${codigo}, variante ${variante}`} width={1200} height={1200} unoptimized className="max-h-[70dvh] w-full object-contain"/>
  </dialog>}
 </>;
}
