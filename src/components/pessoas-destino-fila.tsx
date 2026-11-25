"use client";
import {useEffect,useState} from "react";
import type {PessoaDestinoFila} from "@/lib/fila-pessoas-destino";
type Dados={aplicativo:{id:string;nome:string};cliente:PessoaDestinoFila;vendedor:PessoaDestinoFila|null};
export function PessoasDestinoFila({pedidoId,token}:{pedidoId:string;token:string}){
 const [aberto,setAberto]=useState(false),[dados,setDados]=useState<Dados|null>(null),[erro,setErro]=useState(""),[tentativa,setTentativa]=useState(0);
 useEffect(()=>{
  if(!aberto||dados)return;const c=new AbortController();setErro("");
  void fetch(`/api/fornecedores/fila/administracao?${new URLSearchParams({acao:"pessoas",pedidoId})}`,{headers:{Authorization:`Bearer ${token}`},signal:c.signal,cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Não foi possível consultar os cadastros.");return d as Dados;}).then(d=>{if(!c.signal.aborted)setDados(d);}).catch(e=>{if(!c.signal.aborted)setErro(e instanceof Error?e.message:"Falha na consulta.");});
  return ()=>c.abort();
 },[aberto,pedidoId,token,tentativa,dados]);
 return <details className="rounded-md border border-slate-200" onToggle={e=>setAberto(e.currentTarget.open)}><summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2">Cliente e vendedor no destino</summary><div className="space-y-3 border-t border-slate-200 p-3 text-sm">
 {erro?<div role="alert"><p>{erro}</p><button type="button" className="mt-2 min-h-11 rounded-md border border-slate-300 px-3" onClick={()=>setTentativa(v=>v+1)}>Tentar novamente</button></div>:!dados?<p role="status">Consultando cadastros no aplicativo destinatário...</p>:<><p className="break-words text-xs text-slate-500">Aplicativo: {dados.aplicativo.nome}</p><div className="grid gap-4 sm:grid-cols-2">{([['Cliente',dados.cliente],['Vendedor',dados.vendedor]] as const).map(([titulo,pessoa])=><section key={titulo} className="min-w-0 space-y-2 rounded-md bg-slate-50 p-3"><h4 className="font-semibold">{titulo}</h4>{pessoa?<dl className="space-y-2">{[['Nome',pessoa.nome],['ID Olist',pessoa.id],['CPF/CNPJ',pessoa.documento],['E-mail',pessoa.email],['Telefone',pessoa.telefone]].map(([label,valor])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words">{valor||'Não informado'}</dd></div>)}</dl>:<p>Não foi possível localizar o vendedor nesta conta.</p>}</section>)}</div></>}
 </div></details>;
}
