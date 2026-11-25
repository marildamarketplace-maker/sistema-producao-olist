"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { OpcaoFilaOlist } from "@/lib/fila-olist-contrato";
import type { CatalogoTecidosOlist } from "@/lib/catalogo-tecidos-olist";

const botao = "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-50";
const tamanhoPagina = 20;
const normalizar = (valor: string) => valor.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

/** O carregamento pertence ao pedido; todas as linhas usam a mesma lista. */
export function EstadoCatalogoTecidosOlist({ catalogo, disabled, ocultarAtualizar = false }: { catalogo: CatalogoTecidosOlist; disabled: boolean; ocultarAtualizar?: boolean }) {
  return <section aria-label="Produtos com referência" className="space-y-2 rounded-md border border-slate-200 p-3">
    <p role="status" className="text-sm text-slate-600">{catalogo.carregando
      ? `Carregando todos os produtos com referência... ${catalogo.itens.length} disponíveis.`
      : catalogo.completo ? `${catalogo.itens.length} produtos disponíveis. Lista completa.`
      : `${catalogo.itens.length} produtos disponíveis. A lista ainda não foi carregada por completo.`}</p>
    {catalogo.erro && <p role="alert" className="break-words text-sm text-red-700">{catalogo.erro}</p>}
    <div className="flex flex-wrap gap-2">
      {!ocultarAtualizar && <button type="button" className={botao} disabled={disabled || catalogo.carregando} onClick={catalogo.atualizar}>Atualizar produtos</button>}
      {catalogo.carregando && <button type="button" className={botao} disabled={disabled} onClick={catalogo.cancelar}>Cancelar carregamento</button>}
      {!catalogo.completo && !catalogo.carregando && <button type="button" className={botao} disabled={disabled} onClick={catalogo.carregarMais}>{catalogo.erro ? "Tentar novamente" : "Carregar mais produtos"}</button>}
    </div>
  </section>;
}

