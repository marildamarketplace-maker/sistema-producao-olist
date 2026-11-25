import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { montarDadosPedidoFila } from "./pedido-fornecedor-queue";
import { ErroFilaOlist } from "./fila-olist-cadastros";
import type { EntradaPedidoProducao } from "./pedido-producao-contrato";
import type { DadosPedidoFila } from "./fila-fornecedor-contrato";
import { montarDadosPedidoManual } from "./pedido-manual-contrato";

/** Lê somente a origem e suas associações. Nunca baixa o catálogo do fornecedor. */
export async function carregarOrigemPedidoProducao(aplicativoId: string, solicitacaoId: string,
  fornecedor: { fornecedorId: string; matrizId: string }, referenciaId: string, db: Prisma.TransactionClient = prisma) {
  const solicitacao = await db.solicitacaoProducao.findFirst({
    where: { id: solicitacaoId, aplicativoId, status: "em_producao" }, select: { observacaoGeral: true },
  });
  if (!solicitacao) throw new ErroFilaOlist("Solicitação em produção não encontrada neste aplicativo.", 404);
  const itens = await db.itemSolicitacaoProducao.findMany({
    where: { solicitacaoId, aplicativoId },
    select: { id: true, produtoId: true, sku: true, quantidadeSolicitada: true, tipoCorte: true },
    orderBy: [{ sku: "asc" }, { id: "asc" }], take: 1001,
  });
  if (!itens.length || itens.length > 1000) throw new ErroFilaOlist("A solicitação deve possuir entre 1 e 1.000 itens.", 400);
  const associacoes = await db.produtoOlistProdutoFornecedor.findMany({
    where: { produtoId: { in: [...new Set(itens.map(i => i.produtoId))] }, produtoFornecedor: { fornecedorId: fornecedor.fornecedorId, aplicativoId, tipoServico: null } },
    select: { produtoId: true, quantidadeUsada: true, produtoFornecedor: { select: { id: true, nome: true, referencia: true } } },
    orderBy: { id: "asc" }, take: 1001,
  });
  if (associacoes.length > 1000) throw new ErroFilaOlist("As associações excedem o limite de revisão da solicitação.", 409);
  let snapshot;
  try { snapshot = montarDadosPedidoFila(itens, associacoes, true); }
  catch { throw new ErroFilaOlist("A solicitação possui quantidades ou consumo inválidos.", 400); }
  const revisaoFonte = createHash("sha256").update(JSON.stringify({ itens, observacao: solicitacao.observacaoGeral })).digest("hex");
  const revisao = createHash("sha256").update(JSON.stringify({ itens, snapshot, observacao: solicitacao.observacaoGeral,
    fornecedor: { fornecedorId: fornecedor.fornecedorId, matrizId: fornecedor.matrizId }, referenciaId })).digest("hex");
  return { revisao, revisaoFonte, observacao: solicitacao.observacaoGeral,
    itens: snapshot.itens.map((item, index) => ({ id: itens[index].id, tecidoNome: item.tecido.nome,
      quantidade: item.quantidade, quantidadeTecido: item.quantidadeTecido,
      estampa: item.estampa, variante: item.variante, tamanho: item.tamanho, tipoProduto: item.tipoProduto, corteLaser: item.corteLaser })),
    originais: itens,
  };
}

/** Identidade da linha e procedência são independentes da referência de tecido. */
export function montarSnapshotPedidoProducao(entrada: EntradaPedidoProducao,
  originais: Array<{ id: string; produtoId: string; sku: string }>): DadosPedidoFila {
  const porLinha = new Map(originais.map(i => [i.id, i]));
  const snapshot = montarDadosPedidoManual(entrada);
  return { ...snapshot, itens: snapshot.itens.map(item => {
    const origem = porLinha.get(item.produtoId);
    return { ...item, sku: origem?.sku ?? "" };
  }) };
}
