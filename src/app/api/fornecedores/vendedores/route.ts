import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const solicitante = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarFornecedores: true },
    });

    if (!solicitante?.podeVisualizarFornecedores) {
      throw new Error("Sem permissão para visualizar fornecedores.");
    }

    const [usuarios, formasPagamento] = await Promise.all([
      prisma.usuario.findMany({
        where: { vendedorOlistId: { not: null } },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true, email: true, aplicativoId: true },
      }),
      prisma.formaPagamentoOlistPlano.findMany({
        orderBy: { formaOlistId: "asc" },
        where: { planoPagamento: { ativo: true } },
        select: {
          formaOlistId: true,
          formaOlistNome: true,
          planoPagamento: { select: { id: true, nome: true } },
        },
      }),
    ]);

    const formasPagamentoAgrupadas = new Map<string, {
      forma_olist_id: string;
      forma_olist_nome: string | null;
      planos: Array<{ id: string; nome: string }>;
    }>();
    for (const associacao of formasPagamento) {
      const forma = formasPagamentoAgrupadas.get(associacao.formaOlistId) ?? {
        forma_olist_id: associacao.formaOlistId,
        forma_olist_nome: associacao.formaOlistNome,
        planos: [],
      };
      if (!forma.planos.some((plano) => plano.id === associacao.planoPagamento.id)) {
        forma.planos.push(associacao.planoPagamento);
      }
      formasPagamentoAgrupadas.set(associacao.formaOlistId, forma);
    }

    return NextResponse.json({
      usuarios: usuarios.map((usuario) => ({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        aplicativo_id: usuario.aplicativoId,
      })),
      formasPagamento: [...formasPagamentoAgrupadas.values()],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar vendedores." },
      { status: 403 },
    );
  }
}
