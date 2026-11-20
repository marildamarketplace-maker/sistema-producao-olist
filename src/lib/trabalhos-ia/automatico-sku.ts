import type { Prisma } from "@prisma/client";
import { bancoNaTransacaoIa } from "./banco";
import { TIPO_RELATORIO_SKU, type EscopoIa } from "./contrato";
import { criarRegistroIa } from "./registro";
import { relatorioSkuIa } from "./relatorio-sku";
import { criarServicoTrabalhosIa } from "./servico";

const registro = criarRegistroIa([relatorioSkuIa]);

/** Resultado e solicitação IA são confirmados ou desfeitos juntos. */
export function solicitarRelatorioSkuAutomatico(tx: Prisma.TransactionClient, escopo: EscopoIa, buscaId: string, jobId: string) {
  const servico = criarServicoTrabalhosIa(bancoNaTransacaoIa(tx), registro);
  return servico.solicitarAutomatico(escopo, TIPO_RELATORIO_SKU, buscaId, jobId);
}
