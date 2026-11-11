import { NextRequest, NextResponse } from "next/server";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { prisma } from "@/lib/prisma";
import { trocaBaixaConfirmadaSchema, trocarSkuBaixaConfirmada, TrocaBaixaError } from "@/lib/trocar-sku-baixa-confirmada";

export async function POST(req: NextRequest) {
  try {
    const autenticado = await getUsuarioAutenticado(req);
    const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: { podeSolicitarBaixa: true } });
    if (!usuario?.podeSolicitarBaixa) return NextResponse.json({ error: "Sem permissão para baixar estoque." }, { status: 403 });
    if (!autenticado.aplicativoId) return NextResponse.json({ error: "Aplicativo não identificado." }, { status: 403 });
    const payload = trocaBaixaConfirmadaSchema.safeParse(await req.json());
    if (!payload.success) return NextResponse.json({ error: "Informe a baixa, o movimento atual e um SKU válido." }, { status: 400 });
    return NextResponse.json(await trocarSkuBaixaConfirmada(prisma, autenticado.aplicativoId, autenticado.id, payload.data));
  } catch (error) {
    if (error instanceof TrocaBaixaError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível trocar o SKU. Recarregue o histórico antes de tentar novamente." }, { status: 500 });
  }
}
