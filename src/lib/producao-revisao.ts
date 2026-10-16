import { createHash } from "node:crypto";

export type ItemRevisaoProducao = {
  id: string;
  produtoId: string;
  sku: string;
  quantidadeSolicitada: number;
  quantidadeProduzida: number;
  tipoCorte: string | null;
  observacao: string | null;
  imagemUrl: string | null;
};

export function revisaoItensProducao(status: string, itens: readonly ItemRevisaoProducao[]) {
  const ordenados = [...itens].sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({
    id: item.id, produtoId: item.produtoId, sku: item.sku,
    quantidadeSolicitada: item.quantidadeSolicitada, quantidadeProduzida: item.quantidadeProduzida,
    tipoCorte: item.tipoCorte, observacao: item.observacao, imagemUrl: item.imagemUrl,
  }));
  return createHash("sha256").update(JSON.stringify({ status, itens: ordenados })).digest("hex");
}
