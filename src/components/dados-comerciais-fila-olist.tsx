"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { OpcaoFilaOlist, RascunhoFilaOlist } from "@/lib/fila-olist-contrato";
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50";
export function PesquisaOlist({ titulo, recurso, valor, api, token, aoSelecionar, disabled }: {
  titulo: string; recurso: string; valor: number; api: string; token: string; aoSelecionar: (opcao: OpcaoFilaOlist) => void; disabled: boolean;
}) {
  const id = useId();
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoFilaOlist[]>([]);
  const [pagina, setPagina] = useState(1);
  const [mais, setMais] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function pesquisar(proxima = 1) {
    controller.current?.abort(); const atual = new AbortController(); controller.current = atual;
    setCarregando(true); setErro("");
    try {
      const response = await fetch(`${api}${api.includes("?") ? "&" : "?"}${new URLSearchParams({ recurso, busca, pagina: String(proxima) })}`, { headers: { Authorization: `Bearer ${token}` }, signal: atual.signal });
      const dados = await response.json(); if (!response.ok) throw new Error(dados.error);
      if (!atual.signal.aborted) { setOpcoes(dados.itens); setPagina(proxima); setMais(dados.mais); }
    } catch (e) { if (!atual.signal.aborted) setErro(e instanceof Error ? e.message : "Falha na pesquisa."); }
    finally { if (!atual.signal.aborted) setCarregando(false); }
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md border border-slate-200 p-3">
    <legend className="max-w-full break-words px-1 text-sm font-medium">{titulo}</legend>
    <label htmlFor={`${id}-busca`} className="block text-xs text-slate-600">Pesquisar pelo nome na filial</label>
    <div className="flex flex-wrap gap-2"><input id={`${id}-busca`} className="input min-h-11 min-w-0 flex-1" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void pesquisar(); } }} />
      <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar()}>Buscar</button></div>
    <label htmlFor={`${id}-resultado`} className="block text-xs text-slate-600">Cadastro selecionado</label>
    <select id={`${id}-resultado`} className="input min-h-11 max-w-full" value={valor || ""} disabled={carregando} onChange={(e) => { const opcao = opcoes.find((o) => o.id === Number(e.target.value)); if (opcao) aoSelecionar(opcao); else if (!e.target.value) aoSelecionar({ id: 0, nome: "" }); }}>
      <option value="">Selecione um resultado</option>
      {valor > 0 && !opcoes.some((o) => o.id === valor) && <option value={valor}>ID {valor} · seleção salva, sujeita à validação</option>}
      {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome} · ID {o.id}{o.referencia ? ` · ${o.referencia}` : ""}</option>)}
    </select>
    {carregando && <p role="status" className="text-xs">Consultando Olist...</p>}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={botao} disabled={carregando || pagina === 1} onClick={() => void pesquisar(pagina - 1)}>Anterior</button>
      <button type="button" className={botao} disabled={carregando || !mais} onClick={() => void pesquisar(pagina + 1)}>Mais resultados</button></div>
  </fieldset>;
}


export function DadosComerciaisFilaOlist({ api, token, itens, selecoes, aoAlterar, disabled }: {
  api: string; token: string; itens: Array<{ tecidoId: string; nome: string; corteLaser: boolean }>;
  selecoes: RascunhoFilaOlist; aoAlterar: (selecoes: RascunhoFilaOlist) => void; disabled: boolean;
}) {
  const [planos, setPlanos] = useState<{ id: string; nome: string }[]>([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const laser = itens.some((i) => i.corteLaser);
  useEffect(() => {
    const controller = new AbortController(); setPlanos([]); setErro("");
    if (!selecoes.formaId) { setCarregando(false); return; }
    setCarregando(true);
    fetch(`${api}${api.includes("?") ? "&" : "?"}recurso=planos&formaId=${selecoes.formaId}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const dados = await r.json(); if (!r.ok) throw new Error(dados.error); return dados; })
      .then((dados) => { if (!controller.signal.aborted) setPlanos(dados.itens); })
      .catch((e) => { if (!controller.signal.aborted) setErro(e.message); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [api, token, selecoes.formaId]);
  const pesquisa = (titulo: string, recurso: string, valor: number, aoSelecionar: (o: OpcaoFilaOlist) => void) => <PesquisaOlist titulo={titulo} recurso={recurso} valor={valor} api={api} token={token} disabled={disabled} aoSelecionar={aoSelecionar} />;
  return <div className="space-y-4">
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {carregando && <p role="status" className="text-sm text-slate-600">Carregando planos associados...</p>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {pesquisa("Cliente", "clientes", selecoes.clienteId, (o) => aoAlterar({ ...selecoes, clienteId: o.id }))}
          {pesquisa("Vendedor", "vendedores", selecoes.vendedorId, (o) => aoAlterar({ ...selecoes, vendedorId: o.id }))}
          {pesquisa("Forma de pagamento", "formas", selecoes.formaId, (o) => aoAlterar({ ...selecoes, formaId: o.id, planoId: "" }))}
          <label className="block text-sm">Plano de pagamento local<select className="input mt-2 min-h-11" value={selecoes.planoId} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, planoId: e.target.value })}><option value="">Selecione um plano associado</option>{planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
            {selecoes.formaId > 0 && planos.length === 0 && <span className="mt-2 block text-xs text-amber-700">Nenhum plano disponível. Confira a associação da forma nesta filial.</span>}</label>
          <label className="block text-sm">Tipo de venda<select className="input mt-2 min-h-11" value={selecoes.tipoVenda} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, tipoVenda: e.target.value as RascunhoFilaOlist["tipoVenda"] })}><option value="">Selecione</option><option value="VENDA">Venda</option><option value="VENDA_G">Venda G</option><option value="VENDA_PC">Venda PC</option></select></label>
        </div>
        {selecoes.tecidos.map((tecido, index) => <div key={tecido.tecidoId} className="space-y-2">
          {pesquisa(`Produto para ${itens.find((i) => i.tecidoId === tecido.tecidoId)?.nome}`, "produtos", tecido.id, (o) => aoAlterar({ ...selecoes, tecidos: selecoes.tecidos.map((t, i) => i === index ? { ...t, id: o.id, preco: o.id ? o.preco ?? null : null } : t) }))}
          <label className="block text-sm">Preço por metro (R$)<input className="input mt-1 min-h-11" type="number" min="0" max="1000000000" step="0.01" value={tecido.preco ?? ""} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, tecidos: selecoes.tecidos.map((t, i) => i === index ? { ...t, preco: e.target.value === "" ? null : Number(e.target.value) } : t) })} /></label>
        </div>)}
        {laser && <div className="space-y-2">
          {pesquisa("Serviço de corte a laser", "servicos", selecoes.laser?.id ?? 0, (o) => aoAlterar({ ...selecoes, laser: { id: o.id, preco: o.id ? o.preco ?? null : null } }))}
          <label className="block text-sm">Preço do serviço por metro (R$)<input className="input mt-1 min-h-11" type="number" min="0" step="0.01" value={selecoes.laser?.preco ?? ""} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, laser: { id: selecoes.laser?.id ?? 0, preco: e.target.value === "" ? null : Number(e.target.value) } })} /></label>
        </div>}
  </div>;
}
