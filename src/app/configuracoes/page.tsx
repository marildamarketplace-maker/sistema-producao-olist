"use client";

import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

const CONFIG_KEY = "META_GERAL_ESTOQUE";

export default function ConfiguracoesPage() {
  const [metaGeral, setMetaGeral] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [olistStatus, setOlistStatus] = useState("nao_conectado");
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    async function carregar() {
      setLoading(true);
      setMessage(null);
      const { data, error } = await supabase
        .from("configuracoes_sistema")
        .select("id, valor")
        .eq("chave", CONFIG_KEY)
        .maybeSingle();

      if (error) {
        setMessage(`Erro ao carregar configuração: ${error.message}`);
      } else if (data?.valor) {
        setMetaGeral(String(data.valor));
      }

      const statusResp = await fetch("/api/olist/status", { cache: "no-store" });
      const statusJson = await statusResp.json();
      if (statusResp.ok) {
        setOlistStatus(statusJson.status ?? "nao_conectado");
        setLastLoginAt(statusJson.last_login_at ?? null);
        setExpiresAt(statusJson.expires_at ?? null);
      }
      setLoading(false);
    }

    carregar();
  }, []);

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    const valor = Number(metaGeral);
    if (Number.isNaN(valor) || valor < 0) {
      setMessage("Informe uma meta geral válida (>= 0).");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("configuracoes_sistema").upsert(
      {
        chave: CONFIG_KEY,
        valor,
      },
      { onConflict: "chave" },
    );

    if (error) {
      setMessage(`Erro ao salvar configuração: ${error.message}`);
    } else {
      setMessage("Meta geral de estoque salva com sucesso.");
    }

    setSaving(false);
  }

  async function reconectarOlist() {
    setReconnecting(true);
    setMessage(null);
    const resp = await fetch("/api/olist/reconnect", { method: "POST" });
    const json = await resp.json();
    if (!resp.ok) {
      setMessage(`Erro ao reconectar Olist: ${json.error ?? "desconhecido"}`);
      setReconnecting(false);
      return;
    }

    window.location.href = json.login_url ?? "/api/olist/login";
  }

  function labelStatus(status: string) {
    if (status === "conectado") return "Conectado";
    if (status === "expirado") return "Expirado";
    if (status === "erro_autenticacao") return "Erro de autenticação";
    return "Não conectado";
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Configurações"
        description="Defina parâmetros globais do sistema de produção e estoque."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Meta geral de estoque</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando...</p>
        ) : (
          <form className="max-w-md space-y-4" onSubmit={salvar}>
            <label className="block text-sm text-slate-700">
              Meta geral
              <input
                type="number"
                min={0}
                required
                value={metaGeral}
                onChange={(event) => setMetaGeral(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar configuração"}
            </button>
          </form>
        )}

        {message && <p className="mt-4 text-sm text-slate-700">{message}</p>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Integração Olist</h3>
        <p className="text-sm text-slate-700">Status: <strong>{labelStatus(olistStatus)}</strong></p>
        <p className="text-sm text-slate-700">Último login realizado: {lastLoginAt ? new Date(lastLoginAt).toLocaleString("pt-BR") : "-"}</p>
        <p className="text-sm text-slate-700">Data de expiração do token: {expiresAt ? new Date(expiresAt).toLocaleString("pt-BR") : "-"}</p>
        <button
          type="button"
          onClick={reconectarOlist}
          disabled={reconnecting}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {reconnecting ? "Redirecionando..." : "Reconectar Olist"}
        </button>
        <p className="text-sm text-slate-600">
          Use este botão caso a integração retorne erro 401 ou após alterar permissões do aplicativo na Olist/Tiny.
        </p>
      </section>
    </div>
  );
}
