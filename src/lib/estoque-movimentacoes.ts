import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { observacaoMovimentacaoEstoque } from "@/lib/estoque-observacao";
import { ORIGENS_ESTOQUE_PRODUCAO } from "@/lib/producao-ajustes-estoque";

type Movimento = {
  id: string; produtoId: string; sku: string; tipoMovimento: string; quantidade: number;
  origem: string; observacao: string | null; createdAt: Date; referenciaId: string | null;
};

export async function serializarMovimentacoesEstoque(
  movimentacoes: Movimento[], aplicativoId: string,
  db: Pick<Prisma.TransactionClient, "solicitacaoProducao"> = prisma,
) {
  const solicitacaoIds = [...new Set(movimentacoes.flatMap(movimento =>
    ORIGENS_ESTOQUE_PRODUCAO.includes(movimento.origem) && movimento.referenciaId
      ? [movimento.referenciaId] : [],
  ))];
  const solicitacoes = solicitacaoIds.length > 0
    ? await db.solicitacaoProducao.findMany({
      where: { aplicativoId, id: { in: solicitacaoIds } },
      select: { id: true, observacaoGeral: true },
    }) : [];
  const observacoesProducao = new Map(solicitacoes.map(solicitacao =>
    [solicitacao.id, solicitacao.observacaoGeral],
  ));
  return movimentacoes.map(movimento => ({
    id: movimento.id, produto_id: movimento.produtoId, sku: movimento.sku,
    tipo_movimento: movimento.tipoMovimento, quantidade: movimento.quantidade,
    origem: movimento.origem,
    producao_id: ORIGENS_ESTOQUE_PRODUCAO.includes(movimento.origem) && movimento.referenciaId && observacoesProducao.has(movimento.referenciaId)
      ? movimento.referenciaId : null,
    observacao: observacaoMovimentacaoEstoque(movimento, observacoesProducao),
    created_at: movimento.createdAt,
  }));
}
