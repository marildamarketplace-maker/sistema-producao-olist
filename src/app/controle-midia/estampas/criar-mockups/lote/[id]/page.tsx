import { AccessGuard } from "@/components/access-guard";
import { AcompanharLoteMockups } from "@/components/mockups/acompanhar-lote-mockups";

export default async function LoteMockupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AccessGuard permissions={["podeCriarMockups"]}>
      <AcompanharLoteMockups loteId={id} />
    </AccessGuard>
  );
}
