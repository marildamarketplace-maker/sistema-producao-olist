import { NextRequest, NextResponse } from "next/server";
import { gerarSolicitacaoPorPedidosOlist } from "@/lib/olist";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dataLimite = body?.data_limite;
    if (!dataLimite) return NextResponse.json({ error: "data_limite é obrigatório" }, { status: 400 });
    const result = await gerarSolicitacaoPorPedidosOlist(dataLimite);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
