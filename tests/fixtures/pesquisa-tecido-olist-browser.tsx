import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EstadoCatalogoTecidosOlist, PesquisaTecidoOlist } from "../../src/components/pesquisa-tecido-olist";
import type { OpcaoFilaOlist } from "../../src/lib/fila-olist-contrato";

const fourway = { id: 5168, nome: "FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168 1J3B4C6D2B", referencia: "5168", preco: 18.99 };
const baseitwill = { id: 6887, nome: "BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887", referencia: "6887", preco: 15.99 };
const produtos = [baseitwill, fourway, ...Array.from({ length: 45 }, (_, indice) => ({ id: indice + 1, nome: `Oxford Ref. ${indice + 1}`, referencia: String(indice + 1), preco: 10 }))];
declare global { interface Window { consultasTecidos: string[]; acoesCatalogo: { atualizar: number; carregarMais: number; cancelar: number } } }
window.consultasTecidos = [];
window.acoesCatalogo = { atualizar: 0, carregarMais: 0, cancelar: 0 };
window.fetch = async input => { window.consultasTecidos.push(String(input)); throw new Error("O seletor não pode consultar a rede."); };
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("tema") === "dark");

function Fixture() {
  const [nome, setNome] = useState("FOURWAY");
  const [disabled, setDisabled] = useState(false);
  const [produtoId, setProdutoId] = useState(0);
  const [preco, setPreco] = useState<number | null>(null);
  const [estado, setEstado] = useState(params.get("estado") ?? "completo");
  const catalogo = {
    itens: estado === "vazio" || estado === "carregando" || estado === "cancelado" ? [] : estado === "erro" || estado === "parcial" ? produtos.slice(0, 2) : produtos,
    carregando: estado === "carregando", completo: estado === "completo" || estado === "vazio", erro: estado === "erro" ? "Falha ao carregar a próxima página." : estado === "cancelado" ? "Carregamento cancelado. Tente novamente para continuar." : "",
    atualizar: () => { window.acoesCatalogo.atualizar++; setEstado("completo"); },
    carregarMais: () => { window.acoesCatalogo.carregarMais++; setEstado("completo"); },
    cancelar: () => { window.acoesCatalogo.cancelar++; setEstado("cancelado"); },
  };
  function selecionar(produto: OpcaoFilaOlist) { setNome(produto.nome); setProdutoId(produto.id); setPreco(produto.preco ?? null); }
  return <main className="mx-auto max-w-6xl space-y-4 p-4">
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h1 className="text-xl font-semibold">Selecionar tecido no pedido ao fornecedor</h1>
      <EstadoCatalogoTecidosOlist catalogo={catalogo} disabled={disabled} />
      <PesquisaTecidoOlist nome={nome} catalogo={catalogo} disabled={disabled} produtoId={produtoId} preco={preco} aoEncontrar={selecionar} aoAlterarPreco={setPreco}
        aoLimparAssociacao={() => { setProdutoId(0); setPreco(null); }}>
        <label htmlFor="nome" className="block text-sm">Tecido</label>
        <input id="nome" className="input mt-1 min-h-11" value={nome} disabled={disabled} onChange={event => { setNome(event.target.value); setProdutoId(0); setPreco(null); }} />
      </PesquisaTecidoOlist>
    </section>
    <button type="button" className="min-h-11 rounded-md border border-slate-300 p-2" onClick={() => setDisabled(atual => !atual)}>{disabled ? "Desbloquear" : "Bloquear"}</button>
    <label className="block text-sm">Outro campo<input id="outro" className="input mt-1 min-h-11" /></label>
    <output id="selecao">{JSON.stringify({ produtoId, preco })}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
