import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

type TipoForma = "pagamento" | "recebimento";

function tipoValido(valor: unknown): valor is TipoForma {
  return valor === "pagamento" || valor === "recebimento";
}

function possuiPermissao(
  usuario: Awaited<ReturnType<typeof getUsuarioAutenticado>>,
  tipo: TipoForma,
) {
  return tipo === "pagamento"
    ? usuario.podeVisualizarOlistFormasPagamento
    : usuario.podeVisualizarOlistFormasRecebimento;
}

export async function GET(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const params = new URL(request.url).searchParams;
    const tipo = params.get("tipo");
    const formaOlistId = params.get("formaOlistId")?.trim();

    if (!tipoValido(tipo) || !formaOlistId) {
      return NextResponse.json({ error: "Tipo e ID da forma são obrigatórios." }, { status: 400 });
    }
    if (!possuiPermissao(usuario, tipo)) {
      return NextResponse.json({ error: "Sem permissão para associar planos." }, { status: 403 });
    }

    const [planos, associacoes] = await Promise.all([
      prisma.planoPagamento.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      tipo === "pagamento"
        ? prisma.formaPagamentoOlistPlano.findMany({
            where: { aplicativoId: usuario.aplicativoId, formaOlistId },
            select: { planoPagamentoId: true },
          })
        : prisma.formaRecebimentoOlistPlano.findMany({
            where: { aplicativoId: usuario.aplicativoId, formaOlistId },
            select: { planoPagamentoId: true },
          }),
    ]);

    return NextResponse.json({
      planos,
      planoIdsAssociados: associacoes.map((item) => item.planoPagamentoId),
    });
  } catch (error) {
    console.error("Erro ao consultar planos de pagamento:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar planos." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const body = await request.json() as {
      tipo?: unknown;
      formaOlistId?: unknown;
      formaOlistNome?: unknown;
      planoIds?: unknown;
    };
    const tipo = body.tipo;
    const formaOlistId = String(body.formaOlistId ?? "").trim();
    const formaOlistNome = String(body.formaOlistNome ?? "").trim() || null;
    const planoIds = Array.isArray(body.planoIds)
      ? [...new Set(body.planoIds.map(String).map((id) => id.trim()).filter(Boolean))]
      : [];

    if (!tipoValido(tipo) || !formaOlistId) {
      return NextResponse.json({ error: "Tipo e ID da forma são obrigatórios." }, { status: 400 });
    }
    if (!possuiPermissao(usuario, tipo)) {
      return NextResponse.json({ error: "Sem permissão para associar planos." }, { status: 403 });
    }

    const planosValidos = await prisma.planoPagamento.findMany({
      where: { id: { in: planoIds }, ativo: true },
      select: { id: true },
    });
    if (planosValidos.length !== planoIds.length) {
      return NextResponse.json({ error: "Um ou mais planos selecionados são inválidos." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (tipo === "pagamento") {
        await tx.formaPagamentoOlistPlano.deleteMany({
          where: { aplicativoId: usuario.aplicativoId, formaOlistId },
        });
        if (planoIds.length) {
          await tx.formaPagamentoOlistPlano.createMany({
            data: planoIds.map((planoPagamentoId) => ({
              aplicativoId: usuario.aplicativoId,
              formaOlistId,
              formaOlistNome,
              planoPagamentoId,
            })),
          });
        }
      } else {
        await tx.formaRecebimentoOlistPlano.deleteMany({
          where: { aplicativoId: usuario.aplicativoId, formaOlistId },
        });
        if (planoIds.length) {
          await tx.formaRecebimentoOlistPlano.createMany({
            data: planoIds.map((planoPagamentoId) => ({
              aplicativoId: usuario.aplicativoId,
              formaOlistId,
              formaOlistNome,
              planoPagamentoId,
            })),
          });
        }
      }
    });

    return NextResponse.json({ success: true, quantidade: planoIds.length });
  } catch (error) {
    console.error("Erro ao associar planos de pagamento:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar associações." },
      { status: 500 },
    );
  }
}
