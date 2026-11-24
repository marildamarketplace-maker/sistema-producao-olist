import { dadosOlistFilaSchema } from "@/lib/fila-olist-contrato";
import { autorizarOlistOrigem } from "@/lib/fila-fornecedor-origem";
import { validarSelecoesParciais, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import type { DadosPedidoFila } from "@/lib/fila-fornecedor-contrato";
import { createHash } from "node:crypto";
import { aplicarEdicaoPedidoFila, pedidoFornecedorEditavelSchema } from "@/lib/pedido-fornecedor-edicao";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { montarDadosPedidoFila } from "@/lib/pedido-fornecedor-queue";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";

const entrada = z.object({
  fornecedorId: z.guid(), solicitacaoId: z.guid(),
  filialId: z.guid().nullable().optional(),
  olist: dadosOlistFilaSchema.optional(),
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
  if (error instanceof ErroFilaOlist) return NextResponse.json({ error: error.message }, { status: error.status });
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
        aplicativoPai: { select: { id: true, nome: true, descricao: true, filiais: {
          select: { id: true, nome: true, descricao: true }, orderBy: { nome: "asc" },
        } } },
      }, orderBy: { nome: "asc" },
    });
    return NextResponse.json({ fornecedores: fornecedores.map(({ aplicativoPai, ...fornecedor }) => ({
      ...fornecedor,
      // Mantém o contrato filiais, incluindo agora a conta própria como destino explícito.
      filiais: aplicativoPai ? [{ id: aplicativoPai.id, nome: aplicativoPai.nome, descricao: aplicativoPai.descricao }, ...aplicativoPai.filiais] : [],
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}
export async function POST(request: Request) {
  try {
    const { aplicativoId, usuarioId, podeSelecionarFilial } = await autorizar(request);
    const parsed = entrada.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ErroFila("Fornecedor e solicitação devem possuir IDs válidos.");
    const { fornecedorId, solicitacaoId, acao, dadosEditados, revisao, filialId, olist } = parsed.data;
    if (filialId && !podeSelecionarFilial) throw new ErroFila("Sem permissão para selecionar o aplicativo destinatário ao enviar para fila.", 403);
    if (olist) {
      if (!filialId || olist.filialId !== filialId) throw new ErroFila("Os dados Olist devem pertencer ao aplicativo destinatário selecionado.");
      await autorizarOlistOrigem(request, { fornecedorId, filialId, solicitacaoId });
      // Não manter transações e locks de produção abertos durante consultas externas.
      await validarSelecoesParciais(filialId, olist.selecoes);
    }
    const registro = await prisma.$transaction(async (tx) => {
      // Serializa com alterações da solicitação; a restrição UNIQUE cobre envios concorrentes.
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${solicitacaoId}::uuid AND aplicativo_id = ${aplicativoId}::uuid FOR UPDATE`;
      const solicitacao = await tx.solicitacaoProducao.findFirst({ where: { id: solicitacaoId, aplicativoId, status: "em_producao" } });
      if (!solicitacao) throw new ErroFila("Solicitação em produção não encontrada neste aplicativo.", 404);
      // O envio direto antigo usava este mesmo lock. Não transformar uma tentativa
      // concluída ou ainda incerta em um novo pedido pendente na fila.
      const [pedidoEnviado, envioAnterior] = await Promise.all([
        tx.pedidoFornecedorSolicitacao.findFirst({ where: { solicitacaoId }, select: { id: true } }),
        tx.envioFornecedor.findUnique({ where: { solicitacaoId }, select: { estado: true, pedidoOlistId: true } }),
      ]);
      if (pedidoEnviado || envioAnterior?.pedidoOlistId || (envioAnterior && !["REJEITADO", "LIBERADO"].includes(envioAnterior.estado))) {
        throw new ErroFila("Esta solicitação possui envio concluído, em andamento ou com resultado incerto. Confira o envio existente antes de criar uma fila.", 409);
      }
      const fornecedor = await tx.fornecedor.findFirst({ where: { id: fornecedorId, aplicativoId }, select: { aplicativoPaiId: true, aplicativoPai: { select: { aplicativoPaiId: true } } } });
      if (!fornecedor?.aplicativoPaiId || fornecedor.aplicativoPai.aplicativoPaiId !== null) throw new ErroFila("Fornecedor sem aplicativo pai válido vinculado.");
      if (filialId) {
        if (!await bloquearDestinoFornecedor(tx, fornecedor.aplicativoPaiId, filialId)) {
          throw new ErroFila("Selecione o aplicativo próprio do fornecedor ou um filho direto.");
        }
      }
      const itens = await tx.itemSolicitacaoProducao.findMany({ where: { solicitacaoId, aplicativoId }, orderBy: { sku: "asc" } });
      const associacoes = await tx.produtoOlistProdutoFornecedor.findMany({
        where: { produtoId: { in: itens.map((i) => i.produtoId) }, produtoFornecedor: { fornecedorId, aplicativoId } },
        include: { produtoFornecedor: true },
      });
      let dados;
      try { dados = montarDadosPedidoFila(itens, associacoes, acao === "preview" || Boolean(dadosEditados)); }
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
      if (olist) {
        const permitidos = new Set(dadosFinais.itens.map((item) => item.tecido.id));
        const ids = olist.selecoes.tecidos?.map((item) => item.tecidoId) ?? [];
        if (new Set(ids).size !== ids.length || ids.some((id) => !permitidos.has(id))) throw new ErroFila("Os produtos Olist devem corresponder aos tecidos revisados.");
        dadosFinais = { ...dadosFinais, olist };
      }
      return tx.pedidoFornecedorQueue.create({ data: {
        aplicativoSolicitanteId: aplicativoId, solicitacaoProducaoId: solicitacaoId,
        aplicativoFornecedorId: fornecedor.aplicativoPaiId, fornecedorId,
        dadosPedido: dadosFinais,
        aplicativoFilialId: filialId ?? null,
        status: "PENDENTE",
        direcionadoPorId: filialId ? usuarioId : null,
        direcionadoEm: filialId ? new Date() : null,
      }, select: { id: true } });
    });
    return NextResponse.json(registro, { status: acao === "preview" ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}
