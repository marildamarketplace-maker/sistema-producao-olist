import type { DadosPedidoFila } from "@/lib/fila-fornecedor-contrato";
import { createHash } from "node:crypto";
import { aplicarEdicaoPedidoFila, pedidoFornecedorEditavelSchema } from "@/lib/pedido-fornecedor-edicao";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { montarDadosPedidoFila } from "@/lib/pedido-fornecedor-queue";

const entrada = z.object({
  fornecedorId: z.guid(), solicitacaoId: z.guid(),
  filialId: z.guid().nullable().optional(),
  acao: z.enum(["preview", "enviar"]).optional(),
  dadosEditados: pedidoFornecedorEditavelSchema.optional(),
  revisao: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine((body) => !body.dadosEditados || Boolean(body.revisao), { message: "Revise o pedido antes de enviar alterações." });
class ErroFila extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
async function autorizar(request: Request) {
  const autenticado = await getUsuarioAutenticado(request).catch(() => { throw new ErroFila("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: { podeSolicitarProducao: true, podeSelecionarFilialFornecedor: true, aplicativoId: true } });
  if (!usuario?.podeSolicitarProducao || !usuario.aplicativoId) throw new ErroFila("Sem permissão para enviar solicitações.", 403);
  return { aplicativoId: usuario.aplicativoId, usuarioId: autenticado.id, podeSelecionarFilial: usuario.podeSelecionarFilialFornecedor };
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
    const { aplicativoId } = await autorizar(request);
    const fornecedores = await prisma.fornecedor.findMany({
      where: { aplicativoId, aplicativoPai: { aplicativoPaiId: null } },
      select: {
        id: true, nome: true,
        aplicativoPai: { select: { filiais: {
          select: { id: true, nome: true, descricao: true }, orderBy: { nome: "asc" },
        } } },
      }, orderBy: { nome: "asc" },
    });
    return NextResponse.json({ fornecedores: fornecedores.map(({ aplicativoPai, ...fornecedor }) => ({ ...fornecedor, filiais: aplicativoPai?.filiais ?? [] })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}
export async function POST(request: Request) {
  try {
    const { aplicativoId, usuarioId, podeSelecionarFilial } = await autorizar(request);
    const parsed = entrada.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ErroFila("Fornecedor e solicitação devem possuir IDs válidos.");
    const { fornecedorId, solicitacaoId, acao, dadosEditados, revisao, filialId } = parsed.data;
    if (filialId && !podeSelecionarFilial) throw new ErroFila("Sem permissão para selecionar filial ao enviar para fila.", 403);
    const registro = await prisma.$transaction(async (tx) => {
      // Serializa com alterações da solicitação; a restrição UNIQUE cobre envios concorrentes.
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${solicitacaoId}::uuid AND aplicativo_id = ${aplicativoId}::uuid FOR UPDATE`;
      const solicitacao = await tx.solicitacaoProducao.findFirst({ where: { id: solicitacaoId, aplicativoId, status: "em_producao" } });
      if (!solicitacao) throw new ErroFila("Solicitação em produção não encontrada neste aplicativo.", 404);
      const fornecedor = await tx.fornecedor.findFirst({ where: { id: fornecedorId, aplicativoId }, select: { aplicativoPaiId: true, aplicativoPai: { select: { aplicativoPaiId: true } } } });
      if (!fornecedor?.aplicativoPaiId || fornecedor.aplicativoPai.aplicativoPaiId !== null) throw new ErroFila("Fornecedor sem aplicativo pai válido vinculado.");
      if (filialId) {
        // Mantém o vínculo da filial estável até a gravação do pedido.
        const filiais = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM aplicativo
          WHERE id = ${filialId}::uuid AND aplicativo_pai_id = ${fornecedor.aplicativoPaiId}::uuid
          FOR SHARE
        `;
        if (!filiais.length) throw new ErroFila("Selecione uma filial vinculada ao fornecedor escolhido.");
      }
      const itens = await tx.itemSolicitacaoProducao.findMany({ where: { solicitacaoId, aplicativoId }, orderBy: { sku: "asc" } });
      const associacoes = await tx.produtoOlistProdutoFornecedor.findMany({
        where: { produtoId: { in: itens.map((i) => i.produtoId) }, produtoFornecedor: { fornecedorId, aplicativoId } },
        include: { produtoFornecedor: true },
      });
      let dados;
      try { dados = montarDadosPedidoFila(itens, associacoes); }
      catch (error) { throw new ErroFila(error instanceof Error ? error.message : "Itens inválidos."); }
      const original = { ...dados, observacao: solicitacao.observacaoGeral };
      const revisaoAtual = createHash("sha256").update(JSON.stringify({ original, aplicativoFornecedorId: fornecedor.aplicativoPaiId })).digest("hex");
      const tecidos = acao === "preview" || dadosEditados ? await tx.produtoFornecedor.findMany({
        where: { fornecedorId, aplicativoId, tipoServico: null },
        select: { id: true, nome: true, referencia: true }, orderBy: { nome: "asc" },
      }) : [];
      if (acao === "preview") return { dadosPedido: original, tecidos, revisao: revisaoAtual };
      if (dadosEditados && revisao !== revisaoAtual) throw new ErroFila("A solicitação ou o destino mudou desde a revisão. Volte e carregue os dados novamente.", 409);
      let dadosFinais: DadosPedidoFila = original;
      if (dadosEditados) {
        try { dadosFinais = aplicarEdicaoPedidoFila(original, dadosEditados, tecidos); }
        catch (error) { throw new ErroFila(error instanceof Error ? error.message : "Dados editados inválidos."); }
      }
      return tx.pedidoFornecedorQueue.create({ data: {
        aplicativoSolicitanteId: aplicativoId, solicitacaoProducaoId: solicitacaoId,
        aplicativoFornecedorId: fornecedor.aplicativoPaiId, fornecedorId,
        dadosPedido: dadosFinais,
        aplicativoFilialId: filialId ?? null,
        status: filialId ? "PROCESSAR" : "PENDENTE",
        direcionadoPorId: filialId ? usuarioId : null,
        direcionadoEm: filialId ? new Date() : null,
      }, select: { id: true } });
    });
    return NextResponse.json(registro, { status: acao === "preview" ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}
