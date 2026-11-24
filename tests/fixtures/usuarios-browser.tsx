import { createRoot } from "react-dom/client";
import { type ReactNode, useSyncExternalStore } from "react";
import UsuariosPage from "../../src/app/usuarios/page";
import { permissionKeys } from "../../src/lib/permissions";

const app = "00000000-0000-0000-0000-000000000002";
const filho = "00000000-0000-0000-0000-000000000003";
const appB = "00000000-0000-0000-0000-000000000004";
const alvo = "00000000-0000-0000-0000-000000000011";
let auth = { session: { access_token: "teste-local" }, usuario: { id: "admin-a", aplicativo_id: app } };
const listeners = new Set<() => void>();
export function useAuth() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => auth); }
export function AccessGuard({ children }: { children: ReactNode }) { return children; }
const parametros = new URLSearchParams(location.search);
export function useSearchParams() { return parametros; }
const permissoes = Object.fromEntries(permissionKeys.map(chave => [chave, true]));
const cadastro = {
  id: alvo, nome: "Usuário com nome longo para verificar a edição dos vendedores por aplicativo", email: "usuario.com.email.longo@example.test", ativo: true,
  vendedorOlistId: 10, vendedoresOlistQuantidade: 2, vinculosOlistVersao: 3, ...permissoes,
  vendedoresOlist: [{ aplicativoId: app, vendedorOlistId: 10 }, { aplicativoId: filho, vendedorOlistId: 20 }],
};
const estado = {
  falharSalvar: true, falhaSalvarStatus: 409, deferir: false,
  consultas: [] as Array<{ url: string; aplicativoId: string }>, salvos: [] as Array<Record<string, unknown>>,
  pendentes: [] as Array<{ concluir: () => void }>,
  trocarEscopo() { auth = { session: { access_token: "teste-outro" }, usuario: { id: "admin-b", aplicativo_id: appB } }; for (const listener of listeners) listener(); },
  renovarToken() { auth = { ...auth, session: { access_token: "teste-renovado" } }; for (const listener of listeners) listener(); },
};
Object.assign(window, { usuariosTeste: estado });
document.documentElement.classList.toggle("dark", parametros.get("tema") === "dark");
window.fetch = async (input, init) => {
  const url = new URL(String(input), "https://example.test");
  if (url.pathname !== "/api/usuarios") throw new Error(`Endpoint inesperado: ${input}`);
  const aplicativoId = auth.usuario.aplicativo_id;
  estado.consultas.push({ url: String(input), aplicativoId });
  if (init?.method === "PATCH" || init?.method === "POST") {
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    estado.salvos.push(payload);
    if (estado.falharSalvar) return Response.json({ error: estado.falhaSalvarStatus === 409
      ? "Os vínculos foram alterados. Recarregue o usuário antes de salvar."
      : "Não foi possível confirmar o salvamento. Tente novamente." }, { status: estado.falhaSalvarStatus });
    if (payload.profile) {
      const perfil = payload.profile as typeof cadastro;
      Object.assign(cadastro, perfil, { vinculosOlistVersao: cadastro.vinculosOlistVersao + 1, vendedoresOlistQuantidade: perfil.vendedoresOlist.length });
    }
    return Response.json({ usuario: cadastro }, { status: init.method === "POST" ? 201 : 200 });
  }
  if (url.searchParams.get("recurso") === "aplicativos") {
    const resposta = { aplicativos: aplicativoId === app ? [{ id: app, nome: "Matriz do usuário" }, { id: filho, nome: "Filial do usuário" }] : [{ id: appB, nome: "Conta B" }] };
    if (estado.deferir) return new Promise<Response>(resolve => estado.pendentes.push({ concluir: () => resolve(Response.json(resposta)) }));
    return Response.json(resposta);
  }
  if (url.searchParams.has("usuarioId")) {
    const resposta = { usuario: structuredClone(cadastro) };
    if (estado.deferir) return new Promise<Response>(resolve => estado.pendentes.push({ concluir: () => resolve(Response.json(resposta)) }));
    return Response.json(resposta);
  }
  const pagina = Number(url.searchParams.get("pagina") ?? 1);
  const resumo = Object.fromEntries(Object.entries(cadastro).filter(([chave]) => chave !== "vendedoresOlist"));
  return Response.json({ usuarios: [{ ...resumo, nome: aplicativoId === app ? cadastro.nome : "Usuário da conta B", email: aplicativoId === app ? cadastro.email : "conta-b@example.test" }], paginacao: { pagina, limite: 50, total: 51, totalPaginas: 2 } });
};
createRoot(document.getElementById("root")!).render(<UsuariosPage />);
