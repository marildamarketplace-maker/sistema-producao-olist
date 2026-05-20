import { NextRequest, NextResponse } from "next/server";
import { sincronizarPedidoBaixaEstoqueOlist } from "@/lib/olist";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pedidoId = String(body?.pedido_olist_id ?? "").trim();

    if (!pedidoId) {
      return NextResponse.json(
        { error: "Informe o pedido Olist para sincronizar." },
        { status: 400 },
      );
    }

    const result = await sincronizarPedidoBaixaEstoqueOlist(pedidoId);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao sincronizar pedido para baixa de estoque:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
