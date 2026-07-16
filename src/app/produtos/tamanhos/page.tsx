import { AccessGuard } from "@/components/access-guard";
import { TamanhosClient } from "@/components/tamanhos/tamanhos-client";

export default function TamanhosPage() {
  return <AccessGuard permissions={["podeVisualizarTamanhos", "podeEditarTamanhos"]}>
    <TamanhosClient />
  </AccessGuard>;
}
