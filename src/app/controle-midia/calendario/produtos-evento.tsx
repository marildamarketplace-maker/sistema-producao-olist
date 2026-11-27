"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { buscarProdutosCalendario, contarProdutosCalendario, salvarProdutosCalendario } from "./actions";
import { useModalFocus } from "@/hooks/use-modal-focus";
import type { ProdutoEvento } from "@/lib/calendario-comercial/produtos";

const botao = "min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
type EventoSelecionado = { id: string; nome: string };
const Contexto = createContext<{
  contagens: Record<string, number>; abrir: (evento: EventoSelecionado) => void;
} | null>(null);

export function BotaoProdutosEvento({ evento }: { evento: EventoSelecionado }) {
  const contexto = useContext(Contexto);
  if (!contexto) return null;
  const total = contexto.contagens[evento.id];
  return <button type="button" aria-haspopup="dialog" onClick={() => contexto.abrir(evento)}
    className={`${botao} mt-3 text-slate-900 hover:bg-slate-50`}>
    Associar produtos{total !== undefined ? ` (${total})` : ""}<span className="sr-only"> a {evento.nome}</span>
  </button>;
}

export function ProdutosEventosProvider({ token, eventos, children }: {
  token: string; eventos: string[]; children: ReactNode;
}) {
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [evento, setEvento] = useState<EventoSelecionado | null>(null);
  const [erro, setErro] = useState("");
  const [revisao, setRevisao] = useState(0);
  const chave = JSON.stringify([...new Set(eventos)].sort());
  useEffect(() => {
    if (!token || chave === "[]") return;
    let vigente = true;
    setErro("");
    contarProdutosCalendario(token, JSON.parse(chave)).then((resultado) => {
      if (!vigente) return;
      if (resultado.ok) setContagens(Object.fromEntries((JSON.parse(chave) as string[]).map((id) => [id, resultado.contagens[id] ?? 0])));
      else setErro(resultado.erro);
    }).catch(() => { if (vigente) setErro("Não foi possível carregar as associações."); });
    return () => { vigente = false; };
  }, [token, chave, revisao]);
  return <Contexto.Provider value={{ contagens, abrir: setEvento }}>
    {erro && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-white p-3 text-sm text-red-700">
      {erro}<button type="button" className={`${botao} ml-2`} onClick={() => setRevisao((v) => v + 1)}>Tentar novamente</button>
    </div>}
    {children}
    {evento && <ProdutosEventoModal key={evento.id} token={token} evento={evento}
      onFechar={() => setEvento(null)} onSalvo={() => setRevisao((v) => v + 1)} />}
  </Contexto.Provider>;
}

