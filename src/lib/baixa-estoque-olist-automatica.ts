export type ItemPedidoBaixaAutomatica = {
  sku: string;
  quantidade: number;
  pedido_olist_id: string;
  item_olist_id: string;
  detalhe_pendente?: boolean;
};

export type PedidoBaixaAutomatica = {
  id: string;
  detalhe_pendente?: boolean;
  itens: ItemPedidoBaixaAutomatica[];
};

export type ResultadoBuscaBaixaAutomatica = {
  periodo_inicio: string;
  periodo_fim: string;
  pedidos_encontrados: number;
  pedidos_ignorados: number;
  pedidos_detalhe_pendente?: number;
  pedidos: PedidoBaixaAutomatica[];
};

type ItemConfirmacaoBaixaAutomatica = {
  sku: string;
  quantidade: number;
  pedidoOlistId: string;
  itemOlistId: string;
  observacao: string;
};

export type DependenciasBaixaAutomatica = {
  buscarPedidos: () => Promise<ResultadoBuscaBaixaAutomatica>;
  confirmarBaixa: (input: {
    origem: "automatica";
    observacao: string;
    periodoFimBusca: string | null;
    itens: ItemConfirmacaoBaixaAutomatica[];
  }) => Promise<{ baixa_id: string; itens: number }>;
  concluirBuscaSemBaixa: (periodoFimBusca: string) => Promise<void>;
};

export async function executarBaixaAutomaticaEstoqueOlist(
  dependencias: DependenciasBaixaAutomatica,
) {
  const resultadoBusca = await dependencias.buscarPedidos();
  const pedidosPendentes = resultadoBusca.pedidos.filter(
    (pedido) => pedido.detalhe_pendente,
  );
  const pedidosProntos = resultadoBusca.pedidos.filter(
    (pedido) => !pedido.detalhe_pendente,
  );
  const pedidoSemItens = pedidosProntos.find((pedido) => pedido.itens.length === 0);

  if (pedidoSemItens) {
    throw new Error(
      `Pedido Olist ${pedidoSemItens.id} retornou sem itens para baixa automatica.`,
    );
  }

  const itens = pedidosProntos.flatMap((pedido) =>
    pedido.itens.map((item) => ({
      sku: item.sku.trim(),
      quantidade: Number(item.quantidade),
      pedidoOlistId: pedido.id,
      itemOlistId: item.item_olist_id.trim(),
      observacao: `Baixa automatica Olist ${pedido.id} via cron`,
    })),
  );

  const itemInvalido = itens.find(
    (item) =>
      !item.sku ||
      !item.itemOlistId ||
      !Number.isSafeInteger(item.quantidade) ||
      item.quantidade <= 0,
  );

  if (itemInvalido) {
    throw new Error(
      `Pedido Olist ${itemInvalido.pedidoOlistId} retornou item invalido para baixa automatica.`,
    );
  }

  const quantidadePendentes = Math.max(
    pedidosPendentes.length,
    resultadoBusca.pedidos_detalhe_pendente ?? 0,
  );
  const buscaCompleta = quantidadePendentes === 0;
  let confirmacao: { baixa_id: string; itens: number } | null = null;

  if (itens.length > 0) {
    confirmacao = await dependencias.confirmarBaixa({
      origem: "automatica",
      observacao: "Baixa automatica Olist executada pelo cron diario.",
      periodoFimBusca: buscaCompleta ? resultadoBusca.periodo_fim : null,
      itens,
    });
  } else if (buscaCompleta) {
    await dependencias.concluirBuscaSemBaixa(resultadoBusca.periodo_fim);
  }

  return {
    periodo_inicio: resultadoBusca.periodo_inicio,
    periodo_fim: resultadoBusca.periodo_fim,
    pedidos_encontrados: resultadoBusca.pedidos_encontrados,
    pedidos_ignorados: resultadoBusca.pedidos_ignorados,
    pedidos_confirmados: pedidosProntos.length,
    pedidos_pendentes: quantidadePendentes,
    itens_baixados: confirmacao?.itens ?? 0,
    baixa_id: confirmacao?.baixa_id ?? null,
    cursor_atualizado: buscaCompleta,
  };
}
