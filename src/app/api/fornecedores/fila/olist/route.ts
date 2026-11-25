import { NextResponse } from "next/server";
import { z } from "zod";
import { obterVinculoVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import { autorizarOlistOrigem } from "@/lib/fila-fornecedor-origem";
import { consultarCadastrosFilaOlist, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ids = z.object({ fornecedorId: z.guid(), filialId: z.guid(), solicitacaoId: z.guid() }).safeParse(Object.fromEntries(params));
    if (!ids.success) return NextResponse.json({ error: "Selecione fornecedor, aplicativo destinatário e solicitação válidos." }, { status: 400 });
    const { usuarioId, ...filial } = await autorizarOlistOrigem(request, ids.data);
    if (params.get("recurso") === "inicial") {
      const vinculo = await obterVinculoVendedorDoUsuario(usuarioId, filial.id);
      return NextResponse.json({
        filial, vendedorOlistPadraoId: vinculo?.vendedorOlistId ?? null, vendedorRevisao: vinculo?.revisao ?? null,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const resultado = await consultarCadastrosFilaOlist(filial.id, params);
    return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ErroFilaOlist ? error.message : "Não foi possível consultar a Olist da conta destinatária." }, { status: error instanceof ErroFilaOlist ? error.status : 502 });
  }
}
