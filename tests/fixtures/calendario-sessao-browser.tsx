import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import Calendario from "../../src/app/controle-midia/calendario/page";
import { catalogoComercial } from "../../src/lib/calendario-comercial/catalogo";

const produtoId = "10000000-0000-4000-8000-000000000001";
const ouvintes = new Set<() => void>();
let auth = { session: { access_token: "token-inicial", user: { id: "auth-inicial" } },
  usuario: { id: "usuario-inicial", aplicativo_id: "app-inicial", podeVisualizarTarefasMidia: true,
    podeVisualizarEstoque: true, podeEditarEstoque: false } };
const inscricao = (fn: () => void) => { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; };
const estado = () => auth;
export function useAuth() { return useSyncExternalStore(inscricao, estado); }
function mudar(tipo: "token" | "usuario" | "aplicativo") {
  auth = { session: { access_token: "token-renovado", user: { id: tipo === "usuario" ? "auth-outro" : auth.session.user.id } },
    usuario: { ...auth.usuario, id: tipo === "usuario" ? "usuario-outro" : auth.usuario.id,
      aplicativo_id: tipo === "aplicativo" ? "app-outro" : auth.usuario.aplicativo_id } };
  for (const fn of ouvintes) fn();
}
const gravacoes: Array<{ token: string; adicionar: string[] }> = [];
export async function carregarCalendario() { return { ok: true, eventos: catalogoComercial }; }
export async function contarProdutosCalendario() { return { ok: true, contagens: {} }; }
export async function buscarProdutosCalendario() {
  return { ok: true, produtos: [{ id: produtoId, sku: "SKU-TESTE", titulo: "Produto de teste", ativo: true, associado: false }], temMais: false };
}
export async function salvarProdutosCalendario(token: string, entrada: { adicionar: string[] }) {
  gravacoes.push({ token, adicionar: entrada.adicionar });
  return { ok: true };
}
declare global { interface Window { calendarioSessaoTeste: { mudar: typeof mudar; gravacoes: typeof gravacoes }; } }
window.calendarioSessaoTeste = { mudar, gravacoes };
function agendar(tipo: Parameters<typeof mudar>[0]) {
  // Controles exclusivos da fixture para reproduzir renovação enquanto o diálogo
  // torna o restante da página inerte. O teste de CI também chama mudar diretamente.
  document.addEventListener("change", () => { setTimeout(() => mudar(tipo), 750); }, { once: true });
}
function App() {
  const atual = useAuth();
  return <><p role="status">Sessão: {atual.session.access_token} · {atual.usuario.id} · {atual.usuario.aplicativo_id}</p>
    <button onClick={() => agendar("token")}>Renovar após selecionar</button>
    <button onClick={() => agendar("usuario")}>Trocar usuário após selecionar</button>
    <button onClick={() => agendar("aplicativo")}>Trocar aplicativo após selecionar</button>
    <Calendario />
  </>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
