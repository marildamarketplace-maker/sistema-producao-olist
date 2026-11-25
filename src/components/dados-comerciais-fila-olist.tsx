"use client";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { EstadoCatalogoTecidosOlist, PesquisaTecidoOlist } from "@/components/pesquisa-tecido-olist";
import type { CatalogoTecidosOlist } from "@/lib/catalogo-tecidos-olist";
import type { OpcaoFilaOlist, RascunhoFilaOlist } from "@/lib/fila-olist-contrato";
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50";
export function PesquisaOlist({ titulo, recurso, valor, api, token, aoSelecionar, disabled, carregarInicialmente = false }: {
  titulo: string; recurso: string; valor: number; api: string; token: string; aoSelecionar: (opcao: OpcaoFilaOlist) => void; disabled: boolean; carregarInicialmente?: boolean;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);
  const selecionada = useRef<OpcaoFilaOlist | null>(null);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoFilaOlist[]>([]);
  const [pagina, setPagina] = useState(1);
  const [mais, setMais] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const controller = useRef<AbortController | null>(null);
  const selecaoAtual = useRef({ valor, aoSelecionar });
  selecaoAtual.current = { valor, aoSelecionar };
  const pesquisar = useCallback(async (proxima = 1, termo = "") => {
    controller.current?.abort(); const atual = new AbortController(); controller.current = atual;
    setCarregando(true); setErro("");
    try {
      const response = await fetch(`${api}${api.includes("?") ? "&" : "?"}${new URLSearchParams({ recurso, busca: termo, pagina: String(proxima) })}`, { headers: { Authorization: `Bearer ${token}` }, signal: atual.signal });
      const dados = await response.json(); if (!response.ok) throw new Error(dados.error);
      if (!atual.signal.aborted) { setOpcoes(dados.itens); setPagina(proxima); setMais(dados.mais);
        if (proxima === 1 && dados.mais === false && dados.itens.length === 1 && selecaoAtual.current.valor !== dados.itens[0].id) selecaoAtual.current.aoSelecionar(dados.itens[0]);
      }
    } catch (e) { if (!atual.signal.aborted) setErro(e instanceof Error ? e.message : "Falha na pesquisa."); }
    finally { if (!atual.signal.aborted) setCarregando(false); }
  }, [api, token, recurso]);
  useEffect(() => {
    controller.current?.abort();
    setOpcoes([]); setPagina(1); setMais(false); setErro(""); setCarregando(false);
    if (carregarInicialmente && !disabled) void pesquisar(1, "");
    return () => controller.current?.abort();
  }, [pesquisar, carregarInicialmente, disabled]);
  const encontrada = opcoes.find(o => o.id === valor);
  if (encontrada) selecionada.current = encontrada;
  if (recurso === "formas" || recurso === "servicos") return <div className="relative min-w-0 space-y-2" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setAberto(false); }} onKeyDown={e => { if (e.key === "Escape") { gatilho.current?.focus(); setAberto(false); } }}>
    <label htmlFor={`${id}-gatilho`} className="block text-sm">{titulo}</label>
    <button id={`${id}-gatilho`} ref={gatilho} type="button" disabled={disabled} aria-expanded={aberto} aria-controls={`${id}-lista`} className="input flex min-h-11 w-full items-center justify-between gap-2 text-left" onClick={() => setAberto(v => !v)}>
      <span className="min-w-0 break-words">{valor ? selecionada.current?.id === valor ? selecionada.current.nome : `ID ${valor}` : `Selecione ${titulo.toLocaleLowerCase("pt-BR")}`}</span><ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0" />
    </button>
    {aberto && <div id={`${id}-lista`} className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 space-y-2 overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white p-3 shadow-lg">
      <label htmlFor={`${id}-filtro`} className="block text-xs text-slate-600">Pesquisar {titulo.toLocaleLowerCase("pt-BR")}</label>
      <div className="flex gap-2"><input autoFocus id={`${id}-filtro`} className="input min-h-11 min-w-0 flex-1" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => { if(e.key === "Enter") { e.preventDefault(); void pesquisar(1, busca); } }} /><button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar(1,busca)}>Buscar</button></div>
      {carregando ? <p role="status" className="text-xs">Carregando...</p> : opcoes.map(o => <button key={o.id} type="button" className="min-h-11 w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2" onClick={() => { selecionada.current = o; if(o.id !== valor) aoSelecionar(o); gatilho.current?.focus(); setAberto(false); }}>{o.nome}</button>)}
      {!carregando && !erro && !opcoes.length && <p role="status" className="text-xs">Nenhum resultado encontrado.</p>}
      {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
      {(pagina > 1 || mais) && <div className="flex flex-wrap gap-2">{pagina > 1 && <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar(pagina-1,busca)}>Anterior</button>}{mais && <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar(pagina+1,busca)}>Mais resultados</button>}</div>}
    </div>}
  </div>;
  return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md border border-slate-200 p-3">
    <legend className="max-w-full break-words px-1 text-sm font-medium">{titulo}</legend>
    <label htmlFor={`${id}-busca`} className="block text-xs text-slate-600">Pesquisar pelo nome na conta destinatária</label>
    <div className="flex flex-wrap gap-2"><input id={`${id}-busca`} className="input min-h-11 min-w-0 flex-1" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void pesquisar(1, busca); } }} />
      <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar(1, busca)}>Buscar</button></div>
    <label htmlFor={`${id}-resultado`} className="block text-xs text-slate-600">Cadastro selecionado</label>
    <select id={`${id}-resultado`} className="input min-h-11 max-w-full" value={valor || ""} disabled={carregando} onChange={(e) => { const opcao = opcoes.find((o) => o.id === Number(e.target.value)); if (opcao && opcao.id !== valor) aoSelecionar(opcao); else if (!e.target.value) aoSelecionar({ id: 0, nome: "" }); }}>
      <option value="">Selecione um resultado</option>
      {valor > 0 && !opcoes.some((o) => o.id === valor) && <option value={valor}>ID {valor} · seleção salva, sujeita à validação</option>}
      {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome} · ID {o.id}{o.referencia ? ` · ${o.referencia}` : ""}</option>)}
    </select>
    {carregando && <p role="status" className="text-xs">Consultando Olist...</p>}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {(pagina > 1 || mais) && <div className="flex flex-wrap gap-2">
      {pagina > 1 && <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar(pagina - 1, busca)}>Anterior</button>}
      {mais && <button type="button" className={botao} disabled={carregando} onClick={() => void pesquisar(pagina + 1, busca)}>Mais resultados</button>}
    </div>}
  </fieldset>;
}


