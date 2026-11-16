import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { serializarMovimentacoesEstoque } from "@/lib/estoque-movimentacoes";

export async function GET(request: Request) {
  let autenticado;
  try { autenticado = await getUsuarioAutenticado(request); }
  catch { return NextResponse.json({ error: "Não autenticado." }, { status: 401 }); }
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarEstoque: true, podeEditarEstoque: true },
    });
    if (!usuario || (!usuario.podeVisualizarEstoque && !usuario.podeEditarEstoque)) {
      return NextResponse.json({ error: "Sem permissão para visualizar o estoque." }, { status: 403 });
    }

    const resumo = new URL(request.url).searchParams.get("modo") === "resumo";
    if (!autenticado.aplicativoId) return NextResponse.json({ error: "Aplicativo não configurado." }, { status: 403 });
    const [produtos, movimentacoes, configuracao] = await Promise.all([
      prisma.produto.findMany({
        where: { aplicativoId: autenticado.aplicativoId, ativo: true },
        orderBy: { sku: "asc" },
        select: {
          id: true, sku: true, imagemUrl: true, metaEstoque: true,
          produtoFornecedorOlist: { select: {
            quantidadeUsada: true,
            produtoFornecedor: { select: { nome: true, aplicativoId: true } },
          } },
        },
      }),
      resumo ? Promise.resolve([]) : prisma.movimentacaoEstoque.findMany({
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

    const totais = resumo ? await prisma.movimentacaoEstoque.groupBy({
      by: ["produtoId", "tipoMovimento"],
      where: { aplicativoId: autenticado.aplicativoId },
      _sum: { quantidade: true }, _count: { _all: true },
    }) : [];
    const mapa = new Map<string, { produto_id: string; entradas: number; saidas: number; movimentacoes: number }>();
    for (const total of totais) {
      const atual = mapa.get(total.produtoId) ?? { produto_id: total.produtoId, entradas: 0, saidas: 0, movimentacoes: 0 };
      if (total.tipoMovimento === "entrada") atual.entradas += total._sum.quantidade ?? 0;
      else atual.saidas += total._sum.quantidade ?? 0;
      atual.movimentacoes += total._count._all;
      mapa.set(total.produtoId, atual);
    }

    return NextResponse.json({
      produtos: produtos.map((produto) => ({
        id: produto.id, sku: produto.sku, imagem_url: produto.imagemUrl, meta_estoque: produto.metaEstoque,
        produto_fornecido: produto.produtoFornecedorOlist?.produtoFornecedor.aplicativoId === autenticado.aplicativoId
          ? {
              nome: produto.produtoFornecedorOlist.produtoFornecedor.nome,
              metros_por_unidade: Number(produto.produtoFornecedorOlist.quantidadeUsada),
            }
          : null,
      })),
      ...(resumo ? { resumo: [...mapa.values()] }
        : { movimentacoes: await serializarMovimentacoesEstoque(movimentacoes, autenticado.aplicativoId) }),
      metaGeral: Number(configuracao?.valor ?? 0),
    });
  } catch {
    return NextResponse.json(
      { error: "Erro ao carregar estoque." },
      { status: 500 },
    );
  }
}
