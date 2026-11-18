import { NextRequest, NextResponse } from "next/server";
import { autenticarSku, erroRespostaSku, repoSku } from "@/lib/anotar-sku/api";
import { ErroAnotarSku } from "@/lib/anotar-sku/contrato";
import { consultaForaPeriodoSkuSchema } from "@/lib/anotar-sku/pedidos";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  try {
    const escopo = await autenticarSku(request, "read");
    const entrada = consultaForaPeriodoSkuSchema.safeParse({
      id: (await contexto.params).id, cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    });
    if (!entrada.success) throw new ErroAnotarSku("Busca ou página inválida.", 400);
    return NextResponse.json(await repoSku.pedidosForaPeriodo(escopo, entrada.data.id, entrada.data.cursor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    const resposta = erroRespostaSku(erro);
    resposta.headers.set("Cache-Control", "private, no-store");
    return resposta;
  }
}
