"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { CriarPedidoManual } from "@/components/criar-pedido-manual";

function CriarPedidoOlistConteudo() {
  const { session, usuario, loading } = useAuth();
  const params = useSearchParams();
  // Um parâmetro vazio continua no contexto de produção e será recusado pela API.
  const solicitacaoId = params.has("solicitacaoId") ? params.get("solicitacaoId") || "invalida" : undefined;
  return <AccessGuard permissions={[solicitacaoId ? "podeSolicitarProducao" : "podeCriarOlistPedido"]}>
    {loading ? <p role="status">Carregando...</p> : session && usuario ? <CriarPedidoManual
      key={`${usuario.aplicativo_id}:${usuario.id}:${solicitacaoId ?? "manual"}`} solicitacaoId={solicitacaoId} token={session.access_token} usuarioId={usuario.id}
      podeGerenciarFila={usuario.podeGerenciarFilaPedidos} /> : <p role="alert">Entre no sistema para criar pedidos.</p>}
  </AccessGuard>;
}

export default function CriarPedidoOlistAccessPage() {
  return <Suspense fallback={<p role="status">Carregando...</p>}><CriarPedidoOlistConteudo /></Suspense>;
}