function ProdutoCatalogoOlist({ titulo, catalogo, produtoId, preco, aoSelecionar, aoAlterarPreco, disabled }: {
  titulo: string; catalogo: CatalogoTecidosOlist; produtoId: number; preco: number | null; disabled: boolean;
  aoSelecionar: (produto: OpcaoFilaOlist) => void; aoAlterarPreco: (preco: number | null) => void;
}) {
  const [busca, setBusca] = useState("");
  return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-md border border-slate-200 p-3">
    <legend className="max-w-full break-words px-1 text-sm font-medium">{titulo}</legend>
    <PesquisaTecidoOlist nome={busca} catalogo={catalogo} produtoId={produtoId} preco={preco} disabled={disabled}
      aoEncontrar={produto => { setBusca(produto.nome); aoSelecionar(produto); }} aoAlterarPreco={aoAlterarPreco}
      aoLimparAssociacao={() => aoSelecionar({ id: 0, nome: "" })} rotuloPreco="Preço por metro (R$)">
      <label className="block min-w-0 text-sm">Filtrar produtos carregados<input className="input mt-1 min-h-11 w-full" value={busca} maxLength={500} onChange={event => setBusca(event.target.value)} /></label>
    </PesquisaTecidoOlist>
  </fieldset>;
}

export function DadosComerciaisFilaOlist({ api, token, itens, selecoes, aoAlterar, disabled, ocultarClienteVendedor = false, ocultarProdutos = false, vendedorFixo = false, catalogoTecidos }: {
  api: string; token: string; itens: Array<{ tecidoId: string; nome: string; corteLaser: boolean }>;
  selecoes: RascunhoFilaOlist; aoAlterar: (selecoes: RascunhoFilaOlist) => void; disabled: boolean; ocultarClienteVendedor?: boolean; ocultarProdutos?: boolean; vendedorFixo?: boolean;
  catalogoTecidos?: CatalogoTecidosOlist;
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
  const pesquisa = (titulo: string, recurso: string, valor: number, aoSelecionar: (o: OpcaoFilaOlist) => void) => <PesquisaOlist carregarInicialmente={recurso === "formas" || recurso === "servicos"} titulo={titulo} recurso={recurso} valor={valor} api={api} token={token} disabled={disabled} aoSelecionar={aoSelecionar} />;
  return <div className="space-y-4">
    {!ocultarProdutos && catalogoTecidos && <EstadoCatalogoTecidosOlist ocultarAtualizar catalogo={catalogoTecidos} disabled={disabled} />}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {carregando && <p role="status" className="text-sm text-slate-600">Carregando planos associados...</p>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {!ocultarClienteVendedor && pesquisa("Cliente", "clientes", selecoes.clienteId, (o) => aoAlterar({ ...selecoes, clienteId: o.id }))}
          {!ocultarClienteVendedor && (vendedorFixo ? <p className="text-sm">Vendedor do autor (fixo): <strong>{selecoes.vendedorId || "Vínculo pendente nesta conta"}</strong></p> : pesquisa("Vendedor", "vendedores", selecoes.vendedorId, (o) => aoAlterar({ ...selecoes, vendedorId: o.id, clienteId: 0 })))}
          {pesquisa("Forma de pagamento", "formas", selecoes.formaId, (o) => aoAlterar({ ...selecoes, formaId: o.id, planoId: "" }))}
          <label className="block text-sm">Plano de pagamento local<select className="input mt-2 min-h-11" value={selecoes.planoId} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, planoId: e.target.value })}><option value="">Selecione um plano associado</option>{planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
            {selecoes.formaId > 0 && planos.length === 0 && <span className="mt-2 block text-xs text-amber-700">Nenhum plano disponível. Confira a associação da forma nesta conta.</span>}</label>
          <label className="block text-sm">Tipo de venda<select className="input mt-2 min-h-11" value={selecoes.tipoVenda} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, tipoVenda: e.target.value as RascunhoFilaOlist["tipoVenda"] })}><option value="">Selecione</option><option value="VENDA">Venda</option><option value="VENDA_G">Venda G</option><option value="VENDA_PC">Venda PC</option></select></label>
        </div>
        {!ocultarProdutos && selecoes.tecidos.map((tecido, index) => {
          const titulo = `Produto para ${itens.find(item => item.tecidoId === tecido.tecidoId)?.nome}`;
          const selecionar = (produto: OpcaoFilaOlist) => aoAlterar({ ...selecoes, tecidos: selecoes.tecidos.map((atual, posicao) => posicao === index ? { ...atual, id: produto.id, preco: produto.id ? produto.preco ?? null : null } : atual) });
          const alterarPreco = (preco: number | null) => aoAlterar({ ...selecoes, tecidos: selecoes.tecidos.map((atual, posicao) => posicao === index ? { ...atual, preco } : atual) });
          return <div key={tecido.tecidoId} className="min-w-0 space-y-2">
            {catalogoTecidos ? <ProdutoCatalogoOlist titulo={titulo} catalogo={catalogoTecidos} produtoId={tecido.id} preco={tecido.preco} disabled={disabled} aoSelecionar={selecionar} aoAlterarPreco={alterarPreco} /> : <>
              {pesquisa(titulo, "produtos", tecido.id, selecionar)}
              <label className="block text-sm">Preço por metro (R$)<input className="input mt-1 min-h-11" type="number" min="0" max="1000000000" step="0.01" value={tecido.preco ?? ""} disabled={disabled} onChange={event => alterarPreco(event.target.value === "" ? null : Number(event.target.value))} /></label>
            </>}
          </div>;
        })}
        {laser && <div className="space-y-2">
          {pesquisa("Serviço de corte a laser", "servicos", selecoes.laser?.id ?? 0, (o) => aoAlterar({ ...selecoes, laser: { id: o.id, preco: o.id ? o.preco ?? null : null } }))}
          <label className="block text-sm">Preço do serviço por metro (R$)<input className="input mt-1 min-h-11" type="number" min="0" step="0.01" value={selecoes.laser?.preco ?? ""} disabled={disabled} onChange={(e) => aoAlterar({ ...selecoes, laser: { id: selecoes.laser?.id ?? 0, preco: e.target.value === "" ? null : Number(e.target.value) } })} /></label>
        </div>}
  </div>;
}
