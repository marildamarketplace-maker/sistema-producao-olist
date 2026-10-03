import { NextResponse } from "next/server";
import {
  confirmarEntregaProducao,
  normalizarItensConfirmacaoProducao,
} from "@/lib/confirmar-producao";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeConfirmarProducao: true },
    });
    if (!usuario?.podeConfirmarProducao) {
      return NextResponse.json(
        { error: "Sem permissão para confirmar produção." },
        { status: 403 },
      );
    }

    const body = await request.json() as {
      solicitacaoId?: unknown;
      itens?: unknown;
    };
    const solicitacaoId = typeof body.solicitacaoId === "string"
      ? body.solicitacaoId.trim()
      : "";
    if (!solicitacaoId) {
      return NextResponse.json(
        { error: "Informe a solicitação." },
        { status: 400 },
      );
    }

    const itens = normalizarItensConfirmacaoProducao(body.itens);
    await confirmarEntregaProducao({
      aplicativoId: autenticado.aplicativoId,
      solicitacaoId,
      itens,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao confirmar produção:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Erro inesperado ao confirmar produção.",
      },
      { status: 400 },
    );
  }
}
