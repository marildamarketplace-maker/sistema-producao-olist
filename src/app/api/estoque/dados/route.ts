import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { observacaoMovimentacaoEstoque } from "@/lib/estoque-observacao";
import { ORIGENS_ESTOQUE_PRODUCAO } from "@/lib/producao-ajustes-estoque";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarEstoque: true, podeEditarEstoque: true },
    });
    if (!usuario || (!usuario.podeVisualizarEstoque && !usuario.podeEditarEstoque)) {
      throw new Error("Sem permissão para visualizar o estoque.");
    }

    const [produtos, movimentacoes, configuracao] = await Promise.all([
      prisma.produto.findMany({
        where: { aplicativoId: autenticado.aplicativoId, ativo: true },
        orderBy: { sku: "asc" },
        select: { id: true, sku: true, imagemUrl: true, metaEstoque: true },
      }),
      prisma.movimentacaoEstoque.findMany({
        where: { aplicativoId: autenticado.aplicativoId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, produtoId: true, sku: true, tipoMovimento: true,
          quantidade: true, origem: true, observacao: true, createdAt: true, referenciaId: true,
        },
      }),
      prisma.configuracaoSistema.findFirst({
        where: { aplicativoId: autenticado.aplicativoId, chave: "META_GERAL_ESTOQUE" },
        select: { valor: true },
      }),
    ]);

    const solicitacaoIds = [...new Set(movimentacoes.flatMap((movimento) =>
      ORIGENS_ESTOQUE_PRODUCAO.includes(movimento.origem) && movimento.referenciaId
        ? [movimento.referenciaId] : [],
    ))];
    const solicitacoes = solicitacaoIds.length > 0
      ? await prisma.solicitacaoProducao.findMany({
        where: { aplicativoId: autenticado.aplicativoId, id: { in: solicitacaoIds } },
        select: { id: true, observacaoGeral: true },
      })
      : [];
    const observacoesProducao = new Map(solicitacoes.map((solicitacao) =>
      [solicitacao.id, solicitacao.observacaoGeral],
    ));

    return NextResponse.json({
      produtos: produtos.map((produto) => ({
        id: produto.id, sku: produto.sku, imagem_url: produto.imagemUrl, meta_estoque: produto.metaEstoque,
      })),
      movimentacoes: movimentacoes.map((movimento) => ({
        id: movimento.id, produto_id: movimento.produtoId, sku: movimento.sku,
        tipo_movimento: movimento.tipoMovimento, quantidade: movimento.quantidade,
        origem: movimento.origem,
        producao_id: ORIGENS_ESTOQUE_PRODUCAO.includes(movimento.origem) && movimento.referenciaId && observacoesProducao.has(movimento.referenciaId)
          ? movimento.referenciaId : null,
        observacao: observacaoMovimentacaoEstoque(movimento, observacoesProducao),
        created_at: movimento.createdAt,
      })),
      metaGeral: Number(configuracao?.valor ?? 0),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar estoque." },
      { status: 403 },
    );
  }
}
