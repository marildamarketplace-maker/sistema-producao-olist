import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarDetalheProducao, DetalheProducaoError, respostaErroDetalheProducao } from "@/lib/producao-detalhes";
import type { DetalheProducao } from "@/lib/producao-detalhes-contrato";
import { revisaoItensProducao } from "@/lib/producao-revisao";
import { editarItensProducao, normalizarEdicaoItensProducao } from "@/lib/editar-itens-producao";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const usuario = await autorizarDetalheProducao(request, id);
    const solicitacao = await prisma.solicitacaoProducao.findFirst({
      where: { id, aplicativoId: usuario.aplicativoId },
      select: {
        id: true, dataEntrega: true, createdAt: true, status: true, observacaoGeral: true,
        prioridadeProducao: true, periodoInicio: true, periodoFim: true,
        evidenciaBucket: true, evidenciaStoragePath: true,
        pedidosFornecedor: {
          where: { fornecedor: { aplicativoId: usuario.aplicativoId } },
          select: { pedidoOlistId: true, fornecedor: { select: { nome: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!solicitacao) return NextResponse.json({ error: "Produção não encontrada." }, { status: 404 });
    const itens = await prisma.itemSolicitacaoProducao.findMany({
      where: { solicitacaoId: id, aplicativoId: usuario.aplicativoId },
      select: { id: true, produtoId: true, sku: true, imagemUrl: true, quantidadeSolicitada: true, quantidadeProduzida: true, tipoCorte: true, observacao: true },
      orderBy: { createdAt: "asc" },
    });
    const producao: DetalheProducao = {
      id: solicitacao.id, dataEntrega: solicitacao.dataEntrega.toISOString().slice(0, 10),
      revisao: revisaoItensProducao(solicitacao.status, itens),
      createdAt: solicitacao.createdAt.toISOString(), status: solicitacao.status,
      observacaoGeral: solicitacao.observacaoGeral, prioridadeProducao: solicitacao.prioridadeProducao,
      periodoInicio: solicitacao.periodoInicio?.toISOString() ?? null,
      periodoFim: solicitacao.periodoFim?.toISOString() ?? null,
      evidenciaDisponivel: Boolean(solicitacao.evidenciaBucket && solicitacao.evidenciaStoragePath),
      pedidosOlist: solicitacao.pedidosFornecedor.map((pedido) => ({ id: pedido.pedidoOlistId, fornecedor: pedido.fornecedor.nome })),
      itens,
    };
    return NextResponse.json({ producao }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const falha = respostaErroDetalheProducao(error);
    return NextResponse.json({ error: falha.mensagem }, { status: falha.status });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const usuario = await autorizarDetalheProducao(request, id, true);
    let body: unknown;
    try { body = await request.json(); } catch { throw new DetalheProducaoError("Dados da edição inválidos.", 400); }
    const dados = normalizarEdicaoItensProducao(body);
    const resultado = await editarItensProducao({ ...dados, solicitacaoId: id, aplicativoId: usuario.aplicativoId, usuarioId: usuario.id });
    return NextResponse.json({ success: true, ...resultado });
  } catch (error) {
    const falha = respostaErroDetalheProducao(error);
    return NextResponse.json({ error: falha.mensagem }, { status: falha.status });
  }
}
