import { validarVendedorPedidoOlist } from "@/lib/olist-escopo-vendedor";
import { resolverEscopoPedidosOlist } from "@/lib/olist-pedidos-empresa";
import { NextResponse } from "next/server";
import { obterPedidoOlistApi } from "@/lib/olist";
import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "ID do pedido inválido." }, { status: 400 });
    }

    const usuario = await autorizarOlist(request, "podeVisualizarOlistPedidos");
    const { aplicativoId, vendedorId } = await resolverEscopoPedidosOlist(request, usuario);
    const pedido = await obterPedidoOlistApi(aplicativoId, id);
    validarVendedorPedidoOlist(pedido, vendedorId);
    return NextResponse.json(pedido, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: "Não foi possível consultar o pedido na Olist." },
      { status: 500 },
    );
  }
}
