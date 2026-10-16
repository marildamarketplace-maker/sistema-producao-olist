import { DetalhesProducaoClient } from "@/components/detalhes-producao-client";

export default async function DetalhesProducaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalhesProducaoClient id={id} />;
}
