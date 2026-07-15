import { NextRequest, NextResponse } from "next/server";
import { buscarPedidosParaBaixaEstoqueOlist, obterPeriodoBuscaBaixaEstoque } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET() {
  try {
    const periodo = await obterPeriodoBuscaBaixaEstoque();

    return NextResponse.json({
      periodo_inicio: periodo.periodoInicio.toISOString(),
      periodo_fim: periodo.periodoFim.toISOString(),
    });
  } catch (error) {
    console.error("Erro ao carregar periodo de busca para baixa de estoque:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const usuario = await getUsuarioAutenticado(req);
    const body = await req.json().catch(() => ({}));
    const result = await buscarPedidosParaBaixaEstoqueOlist(usuario.aplicativoId, {
      periodoInicio: typeof body?.periodo_inicio === "string" ? body.periodo_inicio : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao buscar pedidos para baixa de estoque:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
