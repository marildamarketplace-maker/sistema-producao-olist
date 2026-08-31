import { Suspense } from "react";
import { AccessGuard } from "@/components/access-guard";
import { PesquisaEstampasClient } from "@/components/estampas/pesquisa-estampas-client";

export default function PesquisaEstampasPage() {
  return (
    <AccessGuard permissions={["podeVisualizarEstampas", "podeEditarEstampas"]}>
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando pesquisa...</p>}>
        <PesquisaEstampasClient />
      </Suspense>
    </AccessGuard>
  );
}
