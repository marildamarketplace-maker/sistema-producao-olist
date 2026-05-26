import { NextRequest, NextResponse } from "next/server";
import { NecessidadeProducaoError, gerarSolicitacaoPorPedidosOlist } from "@/lib/olist";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dataLimite = body?.data_limite;
    const filtroDataBase = body?.filtro_data_base ?? "APROVACAO_PEDIDO";
    const situacoes = Array.isArray(body?.situacoes) ? body.situacoes.map(String) : undefined;

    console.log("POST /api/olist/gerar-solicitacao payload:", {
      data_limite: dataLimite,
      filtro_data_base: filtroDataBase,
      situacoes,
    });

    if (!dataLimite) return NextResponse.json({ error: "data_limite e obrigatorio" }, { status: 400 });
    if (!filtroDataBase || !["APROVACAO_PEDIDO", "CRIACAO_PEDIDO"].includes(filtroDataBase)) {
      return NextResponse.json({ error: "filtro_data_base invalido" }, { status: 400 });
    }

    const result = await gerarSolicitacaoPorPedidosOlist({
      dataLimite,
      filtroDataBase,
      situacoes,
    });

    console.log("POST /api/olist/gerar-solicitacao result:", result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao gerar solicitacao por pedidos Olist:", error instanceof Error ? error.message : error, {
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (error instanceof NecessidadeProducaoError) {
      return NextResponse.json(
        {
          error: "Os itens encontrados ja possuem estoque suficiente.",
          estoque_suficiente: error.estoqueSuficiente,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
