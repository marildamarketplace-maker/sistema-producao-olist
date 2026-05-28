"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type UsuarioAplicativo = {
  id: string;
  nome: string;
  email: string;
  aplicativo_id: string;
  aplicativo?: {
    nome: string;
  } | null;
};

type UsuarioAplicativoResponse = Omit<UsuarioAplicativo, "aplicativo"> & {
  aplicativo?: { nome: string } | { nome: string }[] | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  usuario: UsuarioAplicativo | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUsuario: () => Promise<void>;
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

  const carregarUsuario = useCallback(async (userEmail: string | undefined) => {
    if (!userEmail) {
      setUsuario(null);
      setAccessMessage("Não foi possível identificar o e-mail do usuário autenticado.");
      return;
    }

    const { data, error } = await supabase
      .from("usuario")
      .select("id, nome, email, aplicativo_id, aplicativo(nome)")
      .eq("email", userEmail)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      setUsuario(null);
      setAccessMessage(`Erro ao validar acesso: ${error.message}`);
      return;
    }

    if (!data) {
      setUsuario(null);
      setAccessMessage("Usuário autenticado, mas sem cadastro ativo neste aplicativo.");
      return;
    }

    const usuarioData = data as UsuarioAplicativoResponse;
    const aplicativo = Array.isArray(usuarioData.aplicativo)
      ? usuarioData.aplicativo[0] ?? null
      : usuarioData.aplicativo ?? null;

    setUsuario({
      id: usuarioData.id,
      nome: usuarioData.nome,
      email: usuarioData.email,
      aplicativo_id: usuarioData.aplicativo_id,
      aplicativo,
    });
    setAccessMessage(null);
  }, []);

  const refreshUsuario = useCallback(async () => {
    await carregarUsuario(session?.user.email);
  }, [carregarUsuario, session?.user.email]);

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
        await carregarUsuario(data.session.user.email);
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
        carregarUsuario(nextSession.user.email).finally(() => setLoading(false));
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
