"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { PermissionSet } from "@/lib/permissions";

type UsuarioAplicativo = {
  id: string;
  nome: string;
  email: string;
  aplicativo_id: string;
  vendedorOlistId: number | null;
  vendedorOlist?: { aplicativoId: string; vendedorOlistId: number } | null;
  aplicativoAdministraSincronizacaoOlist?: boolean;
  aplicativo?: {
    nome: string;
  } | null;
} & PermissionSet;

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  usuario: UsuarioAplicativo | null;
  loading: boolean;
  signOut: () => Promise<void>;
  signingOut: boolean;
  signOutError: string | null;
  refreshUsuario: () => Promise<void>;
};

type UsuarioAplicativoFallbackResponse = {
  id: string;
  nome: string;
  email: string;
  aplicativo_id: string;
  aplicativo?: { nome: string } | { nome: string }[] | null;
  pode_visualizar_dashboard: boolean;
  pode_visualizar_fornecedores: boolean;
  pode_visualizar_produtos_fornecedor: boolean;
  pode_visualizar_categorias_midia: boolean;
  pode_visualizar_tarefas_midia: boolean;
  pode_visualizar_automatizacao: boolean;
  pode_editar_habilidades: boolean;
  pode_gerenciar_rotinas: boolean;
  pode_intervir_automatizacao: boolean;
  pode_visualizar_olist_produtos: boolean;
  pode_visualizar_olist_contatos: boolean;
  pode_visualizar_olist_pedidos: boolean;
  pode_criar_olist_pedido: boolean;
  pode_visualizar_olist_vendedores: boolean;
  pode_visualizar_olist_formas_pagamento: boolean;
  pode_visualizar_olist_formas_recebimento: boolean;
  pode_visualizar_estoque: boolean;
  pode_editar_estoque: boolean;
  pode_visualizar_tipos_produto: boolean;
  pode_editar_tipos_produto: boolean;
  pode_visualizar_tamanhos: boolean;
  pode_editar_tamanhos: boolean;
  pode_visualizar_estampas: boolean;
  pode_editar_estampas: boolean;
  pode_criar_mockups: boolean;
  pode_visualizar_variantes: boolean;
  pode_editar_variantes: boolean;
  pode_visualizar_baixa: boolean;
  pode_solicitar_baixa: boolean;
  pode_visualizar_devolucao: boolean;
  pode_solicitar_devolucao: boolean;
  pode_solicitar_producao: boolean;
  pode_visualizar_producao: boolean;
  pode_confirmar_producao: boolean;
  pode_escrever_anotar_sku: boolean;
  pode_visualizar_anotar_sku: boolean;
  pode_visualizar_configuracao: boolean;
  pode_editar_configuracao: boolean;
  pode_gerenciar_fila_pedidos: boolean;
  pode_selecionar_filial_fornecedor: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const publicPaths = new Set(["/", "/login", "/confirmar-entrega-producao"]);

function isPublicPath(pathname: string) {
  return publicPaths.has(pathname);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<UsuarioAplicativo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOutInFlight = useRef(false);
  // Invalidam respostas que pertencem a uma sessão ou consulta anterior.
  const authRevision = useRef(0);
  const usuarioRequest = useRef(0);
  const invalidarConsultas = useCallback(() => {
    authRevision.current++;
    usuarioRequest.current++;
  }, []);

  const carregarUsuarioFallback = useCallback(async (email: string) => {
    const { data, error } = await supabase
      .from("usuario")
      .select(`
        id,
        nome,
        email,
        aplicativo_id,
        pode_visualizar_dashboard,
        pode_visualizar_fornecedores,
        pode_visualizar_produtos_fornecedor,
        pode_visualizar_categorias_midia,
        pode_visualizar_tarefas_midia,
        pode_visualizar_automatizacao,
        pode_editar_habilidades,
        pode_gerenciar_rotinas,
        pode_intervir_automatizacao,
        pode_visualizar_olist_produtos,
        pode_visualizar_olist_contatos,
        pode_visualizar_olist_pedidos,
        pode_criar_olist_pedido,
        pode_visualizar_olist_vendedores,
        pode_visualizar_olist_formas_pagamento,
        pode_visualizar_olist_formas_recebimento,
        pode_visualizar_estoque,
        pode_editar_estoque,
        pode_visualizar_tipos_produto,
        pode_editar_tipos_produto,
        pode_visualizar_tamanhos,
        pode_editar_tamanhos,
        pode_visualizar_estampas,
        pode_editar_estampas,
        pode_criar_mockups,
        pode_visualizar_variantes,
        pode_editar_variantes,
        pode_visualizar_baixa,
        pode_solicitar_baixa,
        pode_visualizar_devolucao,
        pode_solicitar_devolucao,
        pode_solicitar_producao,
        pode_visualizar_producao,
        pode_confirmar_producao,
        pode_escrever_anotar_sku,
        pode_visualizar_anotar_sku,
        pode_visualizar_configuracao,
        pode_gerenciar_fila_pedidos,
        pode_selecionar_filial_fornecedor,
        pode_editar_configuracao,
        aplicativo(nome)
      `)
      .ilike("email", email.trim())
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const usuarioData = data as UsuarioAplicativoFallbackResponse;
    const aplicativo = Array.isArray(usuarioData.aplicativo)
      ? usuarioData.aplicativo[0] ?? null
      : usuarioData.aplicativo ?? null;

    return {
      id: usuarioData.id,
      nome: usuarioData.nome,
      email: usuarioData.email,
      aplicativo_id: usuarioData.aplicativo_id,
      // O fallback não lê a tabela privada de vínculos nem a coluna antiga.
      vendedorOlistId: null,
      vendedorOlist: null,
      aplicativo,
      // Acesso entre empresas exige confirmação do servidor; o fallback não o concede.
      aplicativoAdministraSincronizacaoOlist: false,
      podeVisualizarSincronizacaoOlist: false,
      podeExecutarSincronizacaoOlist: false,
      podeResolverSincronizacaoOlist: false,
      podeConfigurarSincronizacaoOlist: false,
      podeVisualizarDashboard: Boolean(usuarioData.pode_visualizar_dashboard),
      podeVisualizarFornecedores: Boolean(usuarioData.pode_visualizar_fornecedores),
      podeVisualizarProdutosFornecedor: Boolean(usuarioData.pode_visualizar_produtos_fornecedor),
      podeVisualizarCategoriasMidia: Boolean(usuarioData.pode_visualizar_categorias_midia),
      podeVisualizarTarefasMidia: Boolean(usuarioData.pode_visualizar_tarefas_midia),
      podeVisualizarAutomatizacao: Boolean(usuarioData.pode_visualizar_automatizacao),
      podeEditarHabilidades: Boolean(usuarioData.pode_editar_habilidades),
      podeGerenciarRotinas: Boolean(usuarioData.pode_gerenciar_rotinas),
      podeIntervirAutomatizacao: Boolean(usuarioData.pode_intervir_automatizacao),
      podeVisualizarOlistProdutos: Boolean(usuarioData.pode_visualizar_olist_produtos),
      podeVisualizarOlistContatos: Boolean(usuarioData.pode_visualizar_olist_contatos),
      podeVisualizarOlistPedidos: Boolean(usuarioData.pode_visualizar_olist_pedidos),
      podeCriarOlistPedido: Boolean(usuarioData.pode_criar_olist_pedido),
      podeVisualizarOlistVendedores: Boolean(usuarioData.pode_visualizar_olist_vendedores),
      podeVisualizarOlistFormasPagamento: Boolean(usuarioData.pode_visualizar_olist_formas_pagamento),
      podeVisualizarOlistFormasRecebimento: Boolean(usuarioData.pode_visualizar_olist_formas_recebimento),
      podeVisualizarEstoque: Boolean(usuarioData.pode_visualizar_estoque),
      podeEditarEstoque: Boolean(usuarioData.pode_editar_estoque),
      podeVisualizarTiposProduto: Boolean(usuarioData.pode_visualizar_tipos_produto),
      podeEditarTiposProduto: Boolean(usuarioData.pode_editar_tipos_produto),
      podeVisualizarTamanhos: Boolean(usuarioData.pode_visualizar_tamanhos),
      podeEditarTamanhos: Boolean(usuarioData.pode_editar_tamanhos),
      podeVisualizarEstampas: Boolean(usuarioData.pode_visualizar_estampas),
      podeEditarEstampas: Boolean(usuarioData.pode_editar_estampas),
      podeCriarMockups: Boolean(usuarioData.pode_criar_mockups),
      podeVisualizarVariantes: Boolean(usuarioData.pode_visualizar_variantes),
      podeEditarVariantes: Boolean(usuarioData.pode_editar_variantes),
      podeVisualizarBaixa: Boolean(usuarioData.pode_visualizar_baixa),
      podeSolicitarBaixa: Boolean(usuarioData.pode_solicitar_baixa),
      podeVisualizarDevolucao: Boolean(usuarioData.pode_visualizar_devolucao),
      podeSolicitarDevolucao: Boolean(usuarioData.pode_solicitar_devolucao),
      podeSolicitarProducao: Boolean(usuarioData.pode_solicitar_producao),
      podeVisualizarProducao: Boolean(usuarioData.pode_visualizar_producao),
      podeConfirmarProducao: Boolean(usuarioData.pode_confirmar_producao),
      podeEscreverAnotarSku: Boolean(usuarioData.pode_escrever_anotar_sku),
      podeVisualizarAnotarSku: Boolean(usuarioData.pode_visualizar_anotar_sku),
      podeVisualizarConfiguracao: Boolean(usuarioData.pode_visualizar_configuracao),
      podeEditarConfiguracao: Boolean(usuarioData.pode_editar_configuracao),
      podeGerenciarFilaPedidos: Boolean(usuarioData.pode_gerenciar_fila_pedidos),
      podeSelecionarFilialFornecedor: Boolean(usuarioData.pode_selecionar_filial_fornecedor),
    } satisfies UsuarioAplicativo;
  }, []);

  const carregarUsuario = useCallback(async (nextSession: Session | null) => {
    if (signOutInFlight.current) return;
    const revision = authRevision.current;
    const request = ++usuarioRequest.current;
    const atual = () => revision === authRevision.current && request === usuarioRequest.current;
    if (!nextSession?.user.email || !nextSession.access_token) {
      setUsuario(null);
      setAccessMessage("Não foi possível identificar o e-mail do usuário autenticado.");
      return;
    }

    try {
      const resp = await fetch("/api/usuario/me", {
        headers: {
          Authorization: `Bearer ${nextSession.access_token}`,
        },
      });
      const json = await resp.json();
      if (!atual()) return;

      if (!resp.ok) {
        const usuarioFallback = await carregarUsuarioFallback(nextSession.user.email);
        if (!atual()) return;

        if (usuarioFallback) {
          setUsuario(usuarioFallback);
          setAccessMessage(null);
          return;
        }

        setUsuario(null);
        setAccessMessage(json.error ?? "Erro ao validar acesso.");
        return;
      }

      setUsuario(json as UsuarioAplicativo);
      setAccessMessage(null);
    } catch {
      if (!atual()) return;
      setUsuario(null);
      setAccessMessage("Não foi possível validar seu acesso. Verifique sua conexão e tente novamente.");
    }
  }, [carregarUsuarioFallback]);

  const refreshUsuario = useCallback(async () => {
    await carregarUsuario(session);
  }, [carregarUsuario, session]);

  const signOut = useCallback(async () => {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    invalidarConsultas();
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      invalidarConsultas();
      setSession(null);
      setUsuario(null);
      setAccessMessage(null);
      setLoading(false);
      router.replace("/login");
    } catch {
      setSignOutError("Não foi possível sair. Verifique sua conexão e tente novamente.");
    } finally {
      signOutInFlight.current = false;
      setSigningOut(false);
    }
  }, [invalidarConsultas, router]);

  useEffect(() => {
    let mounted = true;

    async function carregarSessao() {
      const revision = authRevision.current;
      setLoading(true);
      const { data } = await supabase.auth.getSession();

      if (!mounted || revision !== authRevision.current) return;

      setSession(data.session);
      if (data.session) {
        await carregarUsuario(data.session);
      } else {
        setUsuario(null);
        setAccessMessage(null);
      }

      if (!mounted || revision !== authRevision.current) return;
      setLoading(false);
    }

    carregarSessao();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted || (signOutInFlight.current && nextSession)) return;
      const revision = ++authRevision.current;
      setSession(nextSession);
      if (nextSession) {
        carregarUsuario(nextSession).finally(() => {
          if (mounted && revision === authRevision.current) setLoading(false);
        });
      } else {
        usuarioRequest.current++;
        setUsuario(null);
        setAccessMessage(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      invalidarConsultas();
      subscription.unsubscribe();
    };
  }, [carregarUsuario, invalidarConsultas]);

  useEffect(() => {
    if (loading) return;

    if (!session && !isPublicPath(pathname)) {
      const next = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (session && pathname === "/login") {
      const next = searchParams.get("next") || "/";
      router.replace(next);
    }
  }, [loading, pathname, router, searchParams, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      usuario,
      loading,
      signOut,
      signingOut,
      signOutError,
      refreshUsuario,
    }),
    [loading, refreshUsuario, session, signOut, signingOut, signOutError, usuario],
  );

  if (loading && !isPublicPath(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-sm text-slate-600">
        Validando acesso...
      </div>
    );
  }

  if (!loading && session && !usuario && !isPublicPath(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Acesso não autorizado</h1>
          <p className="mt-2 text-sm text-slate-600">{accessMessage}</p>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            aria-busy={signingOut}
            className="mt-5 min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-wait disabled:opacity-60"
          >
            {signingOut ? "Saindo…" : "Sair"}
          </button>
          {signOutError && <p role="alert" className="mt-3 text-sm text-red-700">{signOutError}</p>}
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }

  return context;
}
