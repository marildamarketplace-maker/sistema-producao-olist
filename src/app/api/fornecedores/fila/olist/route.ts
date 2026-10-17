import { NextResponse } from "next/server";
import { z } from "zod";
import { autorizarOlistOrigem } from "@/lib/fila-fornecedor-origem";
import { consultarCadastrosFilaOlist, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ids = z.object({ fornecedorId: z.guid(), filialId: z.guid(), solicitacaoId: z.guid() }).safeParse(Object.fromEntries(params));
    if (!ids.success) return NextResponse.json({ error: "Selecione fornecedor, filial e solicitação válidos." }, { status: 400 });
    const filial = await autorizarOlistOrigem(request, ids.data);
    const resultado = await consultarCadastrosFilaOlist(filial.id, params);
    return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ErroFilaOlist ? error.message : "Não foi possível consultar a Olist da filial." }, { status: error instanceof ErroFilaOlist ? error.status : 502 });
  }
}
