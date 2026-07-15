"use client";

import { FormEvent, useEffect, useState } from "react";
import axios from "axios";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { useTheme } from "@/components/theme-provider";
import { supabase } from "@/lib/supabase";

const META_CONFIG_KEY = "META_GERAL_ESTOQUE";
const MINIMO_CONFIG_KEY = "MINIMO_GERAL_ESTOQUE";

export default function ConfiguracoesPage() {
  const { session, usuario } = useAuth();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [metaGeral, setMetaGeral] = useState("0");
  const [minimoGeral, setMinimoGeral] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [olistStatus, setOlistStatus] = useState("nao_conectado");
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const podeEditarConfiguracao = Boolean(usuario?.podeEditarConfiguracao);

  useEffect(() => {
    async function carregar() {
      if (!session?.access_token) return;
      setLoading(true);
      setMessage(null);
      const { data, error } = await supabase
        .from("configuracoes_sistema")
        .select("chave, valor")
        .in("chave", [META_CONFIG_KEY, MINIMO_CONFIG_KEY]);

      if (error) {
        setMessage(`Erro ao carregar configuração: ${error.message}`);
      } else {
        const configs = new Map((data ?? []).map((config) => [config.chave, config.valor]));
        setMetaGeral(String(configs.get(META_CONFIG_KEY) ?? "0"));
        setMinimoGeral(String(configs.get(MINIMO_CONFIG_KEY) ?? "0"));
      }

      const statusResp = await axios.get("/api/olist/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        validateStatus: () => true,
      });
      const statusJson = statusResp.data;
      if (statusResp.status >= 200 && statusResp.status < 300) {
        setOlistStatus(statusJson.status ?? "nao_conectado");
        setLastLoginAt(statusJson.last_login_at ?? null);
        setExpiresAt(statusJson.expires_at ?? null);
      }
      setLoading(false);
    }

    carregar();
  }, [session?.access_token]);

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!podeEditarConfiguracao) return;

    setSaving(true);
    setMessage(null);

    const metaValor = Number(metaGeral);
    const minimoValor = Number(minimoGeral);
    if (Number.isNaN(metaValor) || metaValor < 0) {
      setMessage("Informe uma meta geral válida (>= 0).");
      setSaving(false);
      return;
    }
    if (Number.isNaN(minimoValor) || minimoValor < 0) {
      setMessage("Informe um minimo geral valido (>= 0).");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("configuracoes_sistema").upsert(
      [
        {
          chave: META_CONFIG_KEY,
          valor: metaValor,
        },
        {
          chave: MINIMO_CONFIG_KEY,
          valor: minimoValor,
        },
      ],
      { onConflict: "chave" },
    );

    if (error) {
      setMessage(`Erro ao salvar configuração: ${error.message}`);
    } else {
      setMessage("Configuracoes de estoque salvas com sucesso.");
    }

    setSaving(false);
  }

  async function reconectarOlist() {
    if (!podeEditarConfiguracao) return;

    setReconnecting(true);
    setMessage(null);
    const { data: sessaoAtual } = await supabase.auth.getSession();
    const accessToken = sessaoAtual.session?.access_token;
    if (!accessToken) {
      setMessage("Sua sessão expirou. Entre novamente para conectar a Olist.");
      setReconnecting(false);
      return;
    }
    const resp = await axios.post("/api/olist/reconnect", null, {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });
    const json = resp.data;
    if (resp.status < 200 || resp.status >= 300) {
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
    <AccessGuard permissions={["podeVisualizarConfiguracao", "podeEditarConfiguracao"]}>
      <div className="space-y-8">
      <PageHeader
        title="Configurações"
        description="Defina parâmetros globais do sistema de produção e estoque."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Aparência</h3>
            <p className="mt-1 text-sm text-slate-600">
              Ajuste o tema visual usado em todas as telas do sistema.
            </p>
          </div>
          <div className="inline-flex items-center gap-3 text-sm font-medium text-slate-700">
            <span>{isDarkMode ? "Dark mode ativo" : "Dark mode inativo"}</span>
            <button
              type="button"
              role="switch"
              aria-checked={isDarkMode}
              aria-label="Alternar dark mode"
              onClick={toggleDarkMode}
              className={`theme-switch relative h-7 w-12 rounded-full transition ${isDarkMode ? "is-active" : ""}`}
            >
              <span
                className={`theme-switch-thumb absolute top-1 h-5 w-5 rounded-full shadow transition ${
                  isDarkMode ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Parametros de estoque</h3>

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
                disabled={!podeEditarConfiguracao}
                onChange={(event) => setMetaGeral(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>

            <label className="block text-sm text-slate-700">
              Minimo geral
              <input
                type="number"
                min={0}
                required
                value={minimoGeral}
                disabled={!podeEditarConfiguracao}
                onChange={(event) => setMinimoGeral(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>

            <button
              type="submit"
              disabled={saving || !podeEditarConfiguracao}
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
          disabled={reconnecting || !podeEditarConfiguracao}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {reconnecting ? "Redirecionando..." : "Reconectar Olist"}
        </button>
        <p className="text-sm text-slate-600">
          Use este botão caso a integração retorne erro 401 ou após alterar permissões do aplicativo na Olist/Tiny.
        </p>
      </section>
      </div>
    </AccessGuard>
  );
}
