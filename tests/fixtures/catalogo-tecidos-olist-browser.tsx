import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCatalogoTecidosOlist } from "../../src/hooks/use-catalogo-tecidos-olist";

type Consulta = { url: string; token: string | null; signal: AbortSignal | null | undefined; responder: (payload: unknown, status?: number) => void };
declare global { interface Window { catalogoTeste: { consultas: Consulta[]; adiar: boolean; ativas: number; maxAtivas: number; responder: (indice: number, payload: unknown, status?: number) => void } } }
const params = new URLSearchParams(location.search);
const primeiraPagina = Array.from({ length: 50 }, (_, index) => ({ id: 100 + index, nome: `Produto Ref. ${100 + index}`, preco: index + 1 }));
let falhouSegunda = false;
window.catalogoTeste = { consultas: [], adiar: params.has("adiar"), ativas: 0, maxAtivas: 0,
  responder: (indice, payload, status) => window.catalogoTeste.consultas[indice].responder(payload, status) };
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  return new Promise<Response>(resolve => {
    window.catalogoTeste.ativas++;
    window.catalogoTeste.maxAtivas = Math.max(window.catalogoTeste.maxAtivas, window.catalogoTeste.ativas);
    let respondeu = false;
    // Ignora o abort propositalmente para exercitar também o descarte por identidade.
    const responder = (payload: unknown, status = 200) => {
      if (respondeu) return;
      respondeu = true; window.catalogoTeste.ativas--;
      resolve(Response.json(payload, { status }));
    };
    window.catalogoTeste.consultas.push({ url: url.href, token: new Headers(init?.headers).get("Authorization"), signal: init?.signal, responder });
    if (window.catalogoTeste.adiar) return;
    const pagina = Number(url.searchParams.get("pagina"));
    if (params.get("modo") === "pendente" && pagina === 2) return;
    if (params.get("modo") === "erro" && pagina === 2 && !falhouSegunda) {
      falhouSegunda = true; responder({ error: "Falha temporária no catálogo" }, 503); return;
    }
    if (params.get("modo") === "vazio") { responder({ itens: [], pagina, mais: false }); return; }
    if (params.get("modo") === "longo") {
      responder({ itens: [{ id: pagina, nome: `Tecido Ref. ${pagina}`, preco: 10 }], pagina, mais: pagina < 21 }); return;
    }
    responder({ itens: pagina === 1 ? primeiraPagina : [
      { id: 5168, nome: "FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168 1J3B4C6D2B", referencia: "5168", preco: 18.99 },
      { id: 6887, nome: "BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887", referencia: "6887", preco: 15.99 },
    ], pagina, mais: pagina === 1 });
  });
};

function Catalogo({ api, token, usuarioId, ativo, mostrar }: { api: string; token: string; usuarioId: string; ativo: boolean; mostrar: boolean }) {
  const catalogo = useCatalogoTecidosOlist({ api, token, usuarioId, ativo, prazoPaginaMs: params.has("prazoCurto") ? 1000 : undefined });
  return <section>
    <output id="estado">{JSON.stringify({ itens: catalogo.itens, carregando: catalogo.carregando, completo: catalogo.completo, erro: catalogo.erro })}</output>
    {mostrar && <p>Etapa de seleção: {catalogo.itens.length} opções</p>}
    <button type="button" onClick={catalogo.carregarMais}>Continuar carregamento</button>
    <button type="button" onClick={catalogo.atualizar}>Atualizar catálogo</button>
    <button type="button" onClick={catalogo.cancelar}>Cancelar carregamento</button>
  </section>;
}
function Fixture() {
  const [conta, setConta] = useState(1);
  const [origem, setOrigem] = useState(1);
  const [usuario, setUsuario] = useState(1);
  const [token, setToken] = useState(1);
  const [contexto, setContexto] = useState(1);
  const [ativo, setAtivo] = useState(!params.has("inativo"));
  const [mostrar, setMostrar] = useState(true);
  const [montado, setMontado] = useState(true);
  const api = `/api/teste?aplicativoId=conta-${conta}&contextoConsulta=assinado-${contexto}&aplicativoOrigemId=origem-${origem}&vendedorOrigemId=20&clienteOrigemId=30`;
  return <main>
    {montado && <Catalogo api={api} token={`token-${token}`} usuarioId={`usuario-${usuario}`} ativo={ativo} mostrar={mostrar} />}
    <button type="button" onClick={() => setConta(atual => atual + 1)}>Trocar conta</button>
    <button type="button" onClick={() => setOrigem(atual => atual + 1)}>Trocar origem</button>
    <button type="button" onClick={() => setUsuario(atual => atual + 1)}>Trocar usuário</button>
    <button type="button" onClick={() => setToken(atual => atual + 1)}>Trocar token</button>
    <button type="button" onClick={() => setContexto(atual => atual + 1)}>Renovar contexto</button>
    <button type="button" onClick={() => setMostrar(atual => !atual)}>Alternar etapa</button>
    <button type="button" onClick={() => setAtivo(atual => !atual)}>{ativo ? "Desativar" : "Reativar"}</button>
    <button type="button" onClick={() => setMontado(atual => !atual)}>{montado ? "Remover hook" : "Reabrir hook"}</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(params.has("strict") ? <StrictMode><Fixture /></StrictMode> : <Fixture />);
