"use client";

import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { CriarPedidoManual } from "@/components/criar-pedido-manual";

export default function CriarPedidoOlistAccessPage() {
  const { session, usuario, loading } = useAuth();
  return <AccessGuard permissions={["podeCriarOlistPedido"]}>
    {loading ? <p role="status">Carregando...</p> : session && usuario ? <CriarPedidoManual
      key={`${usuario.aplicativo_id}:${usuario.id}`} token={session.access_token} usuarioId={usuario.id}
      podeGerenciarFila={usuario.podeGerenciarFilaPedidos} /> : <p role="alert">Entre no sistema para criar pedidos.</p>}
  </AccessGuard>;
}
