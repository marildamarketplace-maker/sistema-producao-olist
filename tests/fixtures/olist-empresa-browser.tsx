import { createRoot } from "react-dom/client";
import { useSyncExternalStore, type ReactNode } from "react";
import Produtos from "../../src/app/olist/produtos/page";
import Contatos from "../../src/app/olist/contatos/page";
import Pedidos from "../../src/app/olist/pedidos/page";
import Pagamento from "../../src/app/olist/formas-pagamento/page";
import Recebimento from "../../src/app/olist/formas-recebimento/page";
import Vendedores from "../../src/app/olist/vendedores/page";
let auth = { session: { access_token: "local", user: { id: "usuario-local" } }, usuario: { aplicativo_id: "matriz" } };
const listeners = new Set<() => void>();
export function useAuth() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => auth); }
export function AccessGuard({ children }: { children: ReactNode }) { return children; }
const params = new URLSearchParams(location.search);
if (!params.has("persistir")) sessionStorage.clear();
document.documentElement.classList.toggle("dark", params.get("tema") === "dark");
const estado = {
  consultas: [] as string[], downloads: 0, cancelamentos: 0,
  pendentes: [] as Array<() => void>,
  renovar() { auth = { ...auth, session: { ...auth.session, access_token: "renovado" } }; for (const listener of listeners) listener(); },
  trocarUsuario() { auth = { ...auth, session: { ...auth.session, user: { id: "outro-usuario" } } }; for (const listener of listeners) listener(); },
};
HTMLAnchorElement.prototype.click = function () { estado.downloads++; };
Object.assign(window, { empresaTeste: estado });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  estado.consultas.push(url.pathname + url.search);
  if (url.pathname === "/api/olist/empresas" && params.has("fornecedor") && url.searchParams.get("contexto") === "pedidos") return Response.json({ aplicativoId: "matriz", empresas: [{ id: "matriz", nome: "Empresa cliente" }, { id: "fornecedor-filial", nome: "Filial do fornecedor" }] });
  if (url.pathname === "/api/olist/empresas") return Response.json({ aplicativoId: params.has("unica") ? "matriz" : "outra-filial", empresas: params.has("unica") ? [{ id: "matriz", nome: "Empresa única" }] : [{ id: "outra-filial", nome: "Filial com nome muito longo para testar o seletor" }, { id: "filial", nome: "Filial" }] });
  if (params.has("exportacao") && /^\/api\/olist\/pedidos\/\d+$/.test(url.pathname)) {
    return new Promise<Response>((resolve) => {
      init?.signal?.addEventListener("abort", () => { estado.cancelamentos++; }, { once: true });
      // Simula resposta tardia de um transporte que ignora o cancelamento.
      estado.pendentes.push(() => resolve(Response.json({ id: 1, itens: [{ produto: { sku: "SKU" }, quantidade: 1 }] })));
    });
  }
  return Response.json({ itens: params.has("exportacao") ? [{ id: 1, numero: 1 }, { id: 2, numero: 2 }] : [], paginacao: { total: params.has("exportacao") ? 2 : 0 } });
};
const telas = { produtos: Produtos, contatos: Contatos, pedidos: Pedidos, "formas-pagamento": Pagamento, "formas-recebimento": Recebimento, vendedores: Vendedores };
const Tela = telas[params.get("tela") as keyof typeof telas] ?? Produtos;
createRoot(document.getElementById("root")!).render(<div className="p-4"><Tela /></div>);
