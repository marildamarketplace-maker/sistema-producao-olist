import { NextResponse } from "next/server";
import { periodoSemEnvio } from "@/lib/pedidos-sem-envio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const prazo = Date.now() + 240_000;
  try {
    const [{ prisma }, { criarRepositorioPedidosSemEnvio }, { criarClientePedidosSemEnvio }, { executarPedidosSemEnvio }] = await Promise.all([
      import("@/lib/prisma"), import("@/repositories/pedidos-sem-envio-repository"),
      import("@/lib/pedidos-sem-envio-olist"), import("@/services/pedidosSemEnvioService"),
    ]);
    const repo = criarRepositorioPedidosSemEnvio(prisma);
    if (await repo.estaPausado()) return NextResponse.json({ pausado: true });
    const { referencia } = periodoSemEnvio();
    const agendados = await repo.agendar(referencia);
    await repo.limparAntigos(referencia);
    const resultado = await executarPedidosSemEnvio(repo, criarClientePedidosSemEnvio(), { prazo });
    return NextResponse.json({ ok: resultado.falhas === 0, agendados, ...resultado }, { status: resultado.falhas ? 500 : 200 });
  } catch {
    console.error("[pedidos-sem-envio] Rodada interrompida; consulte o estado persistido do job.");
    return NextResponse.json({ error: "Falha ao verificar os pedidos sem envio." }, { status: 500 });
  }
}
