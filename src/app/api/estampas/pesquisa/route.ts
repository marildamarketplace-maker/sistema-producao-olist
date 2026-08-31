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
      return NextResponse.json({ facetas: await obterFacetasPesquisaEstampas() });
    }

    const params = request.nextUrl.searchParams;
    return NextResponse.json(await pesquisarEstampasCatalogo({
      consulta: params.get("q") ?? undefined,
      codigo: params.get("codigo") ?? undefined,
      variante: params.get("variante") ?? undefined,
      tema: params.get("tema") ?? undefined,
      cores: params.getAll("cor"),
      palavraChave: params.get("palavraChave") ?? undefined,
      elementoVisual: params.get("elementoVisual") ?? undefined,
      categoria: params.get("categoria") ?? undefined,
      ocasiao: params.get("ocasiao") ?? undefined,
      publicoSugerido: params.get("publicoSugerido") ?? undefined,
      contextoUso: params.get("contextoUso") ?? undefined,
      afinidadeVisual: params.get("afinidadeVisual") ?? undefined,
      padraoTextil: params.get("padraoTextil") ?? undefined,
      tipoImagem: params.get("tipoImagem") ?? undefined,
      suporteAplicacao: params.get("suporteAplicacao") ?? undefined,
      conteudoImagem: params.get("conteudoImagem") ?? undefined,
      status: params.get("status") ?? undefined,
      ordenacao: params.get("ordenacao") ?? undefined,
      pagina: numero(params.get("pagina"), 1),
      porPagina: numero(params.get("porPagina"), 24),
    }));
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
    select: { podeVisualizarEstampas: true, podeEditarEstampas: true },
  });
  if (!usuario || (!usuario.podeVisualizarEstampas && !usuario.podeEditarEstampas)) {
    throw new Error("Sem permissão para pesquisar estampas.");
  }
}

function numero(valor: string | null, fallback: number) {
  if (valor === null) return fallback;
  const resultado = Number(valor);
  if (!Number.isInteger(resultado)) throw new Error("Parâmetro numérico inválido.");
  return resultado;
}
