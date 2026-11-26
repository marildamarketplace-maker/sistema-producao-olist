import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "../../src/components/auth-provider";
import { Sidebar } from "../../src/components/sidebar";
import { ThemeProvider } from "../../src/components/theme-provider";

function pendente<T>() {
  let resolver!: (value: T) => void;
  const promise = new Promise<T>(resolve => { resolver = resolve; });
  return { promise, resolver };
}

const sessao = {
  access_token: "token-ficticio", refresh_token: "refresh-ficticio", token_type: "bearer", expires_in: 3600,
  user: { id: "usuario-teste", email: "teste@example.test", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01" },
} satisfies Session;
const usuario = { id: "usuario-teste", nome: "Usuário com nome longo para conferir o layout do menu", email: "teste@example.test", aplicativo_id: "teste", aplicativo: { nome: "Empresa de teste" }, podeVisualizarEstoque: true };
const callbacks = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
const sessaoInicial = pendente<{ data: { session: Session | null } }>();
let saida = pendente<"sucesso" | "erro" | "excecao">();
let respostaUsuario: ReturnType<typeof pendente<Response>> | null = null;
let respostaFallback: ReturnType<typeof pendente<{ data: typeof usuario | null; error: null }>> | null = null;
const params = new URLSearchParams(location.search);
localStorage.setItem("sistema_producao_theme", params.get("tema") === "dark" ? "dark" : "light");

export const controle = {
  escopos: [] as string[], redirects: [] as string[], consultas: 0, fallbacks: 0, projecoesFallback: [] as string[],
  estado: { session: false, usuario: false, signingOut: false, signOutError: null as string | null },
  sair: async () => {}, atualizar: async () => {},
  emitir(session: Session | null = sessao) {
    for (const callback of callbacks) callback(session ? "SIGNED_IN" : "SIGNED_OUT", session);
  },
  concluirSaida(resultado: "sucesso" | "erro" | "excecao") { saida.resolver(resultado); },
  atrasarUsuario() { respostaUsuario = pendente<Response>(); },
  liberarUsuario(status = 200) {
    respostaUsuario?.resolver(Response.json(status === 200 ? usuario : { error: "Acesso indisponível" }, { status }));
    respostaUsuario = null;
  },
  atrasarFallback() { respostaFallback = pendente(); },
  liberarFallback() { respostaFallback?.resolver({ data: usuario, error: null }); respostaFallback = null; },
  liberarSessaoInicial() { sessaoInicial.resolver({ data: { session: sessao } }); },
};
Object.assign(window, { logoutTeste: controle });

export const supabase = {
  auth: {
    getSession: async () => params.has("atrasarSessao") ? sessaoInicial.promise : { data: { session: sessao } },
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      callbacks.add(callback);
      return { data: { subscription: { unsubscribe: () => callbacks.delete(callback) } } };
    },
    signOut: async (options?: { scope?: string }) => {
      controle.escopos.push(options?.scope ?? "global");
      const resultado = await saida.promise;
      saida = pendente();
      if (resultado === "excecao") throw new Error("Detalhe privado do provedor");
      if (resultado === "erro") return { error: new Error("Detalhe privado do provedor") };
      controle.emitir(null);
      return { error: null };
    },
  },
  from: () => {
    let colunaRemovida = false;
    const consulta = {
      select: (campos: string) => {
        controle.projecoesFallback.push(campos);
        colunaRemovida = campos.split(",").some(campo => campo.trim() === "pode_visualizar_olist_formas_pagamento");
        return consulta;
      }, ilike: () => consulta, eq: () => consulta, limit: () => consulta,
      maybeSingle: async () => {
        controle.fallbacks++;
        if (params.has("recebimentoFallback")) return colunaRemovida
          ? { data: null, error: { code: "42703", message: "Coluna removida" } }
          : { data: { ...usuario, pode_visualizar_olist_formas_recebimento: true }, error: null };
        return respostaFallback ? respostaFallback.promise : { data: null, error: null };
      },
    };
    return consulta;
  },
};

window.fetch = async (input) => {
  if (String(input) !== "/api/usuario/me") throw new Error("Requisição fora do teste");
  controle.consultas++;
  if (respostaUsuario) return respostaUsuario.promise;
  if (params.has("recebimentoFallback")) return Response.json({ error: "Serviço indisponível" }, { status: 503 });
  return params.has("semAcesso") ? Response.json({ error: "Acesso indisponível" }, { status: 403 }) : Response.json(usuario);
};

function Conteudo() {
  const auth = useAuth();
  useEffect(() => {
    controle.sair = auth.signOut;
    controle.atualizar = auth.refreshUsuario;
    controle.estado = { session: Boolean(auth.session), usuario: Boolean(auth.usuario), signingOut: auth.signingOut, signOutError: auth.signOutError };
  }, [auth]);
  return <div className="flex min-h-screen flex-col md:flex-row"><Sidebar /><main className="min-w-0 flex-1 p-4"><h1>Teste de sessão</h1><p>Dados fictícios, sem conexão com produção.</p></main></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><AuthProvider><Conteudo /></AuthProvider></ThemeProvider></StrictMode>);
