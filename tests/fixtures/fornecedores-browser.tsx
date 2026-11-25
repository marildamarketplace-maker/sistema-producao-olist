import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import FornecedoresPage from "../../src/app/fornecedor/fornecedores/page";

const aplicativoId = "00000000-0000-0000-0000-000000000001";
const pai = "00000000-0000-0000-0000-000000000002";
const fornecedores = [{ id: "00000000-0000-0000-0000-000000000003", aplicativo_pai_id: pai,
  nome: "Fornecedor com nome longo para verificar leitura e quebra de texto", endereco: "Rua de teste, 123", ativo: true, created_at: "2026-11-24T12:00:00Z" }];
const estado = { falharSalvar: true, salvos: [] as Record<string, unknown>[], projecoes: [] as string[], aplicativos: [] as unknown[] };
Object.assign(window, { fornecedoresTeste: estado });
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("tema") === "dark");

const auth = { session: { access_token: "teste-local" }, usuario: { aplicativo_id: aplicativoId } };
export function useAuth() { return auth; }
export function AccessGuard({ children }: { children: ReactNode }) { return children; }
export const supabase = {
  from(tabela: string) {
    if (tabela !== "fornecedores") throw new Error(`Consulta inesperada: ${tabela}`);
    return {
      select(projecao: string) {
        estado.projecoes.push(projecao);
        return { eq(campo: string, valor: string) {
          if (campo !== "aplicativo_id" || valor !== aplicativoId) throw new Error("Consulta sem escopo de aplicativo.");
          estado.aplicativos.push(valor);
          return { eq(ativoCampo: string, ativo: boolean) { if (ativoCampo !== "ativo") throw new Error("Filtro ativo ausente"); return { order: async () => ({ data: fornecedores.filter(f => f.ativo === ativo).map(item => ({ ...item })), error: null }) }; } };
        } };
      },
    };
  },
};
window.fetch = async (input, init) => {
  if (String(input) === "/api/fornecedores/aplicativos-pai") {
    return Response.json({ aplicativosPai: [{ id: pai, nome: "Aplicativo pai do fornecedor com nome longo" }] });
  }
  if (String(input) !== "/api/fornecedores/salvar") throw new Error(`Endpoint inesperado: ${input}`);
  const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
  if (init?.method === "DELETE") { const alvo=fornecedores.find(f=>f.id===payload.id); if (alvo) alvo.ativo=false; return Response.json({id:payload.id,ativo:false}); }
  estado.salvos.push(payload);
  if (estado.falharSalvar) return Response.json({ error: "Falha recuperável ao salvar." }, { status: 400 });
  fornecedores[0].nome = String(payload.nome);
  return Response.json({ id: fornecedores[0].id });
};
createRoot(document.getElementById("root")!).render(<FornecedoresPage />);
