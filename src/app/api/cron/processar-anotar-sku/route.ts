import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (process.env.ANOTAR_SKU_ASYNC_ENABLED !== "true") return NextResponse.json({ pausado: true });
  const prazo = Date.now() + 240_000;
  try {
    const [{ prisma }, { criarRepositorioAnotarSku }, { clienteAnotarSku }, { executarFilaSku }] = await Promise.all([
      import("@/lib/prisma"), import("@/repositories/anotar-sku-repository"), import("@/lib/anotar-sku/olist"), import("@/services/processarAnotarSkuService"),
    ]);
    const resultado = await executarFilaSku(criarRepositorioAnotarSku(prisma), clienteAnotarSku, { prazo });
    console.info("[anotar-sku-cron] Rodada concluída.", resultado);
    return NextResponse.json({ ok: true, ...resultado });
  } catch {
    console.error("[anotar-sku-cron] Rodada interrompida; reservas serão recuperadas após expirar.");
    return NextResponse.json({ error: "Falha no processamento de buscas." }, { status: 500 });
  }
}
