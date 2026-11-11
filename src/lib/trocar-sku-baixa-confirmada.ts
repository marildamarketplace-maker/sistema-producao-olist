import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

export const trocaBaixaConfirmadaSchema = z.object({
  item_baixa_id: z.string().uuid(),
  movimentacao_id: z.string().uuid(),
  sku_anterior: z.string().trim().min(1).max(255),
  sku: z.string().trim().min(1).max(255),
}).strict();

export class TrocaBaixaError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function trocarSkuBaixaConfirmada(
  db: PrismaClient, aplicativoId: string, usuarioId: string,
  input: z.infer<typeof trocaBaixaConfirmadaSchema>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('baixa-kits-estoque', 0))::text`;
    // Mesmo bloqueio de linha do retorno: impede trocar uma saída enquanto ela é devolvida.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM public.itens_baixa_estoque_olist
      WHERE aplicativo_id = ${aplicativoId}::uuid AND id = ${input.item_baixa_id}::uuid FOR UPDATE`);
    const baixa = await tx.itemBaixaEstoqueOlist.findFirst({
      where: { id: input.item_baixa_id, aplicativoId }, include: { retornos: { select: { id: true } } },
    });
    if (!baixa) throw new TrocaBaixaError("Baixa não encontrada neste aplicativo.", 404);
    if (baixa.sku !== input.sku_anterior || baixa.movimentacaoId !== input.movimentacao_id) {
      throw new TrocaBaixaError("A baixa já foi alterada. Recarregue o histórico antes de tentar novamente.");
    }
    if (baixa.retornos.length) throw new TrocaBaixaError("Esta baixa já possui retorno registrado e não pode ter o SKU trocado.");
    if (baixa.sku === input.sku) throw new TrocaBaixaError("Informe um SKU diferente do atual.", 422);
    const produto = await tx.produto.findFirst({ where: { aplicativoId, sku: input.sku, ativo: true } });
    if (!produto) throw new TrocaBaixaError("SKU de substituição não está ativo neste aplicativo.", 422);
    const composicao = await tx.componenteKitEstoque.count({ where: { aplicativoId, kitSku: input.sku } });
    if (composicao) throw new TrocaBaixaError("No histórico, substitua por um SKU individual ou sem composição. Um kit associado exige baixa de seus componentes.", 422);
    const saidaAnterior = await tx.movimentacaoEstoque.findFirst({ where: { aplicativoId, id: baixa.movimentacaoId! } });
    if (!saidaAnterior || saidaAnterior.tipoMovimento !== "saida" || saidaAnterior.sku !== baixa.sku
      || saidaAnterior.produtoId !== baixa.produtoId || saidaAnterior.quantidade !== baixa.quantidade) {
      throw new TrocaBaixaError("O movimento original da baixa não está consistente. Revise o histórico.");
    }
    const auditoria = `Troca de SKU na baixa ${baixa.id}: ${baixa.sku} → ${produto.sku}. Responsável: ${usuarioId}.`;
    await tx.movimentacaoEstoque.create({ data: {
      aplicativoId, produtoId: saidaAnterior.produtoId, sku: baixa.sku, quantidade: baixa.quantidade,
      tipoMovimento: "entrada", origem: "TROCA_SKU_BAIXA_OLIST", referenciaId: baixa.baixaId, observacao: auditoria,
    } });
    const saida = await tx.movimentacaoEstoque.create({ data: {
      aplicativoId, produtoId: produto.id, sku: produto.sku, quantidade: baixa.quantidade,
      tipoMovimento: "saida", origem: "TROCA_SKU_BAIXA_OLIST", referenciaId: baixa.baixaId, observacao: auditoria,
    } });
    await tx.itemBaixaEstoqueOlist.update({ where: { id: baixa.id }, data: {
      skuOrigem: baixa.skuOrigem || baixa.sku, sku: produto.sku, produtoId: produto.id, movimentacaoId: saida.id,
      observacao: [baixa.observacao, auditoria].filter(Boolean).join(" | "),
    } });
    return { item_baixa_id: baixa.id, sku: produto.sku, quantidade: baixa.quantidade };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
}
