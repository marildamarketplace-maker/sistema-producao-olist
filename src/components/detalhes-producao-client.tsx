"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccessGuard } from "./access-guard";
import { useAuth } from "./auth-provider";
import { DetalhesProducao } from "./detalhes-producao";
import { EditarItensProducao } from "./editar-itens-producao";
import type { DetalheProducao } from "@/lib/producao-detalhes-contrato";

export function DetalhesProducaoClient({ id }: { id: string }) {
  return <AccessGuard permissions={["podeSolicitarProducao", "podeVisualizarProducao"]}><ConteudoDetalhe key={id} id={id} /></AccessGuard>;
}

function ConteudoDetalhe({ id }: { id: string }) {
  const { session, usuario } = useAuth();
  const token = session?.access_token;
  const [producao, setProducao] = useState<DetalheProducao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [editando, setEditando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const [carregandoFoto, setCarregandoFoto] = useState(false);
  const fotoRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setProducao(null);
    setErro(null);
    if (!token) { setErro("Sessão expirada. Entre novamente."); return; }
    void (async () => {
      try {
        const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store",
        });
        const dados = await response.json() as { producao?: DetalheProducao; error?: string };
        if (!response.ok || !dados.producao) throw new Error(dados.error ?? "Não foi possível carregar a produção.");
        if (!controller.signal.aborted) setProducao(dados.producao);
      } catch (error) {
        if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Não foi possível carregar a produção.");
      }
    })();
    return () => controller.abort();
  }, [id, token, tentativa]);

  useEffect(() => {
    setFotoUrl(null);
    setErroFoto(null);
    setCarregandoFoto(false);
    return () => { fotoRequest.current?.abort(); fotoRequest.current = null; };
  }, [id, token]);
  useEffect(() => () => { if (fotoUrl) URL.revokeObjectURL(fotoUrl); }, [fotoUrl]);

  async function carregarFoto() {
    if (fotoRequest.current || !token) return;
    const controller = new AbortController();
    fotoRequest.current = controller;
    setCarregandoFoto(true);
    setErroFoto(null);
    try {
      const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(id)}/evidencia`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store",
      });
      if (!response.ok) {
        const erro = await response.json() as { error?: string };
        throw new Error(erro.error ?? "Não foi possível carregar a evidência.");
      }
      const blob = await response.blob();
      if (!controller.signal.aborted) setFotoUrl(URL.createObjectURL(blob));
    } catch (error) {
      if (!controller.signal.aborted) setErroFoto(error instanceof Error ? error.message : "Não foi possível carregar a evidência.");
    } finally {
      if (!controller.signal.aborted) { fotoRequest.current = null; setCarregandoFoto(false); }
    }
  }

  if (erro) return <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">{sucesso && <p role="status" className="text-sm text-slate-700">{sucesso}</p>}<p role="alert" className="text-sm text-red-700">{erro}</p><div className="flex flex-wrap gap-3"><button type="button" onClick={() => setTentativa((valor) => valor + 1)} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Tentar novamente</button><Link href="/solicitacoes-producao" className="inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm text-slate-700 underline">Voltar para Anotar produção</Link></div></section>;
  if (!producao) return <p role="status" className="text-sm text-slate-600">Carregando detalhes da produção...</p>;
  function recarregar() { setEditando(false); setTentativa((atual) => atual + 1); }
  return <>
    {sucesso && <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sucesso}</p>}
    <DetalhesProducao producao={producao} fotoUrl={fotoUrl} carregandoFoto={carregandoFoto} erroFoto={erroFoto} onCarregarFoto={() => { void carregarFoto(); }}
      onEditar={usuario?.podeSolicitarProducao && !editando ? () => { setSucesso(null); setEditando(true); } : undefined}
      editorItens={editando && token && usuario?.podeSolicitarProducao ? <EditarItensProducao key={`${id}:${producao.revisao}`} producao={producao} token={token} onCancelar={() => setEditando(false)} onRecarregar={recarregar} onSalvo={() => { setSucesso("Itens atualizados com sucesso."); recarregar(); }} /> : undefined}
    />
  </>;
}
