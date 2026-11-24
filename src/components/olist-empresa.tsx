"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";

function chaveEmpresa(identidade: string, aplicativoId: string) {
  return `olist_empresa:${identidade}:${aplicativoId}`;
}

function lerEmpresa(chave: string) {
  try { return sessionStorage.getItem(chave); } catch { return null; }
}

function salvarEmpresa(chave: string, aplicativoId: string) {
  try { sessionStorage.setItem(chave, aplicativoId); } catch { /* Storage indisponível: mantém a seleção em memória. */ }
}

type Empresa = { id: string; nome: string };
const EmpresaContext = createContext({ aplicativoId: "", seletor: null as ReactNode });
export function useEmpresaOlist() { return useContext(EmpresaContext).aplicativoId; }

export function OlistPageHeader(props: Parameters<typeof PageHeader>[0]) {
  const { seletor } = useContext(EmpresaContext);
  return <PageHeader {...props} actions={seletor} />;
}

export function OlistEmpresa({ children }: { children: ReactNode }) {
  const { session, usuario } = useAuth();
  const identidade = session?.user.id;
  const aplicativoUsuario = usuario?.aplicativo_id;
  const [estado, setEstado] = useState<{ identidade: string; aplicativoUsuario: string; empresas: Empresa[]; aplicativoId: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const token = session?.access_token;
  useEffect(() => {
    if (!token || !identidade || !aplicativoUsuario) return;
    const controller = new AbortController();
    setErro(null);
    void (async () => {
      try {
        const response = await fetch("/api/olist/empresas", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const data = await response.json() as { empresas: Empresa[]; aplicativoId: string; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar as empresas.");
        const salva = lerEmpresa(chaveEmpresa(identidade, aplicativoUsuario));
        if (!controller.signal.aborted) setEstado((anterior) => ({
          identidade, aplicativoUsuario, empresas: data.empresas,
          aplicativoId: anterior?.identidade === identidade && anterior.aplicativoUsuario === aplicativoUsuario
            && data.empresas.some((empresa) => empresa.id === anterior.aplicativoId)
            ? anterior.aplicativoId : salva !== null && data.empresas.some((empresa) => empresa.id === salva) ? salva : data.aplicativoId,
        }));
      } catch (error) {
        if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Erro ao consultar empresas.");
      }
    })();
    return () => controller.abort();
  }, [token, identidade, aplicativoUsuario, tentativa]);
  useEffect(() => {
    if (token && estado && estado.identidade === identidade && estado.aplicativoUsuario === aplicativoUsuario) {
      salvarEmpresa(chaveEmpresa(estado.identidade, estado.aplicativoUsuario), estado.aplicativoId);
    }
  }, [estado, identidade, aplicativoUsuario, token]);
  const estadoValido = token && estado?.identidade === identidade && estado?.aplicativoUsuario === aplicativoUsuario;
  if (erro && !estadoValido) return <div role="alert" className="space-y-3"><p>{erro}</p><button type="button" className="min-h-11 rounded-md border border-slate-300 px-4" onClick={() => setTentativa((n) => n + 1)}>Tentar novamente</button></div>;
  if (!estado || !estadoValido) return <p role="status">Carregando empresas...</p>;
  const seletor = <label className="block w-56 max-w-full text-sm font-medium text-slate-700">Empresa<select className="input mt-1 min-h-11 w-full" value={estado.aplicativoId} disabled={estado.empresas.length <= 1} onChange={(event) => {
    const aplicativoId = event.target.value;
    salvarEmpresa(chaveEmpresa(estado.identidade, estado.aplicativoUsuario), aplicativoId);
    setEstado({ ...estado, aplicativoId });
  }}>{estado.empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}</select></label>;
  return <EmpresaContext.Provider value={{ aplicativoId: estado.aplicativoId, seletor }}>{erro && <p role="alert">{erro}</p>}<div key={`${identidade}:${aplicativoUsuario}:${estado.aplicativoId}`}>{children}</div></EmpresaContext.Provider>;
}
