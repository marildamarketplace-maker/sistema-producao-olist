"use client";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { AnotarSkuClient } from "@/components/anotar-sku-client";

export default function AnotarSkuPage() {
  const { session, usuario } = useAuth();
  const escopo = `${usuario?.aplicativo_id}:${usuario?.id}`;
  return <AccessGuard permissions={["podeEscreverAnotarSku", "podeVisualizarAnotarSku"]}>
    <AnotarSkuClient key={escopo} escopo={escopo} token={session?.access_token ?? ""}
      podeEscrever={Boolean(usuario?.podeEscreverAnotarSku)} podeVisualizar={Boolean(usuario?.podeVisualizarAnotarSku)} />
  </AccessGuard>;
}
