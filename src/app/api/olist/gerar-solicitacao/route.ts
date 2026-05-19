import { NextRequest, NextResponse } from "next/server";
import { gerarSolicitacaoPorPedidosOlist } from "@/lib/olist";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dataLimite = body?.data_limite;
    const filtroDataBase = body?.filtro_data_base ?? "APROVACAO_PEDIDO";
    const periodoInicio = body?.periodo_inicio;
    const periodoFim = body?.periodo_fim;
    const situacoes = Array.isArray(body?.situacoes) ? body.situacoes.map(String) : undefined;

    console.log("POST /api/olist/gerar-solicitacao payload:", {
      data_limite: dataLimite,
      filtro_data_base: filtroDataBase,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      situacoes,
    });

    if (!dataLimite) return NextResponse.json({ error: "data_limite é obrigatório" }, { status: 400 });
    if (!filtroDataBase || !["APROVACAO_PEDIDO", "CRIACAO_PEDIDO"].includes(filtroDataBase)) {
      return NextResponse.json({ error: "filtro_data_base inválido" }, { status: 400 });
    }
    if (!periodoInicio || !periodoFim) {
      return NextResponse.json({ error: "periodo_inicio e periodo_fim são obrigatórios" }, { status: 400 });
    }

    const result = await gerarSolicitacaoPorPedidosOlist({
      dataLimite,
      filtroDataBase,
      periodoInicio,
      periodoFim,
      situacoes,
    });

    console.log("POST /api/olist/gerar-solicitacao result:", result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao gerar solicitação por pedidos Olist:", error instanceof Error ? error.message : error, {
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
