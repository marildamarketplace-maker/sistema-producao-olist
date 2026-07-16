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
    return NextResponse.json({ pedidos });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar pedidos das solicitações." },
      { status: 403 },
    );
  }
}
