import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarCategoriasMidia: true },
    });

    if (!usuario?.podeVisualizarCategoriasMidia) {
      return NextResponse.json({ error: "Sem permissão para consultar o controle de mídia." }, { status: 403 });
    }

    const [produtos, movimentacoes, solicitacoesEmProducao] = await Promise.all([
      prisma.produto.findMany({
        where: { aplicativoId: autenticado.aplicativoId },
        orderBy: { sku: "asc" },
        select: {
          id: true,
          sku: true,
          imagemUrl: true,
          temFoto: true,
          temVideo: true,
          ativo: true,
        },
      }),
      prisma.movimentacaoEstoque.findMany({
        where: { aplicativoId: autenticado.aplicativoId },
        select: { produtoId: true, tipoMovimento: true, quantidade: true },
      }),
      prisma.solicitacaoProducao.findMany({
        where: { aplicativoId: autenticado.aplicativoId, status: "em_producao" },
        select: { id: true },
      }),
    ]);

    const idsEmProducao = solicitacoesEmProducao.map((solicitacao) => solicitacao.id);
    const produtosSolicitados = idsEmProducao.length > 0
      ? await prisma.itemSolicitacaoProducao.groupBy({
          by: ["produtoId"],
          where: {
            aplicativoId: autenticado.aplicativoId,
            solicitacaoId: { in: idsEmProducao },
          },
          _sum: { quantidadeSolicitada: true },
        })
      : [];

    const estoquePorProduto = new Map<string, number>();
    for (const movimentacao of movimentacoes) {
      const sinal = movimentacao.tipoMovimento === "entrada" ? 1 : -1;
      estoquePorProduto.set(
        movimentacao.produtoId,
        (estoquePorProduto.get(movimentacao.produtoId) ?? 0) + sinal * movimentacao.quantidade,
      );
    }
    const solicitadosPorProduto = new Map(
      produtosSolicitados.map((item) => [item.produtoId, Number(item._sum.quantidadeSolicitada ?? 0)]),
    );

    const produtosComMidia = produtos.map((produto) => {
        return {
          id: produto.id,
          sku: produto.sku,
          ativo: produto.ativo,
          fotoUrl: produto.imagemUrl,
          temFoto: produto.temFoto,
          temVideo: produto.temVideo,
          estoqueAtual: estoquePorProduto.get(produto.id) ?? 0,
          quantidadeSolicitada: solicitadosPorProduto.get(produto.id) ?? 0,
        };
      });

    produtosComMidia.sort((a, b) => {
      const prioridadeEstoque = Number(b.estoqueAtual > 0) - Number(a.estoqueAtual > 0);
      if (prioridadeEstoque !== 0) return prioridadeEstoque;
      const prioridadeSolicitado = Number(b.quantidadeSolicitada > 0) - Number(a.quantidadeSolicitada > 0);
      if (prioridadeSolicitado !== 0) return prioridadeSolicitado;
      if (a.estoqueAtual !== b.estoqueAtual) return b.estoqueAtual - a.estoqueAtual;
      if (a.quantidadeSolicitada !== b.quantidadeSolicitada) return b.quantidadeSolicitada - a.quantidadeSolicitada;
      return a.sku.localeCompare(b.sku, "pt-BR");
    });

    return NextResponse.json({
      produtos: produtosComMidia,
    });
  } catch (error) {
    console.error("Erro ao consultar mídias dos produtos:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar mídias dos produtos." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarCategoriasMidia: true },
    });
    if (!usuario?.podeVisualizarCategoriasMidia) {
      return NextResponse.json({ error: "Sem permissão para atualizar o controle de mídia." }, { status: 403 });
    }

    const body = await request.json() as { id?: unknown; campo?: unknown; valor?: unknown };
    if (typeof body.id !== "string" || !["temFoto", "temVideo"].includes(String(body.campo)) || typeof body.valor !== "boolean") {
      return NextResponse.json({ error: "Dados inválidos para atualizar a mídia." }, { status: 400 });
    }

    const produto = await prisma.produto.findFirst({
      where: { id: body.id, aplicativoId: autenticado.aplicativoId },
      select: { id: true },
    });
    if (!produto) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    await prisma.produto.update({
      where: { id: produto.id },
      data: body.campo === "temFoto" ? { temFoto: body.valor } : { temVideo: body.valor },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar mídia do produto." },
      { status: 500 },
    );
  }
}
