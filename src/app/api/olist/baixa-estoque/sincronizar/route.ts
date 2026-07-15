import { NextRequest, NextResponse } from "next/server";
import { sincronizarPedidoBaixaEstoqueOlist } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function POST(req: NextRequest) {
  try {
    const usuario = await getUsuarioAutenticado(req);
    const body = await req.json();
    const pedidoId = String(body?.pedido_olist_id ?? "").trim();

    if (!pedidoId) {
      return NextResponse.json(
        { error: "Informe o pedido Olist para sincronizar." },
        { status: 400 },
      );
    }

    const result = await sincronizarPedidoBaixaEstoqueOlist(usuario.aplicativoId, pedidoId);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao sincronizar pedido para baixa de estoque:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
