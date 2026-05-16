import { NextRequest, NextResponse } from "next/server";
import { gerarSolicitacaoPorPedidosOlist } from "@/lib/olist";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dataLimite = body?.data_limite;
    const turnoId = body?.turno_id;
    const filtroDataBase = body?.filtro_data_base;
    const periodoInicio = body?.periodo_inicio;
    const periodoFim = body?.periodo_fim;
    if (!dataLimite) return NextResponse.json({ error: "data_limite é obrigatório" }, { status: 400 });
    if (!turnoId) return NextResponse.json({ error: "turno_id é obrigatório" }, { status: 400 });
    if (!filtroDataBase || !["APROVACAO_PEDIDO", "CRIACAO_PEDIDO"].includes(filtroDataBase)) {
      return NextResponse.json({ error: "filtro_data_base inválido" }, { status: 400 });
    }
    if (!periodoInicio || !periodoFim) {
      return NextResponse.json({ error: "periodo_inicio e periodo_fim são obrigatórios" }, { status: 400 });
    }

    const result = await gerarSolicitacaoPorPedidosOlist({
      dataLimite,
      turnoId,
      filtroDataBase,
      periodoInicio,
      periodoFim,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
