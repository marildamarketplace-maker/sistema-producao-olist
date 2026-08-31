import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ReprocessamentoManualAtivoError } from "@/repositories/estampa-jobs-repository";
import {
  EstampaNaoEncontradaParaReprocessamentoError,
  solicitarReprocessamentoIaEstampa,
} from "@/services/solicitarReprocessamentoIaEstampaService";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { id: true, podeEditarEstampas: true },
    });
    if (!usuario?.podeEditarEstampas) {
      return NextResponse.json(
        { error: "Sem permissão para reprocessar estampas com IA." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const job = await solicitarReprocessamentoIaEstampa(id, usuario.id);
    return NextResponse.json(
      {
        job: {
          id: job.id,
          estampaId: job.estampaId.toString(),
          tipo: job.tipo,
          status: job.status,
          manualRequested: job.manualRequested,
          manualRequestedAt: job.manualRequestedAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ReprocessamentoManualAtivoError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof EstampaNaoEncontradaParaReprocessamentoError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao solicitar reprocessamento." },
      { status: 400 },
    );
  }
}
