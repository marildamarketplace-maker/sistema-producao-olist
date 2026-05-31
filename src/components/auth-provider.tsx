"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { PermissionSet } from "@/lib/permissions";

type UsuarioAplicativo = {
  id: string;
  nome: string;
  email: string;
  aplicativo_id: string;
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
  refreshUsuario: () => Promise<void>;
};

type UsuarioAplicativoFallbackResponse = {
  id: string;
  nome: string;
  email: string;
  aplicativo_id: string;
  aplicativo?: { nome: string } | { nome: string }[] | null;
  pode_visualizar_estoque: boolean;
  pode_editar_estoque: boolean;
  pode_visualizar_baixa: boolean;
  pode_solicitar_baixa: boolean;
  pode_visualizar_devolucao: boolean;
  pode_solicitar_devolucao: boolean;
  pode_solicitar_producao: boolean;
  pode_visualizar_producao: boolean;
  pode_confirmar_producao: boolean;
  pode_visualizar_configuracao: boolean;
  pode_editar_configuracao: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const publicPaths = new Set(["/login"]);

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

  const carregarUsuarioFallback = useCallback(async (email: string) => {
    const { data, error } = await supabase
      .from("usuario")
      .select(`
        id,
        nome,
        email,
        aplicativo_id,
        pode_visualizar_estoque,
        pode_editar_estoque,
        pode_visualizar_baixa,
        pode_solicitar_baixa,
        pode_visualizar_devolucao,
        pode_solicitar_devolucao,
        pode_solicitar_producao,
        pode_visualizar_producao,
        pode_confirmar_producao,
        pode_visualizar_configuracao,
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
      aplicativo,
      podeVisualizarEstoque: Boolean(usuarioData.pode_visualizar_estoque),
      podeEditarEstoque: Boolean(usuarioData.pode_editar_estoque),
      podeVisualizarBaixa: Boolean(usuarioData.pode_visualizar_baixa),
      podeSolicitarBaixa: Boolean(usuarioData.pode_solicitar_baixa),
      podeVisualizarDevolucao: Boolean(usuarioData.pode_visualizar_devolucao),
      podeSolicitarDevolucao: Boolean(usuarioData.pode_solicitar_devolucao),
      podeSolicitarProducao: Boolean(usuarioData.pode_solicitar_producao),
      podeVisualizarProducao: Boolean(usuarioData.pode_visualizar_producao),
      podeConfirmarProducao: Boolean(usuarioData.pode_confirmar_producao),
      podeVisualizarConfiguracao: Boolean(usuarioData.pode_visualizar_configuracao),
      podeEditarConfiguracao: Boolean(usuarioData.pode_editar_configuracao),
    } satisfies UsuarioAplicativo;
  }, []);

  const carregarUsuario = useCallback(async (nextSession: Session | null) => {
    if (!nextSession?.user.email || !nextSession.access_token) {
      setUsuario(null);
      setAccessMessage("Não foi possível identificar o e-mail do usuário autenticado.");
      return;
    }

    const resp = await fetch("/api/usuario/me", {
      headers: {
        Authorization: `Bearer ${nextSession.access_token}`,
      },
    });
    const json = await resp.json();

    if (!resp.ok) {
      const usuarioFallback = await carregarUsuarioFallback(nextSession.user.email);

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
  }, [carregarUsuarioFallback]);

  const refreshUsuario = useCallback(async () => {
    await carregarUsuario(session);
  }, [carregarUsuario, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUsuario(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    let mounted = true;

    async function carregarSessao() {
      setLoading(true);
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(data.session);
      if (data.session) {
        await carregarUsuario(data.session);
      } else {
        setUsuario(null);
        setAccessMessage(null);
      }

      if (!mounted) return;
      setLoading(false);
    }

    carregarSessao();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        carregarUsuario(nextSession).finally(() => setLoading(false));
      } else {
        setUsuario(null);
        setAccessMessage(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [carregarUsuario]);

  useEffect(() => {
    if (loading) return;

    if (!session && !isPublicPath(pathname)) {
      const next = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (session && isPublicPath(pathname)) {
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
      refreshUsuario,
    }),
    [loading, refreshUsuario, session, signOut, usuario],
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
            className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Sair
          </button>
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
