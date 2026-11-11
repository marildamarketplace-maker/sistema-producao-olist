"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/auth-provider";
import { AccessGuard } from "@/components/access-guard";
import { PageHeader } from "@/components/page-header";

export { painel, botao, secundario } from "./estilos";

export function TelaAutomatizacao({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return <AccessGuard permissions={["podeVisualizarAutomatizacao"]}>
    <div className="space-y-5">
      <PageHeader title={titulo} description={descricao} />
      {children}
    </div>
  </AccessGuard>;
}

export function useAutomatizacaoApi() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useCallback(async <T,>(caminho: string, method = "GET", dados?: object): Promise<T> => {
    const response = await fetch(`/api/automatizacao/${caminho}`, {
      method,
      headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      body: dados ? JSON.stringify(dados) : undefined,
    });
    const resposta = await response.json();
    if (!response.ok) throw new Error(resposta.error || "Falha na operação.");
    return resposta;
  }, [token]);
}

export function Feedback({ carregando, erro, sucesso }: { carregando?: boolean; erro?: string; sucesso?: string }) {
  return <>
    {carregando && <p role="status">Carregando…</p>}
    {erro && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erro}</p>}
    {sucesso && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{sucesso}</p>}
  </>;
}
