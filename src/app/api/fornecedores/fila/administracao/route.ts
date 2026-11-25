import { alterarFilaManual } from "@/lib/fila-manual-administracao";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { dadosPedidoFilaSchema, filtrosStatusFila, type ListaFilaAdministracao } from "@/lib/fila-fornecedor-contrato";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";

const consultaSchema = z.object({
  situacao: z.enum(["pendente", "processar", "concluido", "falhado", "cancelado", "direcionado", "todos", "processando", "enviado", "com_falha"]).default("pendente")
    .transform((valor) => valor === "processando" ? "processar" : valor === "enviado" ? "concluido" : valor === "com_falha" ? "falhado" : valor),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
});
const direcionamentoSchema = z.object({
  pedidoId: z.guid(),
  filialId: z.guid(),
  enviarOlist: z.boolean().default(false),
  versao: z.number().int().min(0).max(2147483646),
}).strict();

class ErroAdministracaoFila extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function autorizar(request: Request) {
  const autenticado = await getUsuarioAutenticado(request).catch(() => {
    throw new ErroAdministracaoFila("Sessão inválida ou expirada.", 401);
  });
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { aplicativoId: true, podeGerenciarFilaPedidos: true, ativo: true },
  });
  if (!usuario?.podeGerenciarFilaPedidos || usuario.ativo === false || !usuario.aplicativoId) {
    throw new ErroAdministracaoFila("Sem permissão para administrar a fila de pedidos.", 403);
  }
  return { usuarioId: autenticado.id, aplicativoId: usuario.aplicativoId };
}

function falha(error: unknown) {
  if (error instanceof ErroAdministracaoFila || error instanceof ErroFilaOlist) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Não foi possível acessar a fila de pedidos. Tente novamente." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { aplicativoId } = await autorizar(request);
    const params = new URL(request.url).searchParams;
    const parsed = consultaSchema.safeParse({ situacao: params.get("situacao") ?? undefined, pagina: params.get("pagina") ?? undefined });
    if (!parsed.success) throw new ErroAdministracaoFila("Filtro ou página inválidos.", 400);
    const { situacao, pagina } = parsed.data;
    const porPagina = 20;
    const where = {
      aplicativoFornecedorId: aplicativoId,
      ...(situacao === "direcionado" ? { aplicativoFilialId: { not: null } } : situacao === "todos" ? {} : { status: filtrosStatusFila[situacao] }),
    };
    const [pedidos, total, filiais] = await Promise.all([
      prisma.pedidoFornecedorQueue.findMany({
        where, skip: (pagina - 1) * porPagina, take: porPagina,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, solicitacaoProducaoId: true, tipoOrigem: true, autor: { select: { nome: true } }, createdAt: true, direcionadoEm: true,
          versao: true, dadosPedido: true, status: true,
          aplicativoSolicitante: { select: { nome: true } },
          aplicativoFilial: { select: { id: true, nome: true } },
        },
      }),
      prisma.pedidoFornecedorQueue.count({ where }),
      prisma.aplicativo.findMany({ where: { OR: [{ id: aplicativoId }, { aplicativoPaiId: aplicativoId }] }, select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }] }),
    ]);
    const resultado: ListaFilaAdministracao = {
      pedidos: pedidos.map((pedido) => {
        const dados = dadosPedidoFilaSchema.safeParse(pedido.dadosPedido);
        return {
          id: pedido.id, status: pedido.status, solicitacaoProducaoId: pedido.solicitacaoProducaoId,
          tipoOrigem: pedido.tipoOrigem === "MANUAL" ? "MANUAL" : "PRODUCAO", autorNome: pedido.autor?.nome ?? null,
          createdAt: pedido.createdAt.toISOString(), origem: pedido.aplicativoSolicitante.nome,
          filial: pedido.aplicativoFilial, direcionadoEm: pedido.direcionadoEm?.toISOString() ?? null,
          versao: pedido.versao, dadosPedido: dados.success ? dados.data : null,
        };
      }),
      filiais, total, pagina, porPagina,
    };
    return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return falha(error); }
}

