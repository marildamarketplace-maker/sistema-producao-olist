import { Suspense } from "react";
import { AccessGuard } from "@/components/access-guard";
import { ConfigurarFilaMockups } from "@/components/mockups/configurar-fila-mockups";

export default function CriarMockupsPage() {
  return (
    <AccessGuard permissions={["podeEditarEstampas"]}>
      <Suspense fallback={<p role="status" className="text-sm text-slate-600">Carregando configuração…</p>}>
        <ConfigurarFilaMockups />
      </Suspense>
    </AccessGuard>
  );
}
