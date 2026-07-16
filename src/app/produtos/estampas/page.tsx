import { AccessGuard } from "@/components/access-guard";
import { EstampasClient } from "@/components/estampas/estampas-client";

export default function EstampasPage() {
  return <AccessGuard permissions={["podeVisualizarEstampas", "podeEditarEstampas"]}>
    <EstampasClient />
  </AccessGuard>;
}
