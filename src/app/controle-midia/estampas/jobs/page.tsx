import { AccessGuard } from "@/components/access-guard";
import { EstampaJobsClient } from "@/components/estampas/estampa-jobs-client";

export default function EstampaJobsControleMidiaPage() {
  return (
    <AccessGuard permissions={["podeVisualizarEstampas", "podeEditarEstampas"]}>
      <EstampaJobsClient />
    </AccessGuard>
  );
}