/** Filtro e paginação locais: escolher um tecido não consulta novamente a Olist. */
export function PesquisaTecidoOlist({ nome, catalogo, disabled, children, produtoId, preco, aoEncontrar, aoAlterarPreco, rotuloPreco = "Preço do tecido por metro (R$)" }: {
  nome: string; catalogo: CatalogoTecidosOlist; disabled: boolean; children: ReactNode; produtoId: number; preco: number | null;
  aoEncontrar: (produto: OpcaoFilaOlist) => void; aoAlterarPreco: (preco: number | null) => void; aoLimparAssociacao: () => void; rotuloPreco?: string;
}) {
  const id = useId();
  const botaoRef = useRef<HTMLButtonElement>(null);
  const resultadosRef = useRef<HTMLElement>(null);
  const [aberto, setAberto] = useState(false);
  const [navegacao, setNavegacao] = useState({ nome, pagina: 1 });
  const selecionado = useMemo(() => catalogo.itens.find(produto => produto.id === produtoId), [catalogo.itens, produtoId]);
  const filtrados = useMemo(() => {
    if (!aberto) return [];
    const termos = normalizar(nome).split(" ").filter(Boolean);
    return catalogo.itens.filter(produto => {
      const texto = normalizar(`${produto.nome} ${produto.referencia ?? ""}`);
      return termos.every(termo => texto.includes(termo));
    });
  }, [aberto, nome, catalogo.itens]);
  const aoEncontrarAtual = useRef(aoEncontrar);
  aoEncontrarAtual.current = aoEncontrar;
  useEffect(() => {
    if (!disabled && aberto && catalogo.completo && !catalogo.carregando && !catalogo.erro && filtrados.length === 1 && filtrados[0].id !== produtoId) {
      aoEncontrarAtual.current(filtrados[0]);
      setAberto(false);
    }
  }, [disabled, aberto, catalogo.completo, catalogo.carregando, catalogo.erro, filtrados, produtoId]);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / tamanhoPagina));
  const pagina = Math.min(navegacao.nome === nome ? navegacao.pagina : 1, totalPaginas);
  const opcoes = filtrados.slice((pagina - 1) * tamanhoPagina, pagina * tamanhoPagina);

  function fechar() { setAberto(false); botaoRef.current?.focus(); }
  function navegar(proxima: number) {
    setNavegacao({ nome, pagina: proxima });
    // A página muda na mesma lista local. O recipiente permanece focado.
    resultadosRef.current?.focus();
  }

  return <div className="relative min-w-0 space-y-2" onFocusCapture={event => {
    if (!disabled && event.target instanceof HTMLInputElement && event.target.type !== "number") setAberto(true);
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAberto(false); }}
    onKeyDown={event => { if (event.key === "Escape" && aberto) { event.preventDefault(); event.stopPropagation(); fechar(); } }}>
    <div className="flex items-end gap-2" aria-describedby={`${id}-estado`}>
      <div className="min-w-0 flex-1">{children}</div>
      <button ref={botaoRef} type="button" disabled={disabled} onClick={() => setAberto(atual => !atual)}
        aria-label="Selecionar tecido" aria-expanded={aberto} aria-controls={`${id}-resultados`} title="Selecionar entre os produtos carregados"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
        <ChevronDown aria-hidden="true" size={20} />
      </button>
    </div>
    <p id={`${id}-estado`} role="status" className="text-xs text-slate-600">
      {selecionado ? "Produto selecionado na conta Olist." : "Filtre pelo nome ou referência e selecione um produto da lista."}
    </p>
    {aberto && <section ref={resultadosRef} id={`${id}-resultados`} tabIndex={-1} aria-label={`Produtos encontrados para ${nome || "seleção"}`} className="absolute left-0 right-0 z-50 max-h-96 min-w-0 space-y-2 overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white p-3 shadow-lg focus-visible:outline focus-visible:outline-2">
      <p className="text-xs text-slate-600">{filtrados.length} resultados na lista carregada{!catalogo.completo ? " · Carregamento incompleto" : ""}</p>
      {opcoes.length > 0 ? <ul className="max-h-72 space-y-2 overflow-y-auto">
        {opcoes.map(opcao => <li key={opcao.id}>
          <button type="button" className={`${botao} w-full break-words text-left`} aria-label={`Selecionar ${opcao.nome}`} aria-pressed={produtoId === opcao.id}
            disabled={disabled} onClick={() => { if (!disabled) { aoEncontrar(opcao); fechar(); } }}>
            <span className="block break-words font-medium">{opcao.nome}</span>
            <span className="mt-1 block break-words text-xs text-slate-600">{opcao.referencia ? `Referência: ${opcao.referencia} · ` : ""}ID {opcao.id} · {opcao.preco == null ? "Preço não informado" : `${opcao.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/m`}</span>
          </button>
        </li>)}
      </ul> : <p role="status" className="text-sm text-slate-600">{catalogo.carregando ? "Carregando opções de tecido..." : catalogo.completo ? "Nenhum produto corresponde ao filtro." : "Nenhum produto corresponde ao filtro na lista já carregada."}</p>}
      {totalPaginas > 1 && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={botao} disabled={disabled || pagina === 1} onClick={() => navegar(pagina - 1)}>Anterior</button>
        <span className="text-xs text-slate-600">Página {pagina} de {totalPaginas}</span>
        <button type="button" className={botao} disabled={disabled || pagina === totalPaginas} onClick={() => navegar(pagina + 1)}>Mais resultados</button>
      </div>}
      <button type="button" className={botao} onClick={fechar}>Fechar opções</button>
    </section>}
    {produtoId > 0 && <label className="block text-sm">{rotuloPreco}
      <input type="number" min="0" max="1000000000" step="0.01" disabled={disabled}
        value={preco ?? ""} onChange={event => aoAlterarPreco(event.target.value === "" ? null : Number(event.target.value))}
        className="input mt-1 min-h-11" />
      <span className="mt-1 block text-xs text-slate-600">Preço aplicado apenas a este pedido.</span>
    </label>}
  </div>;
}
