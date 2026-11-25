import type { ItemPedidoManual } from "./pedido-manual-contrato";

/** Agrupa apenas a apresentação; preserva identidade e detalhes de cada linha. */
export function agruparRevisaoPedido(itens: ItemPedidoManual[], produtos: Array<{ tecidoId: string; id: number; preco: number | null }>) {
  const associacoes = new Map(produtos.map(p => [p.tecidoId, p]));
  const grupos = new Map<string, { chave: string; produtoId: number; preco: number | null; itens: ItemPedidoManual[]; pecas: number; metros: number }>();
  for (const item of itens) {
    const produto = associacoes.get(item.id);
    const chave = JSON.stringify([produto?.id || item.tecidoNome, item.modalidade ?? "PRODUTO_SUBLIMADO", item.tipoProduto, produto?.preco ?? null]);
    const grupo = grupos.get(chave) ?? { chave, produtoId: produto?.id ?? 0, preco: produto?.preco ?? null, itens: [], pecas: 0, metros: 0 };
    grupo.itens.push(item);
    if (!item.modalidade || item.modalidade === "PRODUTO_SUBLIMADO") grupo.pecas += item.quantidade;
    grupo.metros += item.quantidadeTecido;
    grupos.set(chave, grupo);
  }
  return [...grupos.values()];
}
