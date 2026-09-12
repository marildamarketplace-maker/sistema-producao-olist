import { NextRequest, NextResponse } from "next/server";
import { confirmarBaixaEstoqueOlist } from "@/lib/olist";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

type ItemBaixaPayload = {
  sku?: unknown;
  descricao?: unknown;
  quantidade?: unknown;
  pedido_olist_id?: unknown;
  item_olist_id?: unknown;
  observacao?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const autenticado = await getUsuarioAutenticado(req);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarBaixa: true },
    });

    if (!usuario?.podeSolicitarBaixa) {
      return NextResponse.json({ error: "Sem permissão para solicitar baixa de estoque." }, { status: 403 });
    }

    const body = await req.json();
    const origem = body?.origem === "automatica" ? "automatica" : "manual";
    const itens = (Array.isArray(body?.itens) ? body.itens : []) as ItemBaixaPayload[];

    const result = await confirmarBaixaEstoqueOlist({
      aplicativoId: autenticado.aplicativoId,
      origem,
      observacao: typeof body?.observacao === "string" ? body.observacao : null,
      periodoFimBusca: typeof body?.periodo_fim_busca === "string" ? body.periodo_fim_busca : null,
      itens: itens.map((item) => ({
        sku: String(item.sku ?? ""),
        quantidade: Number(item.quantidade ?? 0),
        pedidoOlistId: item.pedido_olist_id ? String(item.pedido_olist_id) : null,
        itemOlistId: item.item_olist_id ? String(item.item_olist_id) : null,
        observacao: item.observacao ? String(item.observacao) : null,
      })),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao confirmar baixa de estoque:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
