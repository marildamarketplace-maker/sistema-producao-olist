"use client";

import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { FilaPedidosFornecedorClient } from "@/components/fila-pedidos-fornecedor-client";
import { PageHeader } from "@/components/page-header";

export default function FilaPedidosFornecedorPage() {
  const { session, usuario, loading } = useAuth();
  if (loading) return <p role="status" className="text-sm text-slate-600">Carregando...</p>;
  return (
    <AccessGuard permissions={["podeEditarConfiguracao"]}>
      <PageHeader title="Fila de pedidos" description="Consulte os pedidos recebidos e direcione cada um para uma filial do seu aplicativo." />
      {session && usuario?.podeEditarConfiguracao ? <FilaPedidosFornecedorClient key={usuario.aplicativo_id} token={session.access_token} /> : <p role="alert" className="text-sm text-red-700">Entre no sistema para acessar a fila.</p>}
    </AccessGuard>
  );
}
