import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { montarDadosPedidoFila } from "@/lib/pedido-fornecedor-queue";

const entrada = z.object({ fornecedorId: z.guid(), solicitacaoId: z.guid() });
class ErroFila extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
async function autorizar(request: Request) {
  const autenticado = await getUsuarioAutenticado(request).catch(() => { throw new ErroFila("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: { podeSolicitarProducao: true, aplicativoId: true } });
  if (!usuario?.podeSolicitarProducao || !usuario.aplicativoId) throw new ErroFila("Sem permissão para enviar solicitações.", 403);
  return usuario.aplicativoId;
}
function falha(error: unknown) {
  if (error instanceof ErroFila) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
    return NextResponse.json({ error: "Esta solicitação já está na fila do fornecedor." }, { status: 409 });
  }
  return NextResponse.json({ error: "Não foi possível acessar a fila do fornecedor." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const aplicativoId = await autorizar(request);
    const fornecedores = await prisma.fornecedor.findMany({
      where: { aplicativoId, vendedor: { ativo: true } },
      select: { id: true, nome: true }, orderBy: { nome: "asc" },
    });
    return NextResponse.json({ fornecedores }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}
export async function POST(request: Request) {
  try {
    const aplicativoId = await autorizar(request);
    const parsed = entrada.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ErroFila("Fornecedor e solicitação devem possuir IDs válidos.");
    const { fornecedorId, solicitacaoId } = parsed.data;
    const registro = await prisma.$transaction(async (tx) => {
      // Serializa com alterações da solicitação; a restrição UNIQUE cobre envios concorrentes.
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${solicitacaoId}::uuid AND aplicativo_id = ${aplicativoId}::uuid FOR UPDATE`;
      const solicitacao = await tx.solicitacaoProducao.findFirst({ where: { id: solicitacaoId, aplicativoId, status: "em_producao" } });
      if (!solicitacao) throw new ErroFila("Solicitação em produção não encontrada neste aplicativo.", 404);
      const fornecedor = await tx.fornecedor.findFirst({ where: { id: fornecedorId, aplicativoId }, select: { vendedor: { select: { ativo: true, aplicativoId: true } } } });
      if (!fornecedor?.vendedor?.ativo || !fornecedor.vendedor.aplicativoId) throw new ErroFila("Fornecedor sem usuário ativo e aplicativo de destino vinculado.");
      const itens = await tx.itemSolicitacaoProducao.findMany({ where: { solicitacaoId, aplicativoId }, orderBy: { sku: "asc" } });
      const associacoes = await tx.produtoOlistProdutoFornecedor.findMany({
        where: { produtoId: { in: itens.map((i) => i.produtoId) }, produtoFornecedor: { fornecedorId, aplicativoId } },
        include: { produtoFornecedor: true },
      });
      let dados;
      try { dados = montarDadosPedidoFila(itens, associacoes); }
      catch (error) { throw new ErroFila(error instanceof Error ? error.message : "Itens inválidos."); }
      return tx.pedidoFornecedorQueue.create({ data: {
        aplicativoSolicitanteId: aplicativoId, solicitacaoProducaoId: solicitacaoId,
        aplicativoFornecedorId: fornecedor.vendedor.aplicativoId, fornecedorId,
        dadosPedido: { ...dados, observacao: solicitacao.observacaoGeral },
      }, select: { id: true } });
    });
    return NextResponse.json(registro, { status: 201 });
  } catch (error) { return falha(error); }
}
