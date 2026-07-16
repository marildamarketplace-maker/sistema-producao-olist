import { AccessGuard } from "@/components/access-guard";
import { TiposProdutoClient } from "@/components/tipos-produto/tipos-produto-client";

export default function TiposProdutoPage() {
  return <AccessGuard permissions={["podeVisualizarTiposProduto", "podeEditarTiposProduto"]}>
    <TiposProdutoClient />
  </AccessGuard>;
}
