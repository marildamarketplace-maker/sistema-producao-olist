import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, podeVisualizarProducao: true, podeConfirmarProducao: true },
    });
    if (!usuario || (!usuario.podeSolicitarProducao && !usuario.podeVisualizarProducao && !usuario.podeConfirmarProducao)) {
      throw new Error("Sem permissão para visualizar solicitações.");
    }

    const pedidos = await prisma.pedidoFornecedorSolicitacao.findMany({
      where: { solicitacao: { aplicativoId: autenticado.aplicativoId } },
      orderBy: { createdAt: "desc" },
      select: { solicitacaoId: true, pedidoOlistId: true },
    });
    const filas = await prisma.pedidoFornecedorQueue.findMany({
      where: { aplicativoSolicitanteId: autenticado.aplicativoId, solicitacaoProducao: { status: "em_producao" } },
      select: { id: true, solicitacaoProducaoId: true, status: true },
    });
    return NextResponse.json({ pedidos, filas }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar os pedidos das solicitações." },
      { status: 403 },
    );
  }
}
