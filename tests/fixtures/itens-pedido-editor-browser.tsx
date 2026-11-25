import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ItensPedidoEditor } from "../../src/components/itens-pedido-editor";
import { useCatalogoTecidosOlist } from "../../src/hooks/use-catalogo-tecidos-olist";
import { criarRascunhoFilaOlist } from "../../src/lib/fila-olist-contrato";
import type { ItemPedidoManual } from "../../src/lib/pedido-manual-contrato";

const novo = (nome: string): ItemPedidoManual => ({ id: crypto.randomUUID(), tecidoNome: nome, quantidade: 1,
  quantidadeTecido: 1, estampa: "", variante: null, tamanho: "", tipoProduto: "", corteLaser: false });
declare global { interface Window { consultasEditor: string[] } }
window.consultasEditor = [];
window.fetch = async input => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  window.consultasEditor.push(url.search);
  return Response.json({ itens: [{ id: 101, nome: "Oxford Ref. 101", referencia: "101", preco: 8 }, { id: 123, nome: "Cetim Ref. 123", referencia: "123", preco: 10 }], pagina: 1, mais: false });
};
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("tema") === "dark");

function Fixture() {
  const [itens, setItens] = useState(() => [novo("Oxford"), novo("Cetim")]);
  const [selecoes, setSelecoes] = useState(() => criarRascunhoFilaOlist(itens.map(item => item.id)));
  const [visivel, setVisivel] = useState(true);
  const catalogo = useCatalogoTecidosOlist({ api: "/api/teste?aplicativoId=conta", token: "teste", usuarioId: "fixture", ativo: true });
  return <main className="mx-auto max-w-6xl space-y-4 p-4">{visivel && <ItensPedidoEditor catalogo={catalogo} itens={itens} selecoes={selecoes}
    disabled={false} limite={2} aoAlterarSelecoes={setSelecoes}
    aoAlterarItem={(id, patch) => {
      setItens(atuais => atuais.map(item => item.id === id ? { ...item, ...patch } : item));
      if (patch.tecidoNome !== undefined) setSelecoes(atual => ({ ...atual, tecidos: atual.tecidos.map(tecido => tecido.tecidoId === id ? { ...tecido, id: 0, preco: null } : tecido) }));
    }}
    aoRemover={id => { setItens(atuais => atuais.filter(item => item.id !== id)); setSelecoes(atual => ({ ...atual, tecidos: atual.tecidos.filter(tecido => tecido.tecidoId !== id) })); }}
    aoAdicionar={() => { const item = novo(""); setItens(atuais => [...atuais, item]); setSelecoes(atual => ({ ...atual, tecidos: [...atual.tecidos, { tecidoId: item.id, id: 0, preco: null }] })); }} />}
    <button type="button" className="min-h-11 rounded-md border border-slate-300 px-3 py-2" onClick={() => setVisivel(atual => !atual)}>{visivel ? "Ocultar itens" : "Reabrir itens"}</button>
    <output id="selecoes">{JSON.stringify(selecoes.tecidos)}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
