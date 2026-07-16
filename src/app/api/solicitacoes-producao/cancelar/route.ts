import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true },
    });

    if (!usuario?.podeSolicitarProducao) {
      return NextResponse.json({ error: "Sem permissão para cancelar solicitações." }, { status: 403 });
    }

    const body = await request.json() as { solicitacaoId?: unknown };
    const solicitacaoId = String(body.solicitacaoId ?? "").trim();
    if (!solicitacaoId) {
      return NextResponse.json({ error: "Solicitação é obrigatória." }, { status: 400 });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const solicitacao = await tx.solicitacaoProducao.findFirst({
        where: { id: solicitacaoId, aplicativoId: autenticado.aplicativoId },
        select: { id: true, status: true },
      });

      if (!solicitacao) throw new Error("Solicitação não encontrada neste aplicativo.");
      if (solicitacao.status === "cancelada") throw new Error("Esta solicitação já foi cancelada.");

      const atualizada = await tx.solicitacaoProducao.updateMany({
        where: {
          id: solicitacao.id,
          aplicativoId: autenticado.aplicativoId,
          status: solicitacao.status,
        },
        data: { status: "cancelada" },
      });
      if (atualizada.count !== 1) throw new Error("A solicitação foi alterada por outro usuário. Atualize a página e tente novamente.");

      await tx.itemSolicitacaoProducao.updateMany({
        where: { solicitacaoId: solicitacao.id, aplicativoId: autenticado.aplicativoId },
        data: { statusItem: "cancelada" },
      });

      let quantidadeEstornada = 0;
      if (solicitacao.status === "concluida") {
        const entradas = await tx.movimentacaoEstoque.groupBy({
          by: ["produtoId", "sku"],
          where: {
            aplicativoId: autenticado.aplicativoId,
            referenciaId: solicitacao.id,
            origem: "PRODUCAO",
            tipoMovimento: "entrada",
          },
          _sum: { quantidade: true },
        });

        const estornos = entradas
          .map((entrada) => ({ ...entrada, quantidade: entrada._sum.quantidade ?? 0 }))
          .filter((entrada) => entrada.quantidade > 0);

        if (estornos.length > 0) {
          await tx.movimentacaoEstoque.createMany({
            data: estornos.map((entrada) => ({
              produtoId: entrada.produtoId,
              sku: entrada.sku,
              tipoMovimento: "saida",
              quantidade: entrada.quantidade,
              origem: "CANCELAMENTO_PRODUCAO",
              referenciaId: solicitacao.id,
              observacao: "Estorno da entrada por cancelamento da solicitação concluída",
              aplicativoId: autenticado.aplicativoId,
            })),
          });
          quantidadeEstornada = estornos.reduce((total, entrada) => total + entrada.quantidade, 0);
        }
      }

      return { eraConcluida: solicitacao.status === "concluida", quantidadeEstornada };
    });

    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao cancelar solicitação." },
      { status: 400 },
    );
  }
}
