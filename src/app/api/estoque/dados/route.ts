import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

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
          quantidade: true, origem: true, observacao: true, createdAt: true,
        },
      }),
      prisma.configuracaoSistema.findFirst({
        where: { aplicativoId: autenticado.aplicativoId, chave: "META_GERAL_ESTOQUE" },
        select: { valor: true },
      }),
    ]);

    return NextResponse.json({
      produtos: produtos.map((produto) => ({
        id: produto.id, sku: produto.sku, imagem_url: produto.imagemUrl, meta_estoque: produto.metaEstoque,
      })),
      movimentacoes: movimentacoes.map((movimento) => ({
        id: movimento.id, produto_id: movimento.produtoId, sku: movimento.sku,
        tipo_movimento: movimento.tipoMovimento, quantidade: movimento.quantidade,
        origem: movimento.origem, observacao: movimento.observacao, created_at: movimento.createdAt,
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
