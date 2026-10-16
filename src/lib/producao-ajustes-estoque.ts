export const ORIGENS_ESTOQUE_PRODUCAO = ["PRODUCAO", "AJUSTE_PRODUCAO", "CANCELAMENTO_PRODUCAO"];

type Movimento = { produtoId: string; sku: string; tipoMovimento: string; quantidade: number };
type TotalProduto = { produtoId: string; sku: string; quantidade: number };

export function saldoMovimentacoesProducao(movimentos: readonly Movimento[]): TotalProduto[] {
  const totais = new Map<string, TotalProduto>();
  for (const movimento of movimentos) {
    const atual = totais.get(movimento.produtoId) ?? { produtoId: movimento.produtoId, sku: movimento.sku, quantidade: 0 };
    atual.quantidade += movimento.tipoMovimento === "entrada" ? movimento.quantidade : -movimento.quantidade;
    totais.set(movimento.produtoId, atual);
  }
  return [...totais.values()];
}

export function calcularAjustesEstoqueProducao(atual: readonly TotalProduto[], desejado: readonly TotalProduto[]) {
  const saldos = new Map(atual.map((item) => [item.produtoId, { ...item, quantidade: -item.quantidade }]));
  for (const item of desejado) {
    const saldo = saldos.get(item.produtoId) ?? { ...item, quantidade: 0 };
    saldo.quantidade += item.quantidade;
    saldo.sku = item.sku;
    saldos.set(item.produtoId, saldo);
  }
  return [...saldos.values()].flatMap((saldo) => {
    const registros: Movimento[] = [];
    let quantidade = Math.abs(saldo.quantidade);
    // Cada movimento usa Int no banco, mesmo quando um produto aparece em vários itens.
    while (quantidade > 0) {
      const parcela = Math.min(quantidade, 2_147_483_647);
      registros.push({ produtoId: saldo.produtoId, sku: saldo.sku, tipoMovimento: saldo.quantidade > 0 ? "entrada" : "saida", quantidade: parcela });
      quantidade -= parcela;
    }
    return registros;
  });
}
