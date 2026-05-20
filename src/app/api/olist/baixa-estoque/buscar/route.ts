import { NextResponse } from "next/server";
import { buscarPedidosParaBaixaEstoqueOlist } from "@/lib/olist";

export async function POST() {
  try {
    const result = await buscarPedidosParaBaixaEstoqueOlist();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao buscar pedidos para baixa de estoque:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
