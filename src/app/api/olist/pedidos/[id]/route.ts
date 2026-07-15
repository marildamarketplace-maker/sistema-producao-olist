import { NextResponse } from "next/server";
import { obterPedidoOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "ID do pedido inválido." }, { status: 400 });
    }

    const usuario = await getUsuarioAutenticado(request);
    const pedido = await obterPedidoOlistApi(usuario.aplicativoId, id);
    return NextResponse.json(pedido);
  } catch (error) {
    console.error("Erro ao obter pedido Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar o pedido." },
      { status: 500 },
    );
  }
}
