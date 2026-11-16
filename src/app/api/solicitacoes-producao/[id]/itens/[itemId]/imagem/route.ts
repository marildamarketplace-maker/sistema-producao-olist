import { NextResponse } from "next/server";
import { autorizarDetalheProducao, DetalheProducaoError, respostaErroDetalheProducao } from "@/lib/producao-detalhes";
import { carregarImagemItemProducao } from "@/lib/producao-imagem";
import { LimiteRequisicoesOlistError } from "@/lib/olist-errors";

export async function POST(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await context.params;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(itemId)) throw new DetalheProducaoError("Item inválido.", 400);
    const usuario = await autorizarDetalheProducao(request, id);
    const imagemUrl = await carregarImagemItemProducao(usuario.aplicativoId, id, itemId);
    return NextResponse.json({ imagemUrl }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const falha = error instanceof LimiteRequisicoesOlistError
      ? { mensagem: "Limite do Olist atingido. Aguarde e tente novamente.", status: 429 }
      : respostaErroDetalheProducao(error);
    return NextResponse.json({ error: falha.mensagem }, { status: falha.status, headers: { "Cache-Control": "no-store" } });
  }
}