function ProdutosEventoModal({ token, evento, onFechar, onSalvo }: {
  token: string; evento: EventoSelecionado; onFechar: () => void; onSalvo: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [associados, setAssociados] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [resultado, setResultado] = useState<{ produtos: ProdutoEvento[]; temMais: boolean } | null>(null);
  const [alteracoes, setAlteracoes] = useState<Record<string, { produto: ProdutoEvento; selecionado: boolean }>>({});
  const [erroBusca, setErroBusca] = useState("");
  const [erroSalvar, setErroSalvar] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [revisao, setRevisao] = useState(0);
  const salvandoRef = useRef(false);
  const focoModal = useModalFocus(fechar);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    buscaRef.current?.focus();
    return () => {
      dialog?.close();
    };
  }, []);
  useEffect(() => {
    let vigente = true;
    setResultado(null);
    setErroBusca("");
    const timer = setTimeout(() => {
      buscarProdutosCalendario(token, { eventoId: evento.id, busca, pagina, associados }).then((dados) => {
        if (!vigente) return;
        if (dados.ok) setResultado(dados);
        else setErroBusca(dados.erro);
      }).catch(() => { if (vigente) setErroBusca("Não foi possível carregar os produtos."); });
    }, 300);
    return () => { vigente = false; clearTimeout(timer); };
  }, [token, evento.id, busca, pagina, associados, revisao]);

  function fechar() {
    if (salvandoRef.current) return;
    if (Object.keys(alteracoes).length && !window.confirm("Descartar as alterações não salvas?")) return;
    onFechar();
  }
  function alternar(produto: ProdutoEvento, selecionado: boolean) {
    setSucesso(""); setErroSalvar("");
    setAlteracoes((anterior) => {
      const proximo = { ...anterior };
      if (selecionado === produto.associado) delete proximo[produto.id];
      else proximo[produto.id] = { produto, selecionado };
      return proximo;
    });
  }
  const pendencias = Object.values(alteracoes);
  async function salvar() {
    if (salvandoRef.current || !pendencias.length) return;
    salvandoRef.current = true; setSalvando(true); setErroSalvar(""); setSucesso("");
    try {
      const resposta = await salvarProdutosCalendario(token, {
        eventoId: evento.id,
        adicionar: pendencias.filter((item) => item.selecionado).map((item) => item.produto.id),
        remover: pendencias.filter((item) => !item.selecionado).map((item) => item.produto.id),
      });
      if (!resposta.ok) { setErroSalvar(resposta.erro); return; }
      setAlteracoes({}); setResultado(null); setRevisao((v) => v + 1);
      setSucesso("Associações salvas."); onSalvo();
    } catch { setErroSalvar("Não foi possível confirmar o salvamento. Tente novamente; a operação não duplica vínculos."); }
    finally { salvandoRef.current = false; setSalvando(false); }
  }
  return <dialog ref={dialogRef} aria-labelledby="titulo-produtos-evento" aria-describedby="descricao-produtos-evento"
    onCancel={(e) => { e.preventDefault(); fechar(); }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-3 text-slate-900 backdrop:bg-slate-950/50 sm:p-6">
    <div className="flex h-full items-center justify-center">
      <div ref={focoModal} tabIndex={-1} className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0"><h2 id="titulo-produtos-evento" className="break-words text-lg font-semibold">Produtos · {evento.nome}</h2>
            <p id="descricao-produtos-evento" className="mt-1 text-xs text-slate-600">Associe produtos ativos. Os vínculos permanecem nos próximos anos até você removê-los.</p></div>
          <button type="button" className={`${botao} shrink-0`} disabled={salvando} onClick={fechar}>Fechar</button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <div><label htmlFor="busca-produtos-evento" className="mb-1 block text-sm font-medium">Título ou SKU</label>
            <input ref={buscaRef} id="busca-produtos-evento" className="input" maxLength={120} value={busca} disabled={salvando}
              onChange={(e) => { setBusca(e.target.value); setPagina(0); setResultado(null); }} placeholder="Pesquisar produtos" /></div>
          <div className="flex flex-wrap gap-2" aria-label="Produtos exibidos">
            <button type="button" aria-pressed={!associados} disabled={salvando} className={`${botao} ${!associados ? "bg-slate-900 text-white" : ""}`}
              onClick={() => { if (!associados) return; setAssociados(false); setPagina(0); setResultado(null); }}>Produtos ativos</button>
            <button type="button" aria-pressed={associados} disabled={salvando} className={`${botao} ${associados ? "bg-slate-900 text-white" : ""}`}
              onClick={() => { if (associados) return; setAssociados(true); setPagina(0); setResultado(null); }}>Já associados</button>
          </div>
          {erroBusca ? <div role="alert" className="text-sm text-red-700">{erroBusca} <button type="button" className={botao} onClick={() => setRevisao((v) => v + 1)}>Tentar novamente</button></div>
            : !resultado ? <p role="status" className="text-sm text-slate-600">Carregando produtos...</p>
            : <>
              {!resultado.produtos.length && <p role="status" className="text-sm text-slate-600">Nenhum produto encontrado.</p>}
              <ul className="divide-y divide-slate-200">{resultado.produtos.map((produto) => {
                const selecionado = alteracoes[produto.id]?.selecionado ?? produto.associado;
                return <li key={produto.id}><label className="flex min-h-11 cursor-pointer items-start gap-3 py-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selecionado}
                    disabled={salvando || (!produto.ativo && !selecionado)} onChange={(e) => alternar(produto, e.target.checked)} />
                  <span className="min-w-0 text-sm"><span className="block break-words font-medium">{produto.titulo}</span>
                    <span className="block break-all text-xs text-slate-600">SKU: {produto.sku}</span>
                    {!produto.ativo && <span className="block text-xs text-amber-700">Inativo · disponível somente para remoção</span>}</span>
                </label></li>;
              })}</ul>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className={botao} disabled={salvando || pagina === 0} onClick={() => { setPagina((v) => v - 1); setResultado(null); }}>Anterior</button>
                <span className="text-xs text-slate-600">Página {pagina + 1}</span>
                <button type="button" className={botao} disabled={salvando || !resultado.temMais} onClick={() => { setPagina((v) => v + 1); setResultado(null); }}>Próxima</button>
              </div>
            </>}
          {pendencias.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Revisar {pendencias.length} alterações</summary>
            <ul className="space-y-2">{pendencias.map(({ produto, selecionado }) => <li key={produto.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 break-words">{selecionado ? "Adicionar" : "Remover"}: {produto.titulo} · {produto.sku}</span>
              <button type="button" className={botao} disabled={salvando} onClick={() => alternar(produto, produto.associado)}>Desfazer</button>
            </li>)}</ul></details>}
        </div>
        <footer className="space-y-2 border-t border-slate-200 p-4">
          {erroSalvar && <p role="alert" className="text-sm text-red-700">{erroSalvar}</p>}
          {sucesso && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{sucesso}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">{pendencias.length} alterações pendentes · até 100 por salvamento</p>
            <button type="button" className={`${botao} bg-slate-900 text-white`} disabled={salvando || !pendencias.length || pendencias.length > 100} onClick={salvar}>
              {salvando ? "Salvando..." : "Salvar associações"}</button></div>
        </footer>
      </div>
    </div>
  </dialog>;
}
