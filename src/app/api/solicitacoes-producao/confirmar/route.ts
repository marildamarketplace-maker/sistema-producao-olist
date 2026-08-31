import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

type ItemConfirmacao = {
  id?: unknown;
  quantidadeProduzida?: unknown;
};

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeConfirmarProducao: true },
    });

    if (!usuario?.podeConfirmarProducao) {
      return NextResponse.json({ error: "Sem permissão para confirmar produção." }, { status: 403 });
    }

    const body = await request.json() as { solicitacaoId?: unknown; itens?: ItemConfirmacao[] };
    const solicitacaoId = typeof body.solicitacaoId === "string" ? body.solicitacaoId.trim() : "";
    const itensInformados = Array.isArray(body.itens) ? body.itens : [];

    if (!solicitacaoId || itensInformados.length === 0) {
      return NextResponse.json({ error: "Informe a solicitação e seus itens." }, { status: 400 });
    }

    const itens = itensInformados.map((item) => ({
      id: typeof item.id === "string" ? item.id.trim() : "",
      quantidadeProduzida: Number(item.quantidadeProduzida),
    }));

    if (
      itens.some(
        (item) =>
          !item.id ||
          !Number.isInteger(item.quantidadeProduzida) ||
          item.quantidadeProduzida < 0,
      )
    ) {
      return NextResponse.json(
        { error: "Informe quantidades produzidas inteiras e maiores ou iguais a zero." },
        { status: 400 },
      );
    }

    if (new Set(itens.map((item) => item.id)).size !== itens.length) {
      return NextResponse.json({ error: "Existem itens duplicados na confirmação." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      const solicitacao = await tx.solicitacaoProducao.findFirst({
        where: {
          id: solicitacaoId,
          aplicativoId: autenticado.aplicativoId,
          status: "em_producao",
        },
        select: { id: true },
      });

      if (!solicitacao) {
        throw new Error("Solicitação não encontrada ou já confirmada.");
      }

      const itensCadastrados = await tx.itemSolicitacaoProducao.findMany({
        where: { solicitacaoId, aplicativoId: autenticado.aplicativoId },
        select: { id: true, produtoId: true, sku: true },
      });

      const idsInformados = new Set(itens.map((item) => item.id));
      if (
        itensCadastrados.length !== itens.length ||
        itensCadastrados.some((item) => !idsInformados.has(item.id))
      ) {
        throw new Error("Os itens da solicitação mudaram. Recarregue a página e tente novamente.");
      }

      const produtosAtivos = await tx.produto.findMany({
        where: {
          id: { in: itensCadastrados.map((item) => item.produtoId) },
          aplicativoId: autenticado.aplicativoId,
          ativo: true,
        },
        select: { id: true },
      });
      const produtosAtivosIds = new Set(produtosAtivos.map((produto) => produto.id));
      const skusInvalidos = [
        ...new Set(
          itensCadastrados
            .filter((item) => !produtosAtivosIds.has(item.produtoId))
            .map((item) => item.sku),
        ),
      ];

      if (skusInvalidos.length > 0) {
        throw new Error(
          `Não foi possível confirmar: produtos inexistentes ou inativos: ${skusInvalidos.join(", ")}.`,
        );
      }

      const quantidadePorItem = new Map(
        itens.map((item) => [item.id, item.quantidadeProduzida]),
      );

      for (const item of itensCadastrados) {
        await tx.itemSolicitacaoProducao.update({
          where: { id: item.id },
          data: { quantidadeProduzida: quantidadePorItem.get(item.id) ?? 0 },
        });
      }

      const movimentacoes = itensCadastrados.flatMap((item) => {
        const quantidade = quantidadePorItem.get(item.id) ?? 0;
        return quantidade > 0
          ? [{
              produtoId: item.produtoId,
              sku: item.sku,
              tipoMovimento: "entrada",
              quantidade,
              origem: "PRODUCAO",
              referenciaId: solicitacaoId,
              observacao: "Entrada por confirmação de produção",
              aplicativoId: autenticado.aplicativoId,
            }]
          : [];
      });

      if (movimentacoes.length > 0) {
        await tx.movimentacaoEstoque.createMany({ data: movimentacoes });
      }

      await tx.solicitacaoProducao.update({
        where: { id: solicitacaoId },
        data: { status: "concluida" },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao confirmar produção:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao confirmar produção." },
      { status: 400 },
    );
  }
}
