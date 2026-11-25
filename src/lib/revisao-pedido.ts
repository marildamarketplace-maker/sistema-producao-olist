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

/** Um card por produto; modalidades, tipos e preços ficam em seções internas. */
export function agruparProdutosRevisao(itens: ItemPedidoManual[], produtos: Array<{ tecidoId: string; id: number; preco: number | null }>) {
  const cards = new Map<string, { chave: string; nome: string; produtoId: number; pecas: number; metros: number; tipos: ReturnType<typeof agruparRevisaoPedido> }>();
  for (const tipo of agruparRevisaoPedido(itens, produtos)) {
    const nome = tipo.itens[0].tecidoNome;
    const chave = JSON.stringify([tipo.produtoId || null, tipo.produtoId ? null : nome]);
    const card = cards.get(chave) ?? { chave, nome, produtoId: tipo.produtoId, pecas: 0, metros: 0, tipos: [] };
    card.pecas += tipo.pecas;
    card.metros = Number((card.metros + tipo.metros).toFixed(6));
    card.tipos.push(tipo);
    cards.set(chave, card);
  }
  return [...cards.values()];
}
