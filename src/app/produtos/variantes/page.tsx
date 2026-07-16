import { AccessGuard } from "@/components/access-guard";
import { VariantesClient } from "@/components/variantes/variantes-client";

export default function VariantesPage() {
  return <AccessGuard permissions={["podeVisualizarVariantes", "podeEditarVariantes"]}><VariantesClient /></AccessGuard>;
}
