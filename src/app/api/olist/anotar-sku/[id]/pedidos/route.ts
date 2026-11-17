import { NextRequest, NextResponse } from "next/server";
import { autenticarSku, erroRespostaSku, repoSku } from "@/lib/anotar-sku/api";
import { ErroAnotarSku } from "@/lib/anotar-sku/contrato";
import { consultaPedidosSkuSchema } from "@/lib/anotar-sku/pedidos";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  try {
    const escopo = await autenticarSku(request, "read");
    const entrada = consultaPedidosSkuSchema.safeParse({
      id: (await contexto.params).id,
      sku: request.nextUrl.searchParams.get("sku"),
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    });
    if (!entrada.success) throw new ErroAnotarSku("Busca, SKU ou página inválidos.", 400);
    const { id, sku, cursor } = entrada.data;
    const pagina = await repoSku.pedidosPorSku(escopo, id, sku, cursor);
    return NextResponse.json(pagina, { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    const resposta = erroRespostaSku(erro);
    resposta.headers.set("Cache-Control", "private, no-store");
    return resposta;
  }
}
