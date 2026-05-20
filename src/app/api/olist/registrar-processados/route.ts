import { NextRequest, NextResponse } from "next/server";
import { registrarPedidosOlistProcessados } from "@/lib/olist";

type ItemRastreioOlist = {
  pedido_olist_id?: unknown;
  item_olist_id?: unknown;
  sku?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const solicitacaoId = String(body?.solicitacao_id ?? "");
    const periodoInicio = String(body?.periodo_inicio ?? "");
    const periodoFim = String(body?.periodo_fim ?? "");
    const itens = (Array.isArray(body?.itens) ? body.itens : []) as ItemRastreioOlist[];

    if (!solicitacaoId) {
      return NextResponse.json({ error: "solicitacao_id e obrigatorio" }, { status: 400 });
    }

    if (!periodoInicio || !periodoFim) {
      return NextResponse.json({ error: "periodo_inicio e periodo_fim sao obrigatorios" }, { status: 400 });
    }

    await registrarPedidosOlistProcessados({
      solicitacaoId,
      periodoInicio,
      periodoFim,
      itens: itens.map((item) => ({
        pedido_olist_id: String(item.pedido_olist_id ?? ""),
        item_olist_id: String(item.item_olist_id ?? ""),
        sku: String(item.sku ?? ""),
      })),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao registrar pedidos processados Olist:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
