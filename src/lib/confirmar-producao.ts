import { Prisma } from "@prisma/client";

const QUANTIDADE_MAXIMA = 2_147_483_647;

export type ItemConfirmacaoProducao = {
  id: string;
  quantidadeProduzida: number;
};

export function normalizarItensConfirmacaoProducao(
  itensInformados: unknown,
): ItemConfirmacaoProducao[] {
  if (!Array.isArray(itensInformados) || itensInformados.length === 0) {
    throw new Error("Informe os itens da solicitação.");
  }
  if (itensInformados.length > 500) {
    throw new Error("A confirmação excede o limite de 500 itens.");
  }

  const itens = itensInformados.map((item) => {
    const registro = item && typeof item === "object"
      ? item as Record<string, unknown>
      : {};
    return {
      id: typeof registro.id === "string" ? registro.id.trim() : "",
      quantidadeProduzida: Number(registro.quantidadeProduzida),
    };
  });

  if (
    itens.some(
      (item) =>
        !item.id
        || !Number.isSafeInteger(item.quantidadeProduzida)
        || item.quantidadeProduzida < 0
        || item.quantidadeProduzida > QUANTIDADE_MAXIMA,
    )
  ) {
    throw new Error(
      `Informe quantidades inteiras entre 0 e ${QUANTIDADE_MAXIMA.toLocaleString("pt-BR")}.`,
    );
  }
  if (new Set(itens.map((item) => item.id)).size !== itens.length) {
    throw new Error("Existem itens duplicados na confirmação.");
  }

  return itens;
}

export async function confirmarEntregaProducao(input: {
  aplicativoId: string;
  solicitacaoId: string;
  itens: ItemConfirmacaoProducao[];
}) {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$transaction(async (tx) => {
    const solicitacao = await tx.solicitacaoProducao.findFirst({
      where: {
        id: input.solicitacaoId,
        aplicativoId: input.aplicativoId,
        status: "em_producao",
      },
      select: { id: true },
    });

    if (!solicitacao) {
      throw new Error("Solicitação não encontrada ou já confirmada.");
    }

    const itensCadastrados = await tx.itemSolicitacaoProducao.findMany({
      where: {
        solicitacaoId: input.solicitacaoId,
        aplicativoId: input.aplicativoId,
      },
      select: { id: true, produtoId: true, sku: true },
    });
    const idsInformados = new Set(input.itens.map((item) => item.id));
    if (
      itensCadastrados.length !== input.itens.length
      || itensCadastrados.some((item) => !idsInformados.has(item.id))
    ) {
      throw new Error(
        "Os itens da solicitação mudaram. Recarregue a página e tente novamente.",
      );
    }

    const produtosAtivos = await tx.produto.findMany({
      where: {
        id: { in: itensCadastrados.map((item) => item.produtoId) },
        aplicativoId: input.aplicativoId,
        ativo: true,
      },
      select: { id: true },
    });
    const produtosAtivosIds = new Set(produtosAtivos.map((produto) => produto.id));
    const skusInvalidos = [
      ...new Set(
        itensCadastrados
          .filter((item) => !produtosAtivosIds.has(item.produtoId))
          .map((item) => item.sku),
      ),
    ];
    if (skusInvalidos.length > 0) {
      throw new Error(
        `Não foi possível confirmar: produtos inexistentes ou inativos: ${skusInvalidos.join(", ")}.`,
      );
    }

    const quantidadePorItem = new Map(
      input.itens.map((item) => [item.id, item.quantidadeProduzida]),
    );
    for (const item of itensCadastrados) {
      await tx.itemSolicitacaoProducao.update({
        where: { id: item.id },
        data: { quantidadeProduzida: quantidadePorItem.get(item.id) ?? 0 },
      });
    }

    const movimentacoes = itensCadastrados.flatMap((item) => {
      const quantidade = quantidadePorItem.get(item.id) ?? 0;
      return quantidade > 0
        ? [{
            produtoId: item.produtoId,
            sku: item.sku,
            tipoMovimento: "entrada",
            quantidade,
            origem: "PRODUCAO",
            referenciaId: input.solicitacaoId,
            observacao: "Entrada por confirmação de produção",
            aplicativoId: input.aplicativoId,
          }]
        : [];
    });
    if (movimentacoes.length > 0) {
      await tx.movimentacaoEstoque.createMany({ data: movimentacoes });
    }

    await tx.solicitacaoProducao.update({
      where: { id: input.solicitacaoId },
      data: { status: "concluida" },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
