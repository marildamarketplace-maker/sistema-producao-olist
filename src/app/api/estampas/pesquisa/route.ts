import { entradaParametrosEstampas } from "@/services/parametrosPesquisaEstampas";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import {
  obterFacetasPesquisaEstampas,
  pesquisarEstampasCatalogo,
} from "@/services/pesquisarEstampasCatalogoService";

export async function GET(request: NextRequest) {
  try {
    await autorizarPesquisa(request);
    if (request.nextUrl.searchParams.get("facetas") === "1") {
      return NextResponse.json({ facetas: await obterFacetasPesquisaEstampas(request.nextUrl.searchParams.get("status") || "COMPLETED") });
    }

    return NextResponse.json(await pesquisarEstampasCatalogo(entradaParametrosEstampas(request.nextUrl.searchParams)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao pesquisar estampas." },
      { status: 400 },
    );
  }
}

async function autorizarPesquisa(request: Request) {
  const autenticado = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { podeVisualizarEstampas: true, podeEditarEstampas: true, podeCriarMockups: true },
  });
  if (!usuario || (!usuario.podeVisualizarEstampas && !usuario.podeEditarEstampas && !usuario.podeCriarMockups)) {
    throw new Error("Sem permissão para pesquisar estampas.");
  }
}
