import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, podeVisualizarProducao: true },
    });
    if (!usuario || (!usuario.podeSolicitarProducao && !usuario.podeVisualizarProducao)) {
      throw new Error("Sem permissão para consultar produtos.");
    }

    const [produtos, tiposProduto, tamanhos] = await Promise.all([
      prisma.produto.findMany({
        where: { aplicativoId: autenticado.aplicativoId, ativo: true },
        orderBy: { sku: "asc" },
        select: { id: true, sku: true, imagemUrl: true },
      }),
      prisma.tipoProduto.findMany({
        orderBy: { titulo: "asc" },
        select: { id: true, sku: true, titulo: true },
      }),
      prisma.tamanho.findMany({
        orderBy: { titulo: "asc" },
        select: { id: true, sku: true, titulo: true },
      }),
    ]);

    return NextResponse.json({
      produtos: produtos.map((produto) => ({
        id: produto.id,
        sku: produto.sku,
        imagem_url: produto.imagemUrl,
      })),
      tiposProduto: tiposProduto.map((tipo) => ({
        id: tipo.id,
        codigo: tipo.sku,
        nome: tipo.titulo,
      })),
      tamanhos: tamanhos.map((tamanho) => ({
        id: tamanho.id,
        codigo: tamanho.sku,
        descricao: tamanho.titulo,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar produtos." },
      { status: 403 },
    );
  }
}
