import { GeradorCsvOlistClient } from "@/components/gerador-csv-olist/gerador-csv-olist-client";
import { AccessGuard } from "@/components/access-guard";

export default function GeradorCsvOlistPage() {
  return (
    <AccessGuard permissions={["podeEditarEstoque"]}>
      <GeradorCsvOlistClient />
    </AccessGuard>
  );
}
