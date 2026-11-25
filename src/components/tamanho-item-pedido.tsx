"use client";

import { useEffect, useId, useState } from "react";
import type { ItemPedidoManual } from "@/lib/pedido-manual-contrato";
import type { TamanhoPedido } from "@/lib/itens-pedido-producao";
import { z } from "zod";

const respostaSchema = z.object({ itens: z.array(z.object({ id: z.guid(), titulo: z.string(), sku: z.string(), consumo: z.number().nullable() })), mais: z.boolean() });
export type CacheTamanhosPedido = Map<string, Promise<z.infer<typeof respostaSchema>>>;
const botao = "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500";

export function TamanhoItemPedido({ item, api, token, cache, aoDigitar, aoSelecionar }: {
  item: ItemPedidoManual; api?: string; token?: string; cache: CacheTamanhosPedido;
  aoDigitar: (valor: string) => void; aoSelecionar: (tamanho: TamanhoPedido, manter: boolean) => void;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [resultado, setResultado] = useState<z.infer<typeof respostaSchema>>({ itens: [], mais: false });
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [repetir, setRepetir] = useState(0);
  const [pendente, setPendente] = useState<TamanhoPedido | null>(null);
  useEffect(() => {
    if (!aberto || !api || !token) return;
    let ativo = true;
    setCarregando(true); setErro(""); setResultado({ itens: [], mais: false });
    const timer = setTimeout(() => {
      const url = new URL(api, location.href);
      url.searchParams.set("acao", "tamanhos"); url.searchParams.delete("recurso");
      url.searchParams.set("busca", busca); url.searchParams.set("pagina", String(pagina));
      const chave = url.toString();
      let consulta = cache.get(chave);
      if (!consulta) {
        consulta = fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) })
          .then(async r => { if (!r.ok) throw new Error("Não foi possível consultar tamanhos."); return respostaSchema.parse(await r.json()); });
        if (cache.size >= 20) cache.clear();
        cache.set(chave, consulta);
        void consulta.catch(() => { cache.delete(chave); });
      }
      void consulta.then(d => { if (ativo) setResultado(d); })
        .catch(() => { if (ativo) setErro("Falha ao carregar tamanhos. Você pode informar o tamanho e ajustar os metros manualmente."); })
        .finally(() => { if (ativo) setCarregando(false); });
    }, 250);
    return () => { ativo = false; clearTimeout(timer); };
  }, [aberto, api, token, busca, pagina, cache, repetir]);
  function escolher(tamanho: TamanhoPedido) {
    setAberto(false);
    if (item.modoMetragem === "MANUAL" && item.tamanho && tamanho.id !== item.tamanhoId && tamanho.consumo && tamanho.consumo > 0) setPendente(tamanho);
    else aoSelecionar(tamanho, false);
  }
  return <div className="min-w-0 space-y-2" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setAberto(false); }}>
    <label className="block text-sm" htmlFor={id}>Tamanho</label>
    <input id={id} className="input min-h-11" maxLength={100} value={item.tamanho}
      onFocus={() => { setBusca(""); setPagina(1); setAberto(true); }}
      onKeyDown={e => { if (e.key === "Escape") setAberto(false); if (e.key === "ArrowDown") { e.preventDefault(); document.getElementById(`${id}-opcoes`)?.querySelector<HTMLButtonElement>("button")?.focus(); } }}
      onChange={e => { aoDigitar(e.target.value); setPendente(null); setBusca(e.target.value); setPagina(1); setAberto(true); }} />
    {api && <button type="button" className={botao} aria-expanded={aberto} aria-controls={`${id}-opcoes`} onClick={() => { setBusca(""); setPagina(1); setAberto(v => !v); }}>Selecionar tamanho</button>}
    {aberto && api && <div id={`${id}-opcoes`} className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-2" onKeyDown={e => { if (e.key === "Escape") { setAberto(false); document.getElementById(id)?.focus(); } }}>
      {carregando ? <p role="status" className="p-2 text-xs">Consultando tamanhos…</p> : erro ? <><p role="alert" className="text-xs text-red-700">{erro}</p><button type="button" className={botao} onClick={() => setRepetir(r => r + 1)}>Tentar novamente</button></> : <>
        {resultado.itens.map(t => <button key={t.id} type="button" className="min-h-11 w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2" onClick={() => escolher(t)}>
          <span className="block break-words font-medium">{t.titulo} · {t.sku}</span><span className="text-xs text-slate-500">{t.consumo && t.consumo > 0 ? `${t.consumo.toLocaleString("pt-BR")} m por unidade` : "Sem consumo cadastrado"}</span>
        </button>)}
        {!resultado.itens.length && <p className="p-2 text-xs">Nenhum tamanho encontrado. Informe o tamanho e a metragem manualmente.</p>}
        <div className="flex flex-wrap gap-2">{pagina > 1 && <button className={botao} type="button" onClick={() => setPagina(p => p - 1)}>Anteriores</button>}{resultado.mais && <button className={botao} type="button" onClick={() => setPagina(p => p + 1)}>Próximos tamanhos</button>}</div>
      </>}
    </div>}
    {pendente && <div role="status" className="space-y-2 rounded-md border border-amber-300 p-2 text-xs"><p>O item possui metragem manual. Como aplicar {pendente.titulo}?</p><div className="flex flex-wrap gap-2">
      <button className={botao} type="button" onClick={() => { aoSelecionar(pendente, false); setPendente(null); }}>Recalcular metros</button>
      <button className={botao} type="button" onClick={() => { aoSelecionar(pendente, true); setPendente(null); }}>Manter ajuste</button>
      <button className={botao} type="button" onClick={() => setPendente(null)}>Cancelar</button>
    </div></div>}
  </div>;
}
