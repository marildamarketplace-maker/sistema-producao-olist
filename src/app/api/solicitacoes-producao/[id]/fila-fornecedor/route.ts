import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarDetalheProducao, respostaErroDetalheProducao } from "@/lib/producao-detalhes";
import { dadosPedidoFilaSchema, type DetalheFilaProducao } from "@/lib/fila-fornecedor-contrato";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const usuario = await autorizarDetalheProducao(request, id);
    const pedido = await prisma.pedidoFornecedorQueue.findFirst({
      where: { solicitacaoProducaoId: id, aplicativoSolicitanteId: usuario.aplicativoId },
      select: {
        id: true, solicitacaoProducaoId: true, status: true, createdAt: true, direcionadoEm: true, dadosPedido: true,
        fornecedor: { select: { nome: true } }, aplicativoFilial: { select: { id: true, nome: true } },
      },
    });
    if (!pedido) return NextResponse.json({ error: "Envio à fila não encontrado." }, { status: 404 });
    const dados = dadosPedidoFilaSchema.safeParse(pedido.dadosPedido);
    const detalhe: DetalheFilaProducao = {
      id: pedido.id, solicitacaoProducaoId: pedido.solicitacaoProducaoId, status: pedido.status,
      fornecedor: pedido.fornecedor.nome, filial: pedido.aplicativoFilial,
      createdAt: pedido.createdAt.toISOString(), direcionadoEm: pedido.direcionadoEm?.toISOString() ?? null,
      dadosPedido: dados.success ? dados.data : null,
    };
    return NextResponse.json({ pedido: detalhe }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const falha = respostaErroDetalheProducao(error);
    return NextResponse.json({ error: falha.mensagem }, { status: falha.status });
  }
}