export async function PATCH(request: Request) {
  try {
    const { usuarioId, aplicativoId } = await autorizar(request);
    const parsed = direcionamentoSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ErroAdministracaoFila("Informe pedido, aplicativo destinatário e versão válidos.", 400);
    const { pedidoId, filialId, versao, enviarOlist } = parsed.data;
    if (enviarOlist) throw new ErroAdministracaoFila("Use a revisão e confirmação de Enviar para a Olist.", 400);
    const resultado = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoFornecedorQueue.findFirst({
        where: { id: pedidoId, aplicativoFornecedorId: aplicativoId }, select: { id: true, status: true, solicitacaoProducaoId: true, tipoOrigem: true },
      });
      if (!pedido) throw new ErroAdministracaoFila("Pedido não encontrado na fila deste aplicativo.", 404);
      if (pedido.tipoOrigem === "MANUAL") return alterarFilaManual(tx, { pedidoId, aplicativoId, usuarioId, versao, filialId });
      if (!pedido.solicitacaoProducaoId) throw new ErroAdministracaoFila("Origem da fila inválida.", 409);
      if (pedido.status !== "PENDENTE" && pedido.status !== "FALHADO") {
        throw new ErroAdministracaoFila("Este pedido está em PROCESSAR, CONCLUIDO ou CANCELADO e não pode ser alterado.", 409);
      }
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${pedido.solicitacaoProducaoId}::uuid FOR UPDATE`;
      const envio = await tx.envioFornecedor.findUnique({ where: { solicitacaoId: pedido.solicitacaoProducaoId } });
      if (envio && !["REJEITADO", "LIBERADO"].includes(envio.estado)) throw new ErroAdministracaoFila("Envio concluído, em andamento ou incerto. Confira o resultado antes de trocar o aplicativo destinatário.", 409);
      if (!await bloquearDestinoFornecedor(tx, aplicativoId, filialId)) {
        throw new ErroAdministracaoFila("Selecione o aplicativo próprio do fornecedor ou um filho direto.", 400);
      }
      const direcionadoEm = new Date();
      const atualizacao = await tx.pedidoFornecedorQueue.updateMany({
        where: { id: pedidoId, aplicativoFornecedorId: aplicativoId, versao, status: { in: ["PENDENTE", "FALHADO"] } },
        data: { status: "PENDENTE", aplicativoFilialId: filialId, direcionadoPorId: usuarioId, direcionadoEm, versao: { increment: 1 } },
      });
      if (atualizacao.count !== 1) {
        throw new ErroAdministracaoFila("Este pedido foi alterado por outro usuário. Atualize a fila antes de direcionar novamente.", 409);
      }
      return { id: pedidoId, filialId, status: "PENDENTE", direcionadoEm: direcionadoEm.toISOString(), versao: versao + 1 };
    });
    return NextResponse.json(resultado);
  } catch (error) { return falha(error); }
}

const cancelamentoSchema = z.object({
  acao: z.literal("CANCELAR"), pedidoId: z.guid(),
  versao: z.number().int().min(0).max(2147483646),
}).strict();

export async function POST(request: Request) {
  try {
    const { usuarioId, aplicativoId } = await autorizar(request);
    const parsed = cancelamentoSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ErroAdministracaoFila("Informe pedido e versão válidos para cancelar.", 400);
    const { pedidoId, versao } = parsed.data;
    await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoFornecedorQueue.findFirst({
        where: { id: pedidoId, aplicativoFornecedorId: aplicativoId },
        select: { solicitacaoProducaoId: true, tipoOrigem: true },
      });
      if (!pedido) throw new ErroAdministracaoFila("Pedido não encontrado na fila deste aplicativo.", 404);
      if (pedido.tipoOrigem === "MANUAL") return alterarFilaManual(tx, { pedidoId, aplicativoId, usuarioId, versao });
      if (!pedido.solicitacaoProducaoId) throw new ErroAdministracaoFila("Origem da fila inválida.", 409);
      const pais = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM aplicativo WHERE id=${aplicativoId}::uuid AND aplicativo_pai_id IS NULL FOR SHARE`;
      if (!pais.length) throw new ErroAdministracaoFila("Somente o aplicativo pai pode cancelar pedidos desta fila.", 403);
      // Mesmo lock usado na reserva de envio: cancelar e enviar são excludentes.
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id=${pedido.solicitacaoProducaoId}::uuid FOR UPDATE`;
      const envio = await tx.envioFornecedor.findUnique({ where: { solicitacaoId: pedido.solicitacaoProducaoId }, select: { estado: true, pedidoOlistId: true } });
      const enviado = await tx.pedidoFornecedorSolicitacao.findFirst({ where: { solicitacaoId: pedido.solicitacaoProducaoId }, select: { id: true } });
      if (enviado || envio && (envio.pedidoOlistId || !["REJEITADO", "LIBERADO"].includes(envio.estado)))
        throw new ErroAdministracaoFila("Há envio concluído, em andamento ou incerto. Confira o resultado na Olist antes de cancelar na fila.", 409);
      // Atualiza somente este pedido e registra autoria sem carregar o snapshot.
      const quantidade = await tx.$executeRaw`UPDATE pedido_fornecedor_queue
        SET status='CANCELADO',versao=versao+1,
          dados_pedido=jsonb_set(dados_pedido,'{cancelamento}',jsonb_build_object('usuarioId',${usuarioId}::text,'em',clock_timestamp()),true)
        WHERE id=${pedidoId}::uuid AND aplicativo_fornecedor_id=${aplicativoId}::uuid
          AND versao=${versao} AND status IN ('PENDENTE','FALHADO')`;
      if (quantidade !== 1) throw new ErroAdministracaoFila("Pedido alterado, em processamento ou já encerrado. Atualize a fila antes de cancelar.", 409);
    });
    return NextResponse.json({ id: pedidoId, status: "CANCELADO", versao: versao + 1 });
  } catch (error) { return falha(error); }
}
