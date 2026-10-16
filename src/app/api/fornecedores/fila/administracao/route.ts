import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { dadosPedidoFilaSchema, type ListaFilaAdministracao } from "@/lib/fila-fornecedor-contrato";

const consultaSchema = z.object({
  situacao: z.enum(["pendente", "direcionado", "todos"]).default("pendente"),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
});
const direcionamentoSchema = z.object({
  pedidoId: z.guid(),
  filialId: z.guid(),
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
    select: { aplicativoId: true, podeGerenciarFilaPedidos: true },
  });
  if (!usuario?.podeGerenciarFilaPedidos || !usuario.aplicativoId) {
    throw new ErroAdministracaoFila("Sem permissão para administrar a fila de pedidos.", 403);
  }
  return { usuarioId: autenticado.id, aplicativoId: usuario.aplicativoId };
}

function falha(error: unknown) {
  if (error instanceof ErroAdministracaoFila) {
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
      ...(situacao === "pendente" ? { aplicativoFilialId: null } : situacao === "direcionado" ? { aplicativoFilialId: { not: null } } : {}),
    };
    const [pedidos, total, filiais] = await Promise.all([
      prisma.pedidoFornecedorQueue.findMany({
        where, skip: (pagina - 1) * porPagina, take: porPagina,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, solicitacaoProducaoId: true, createdAt: true, direcionadoEm: true,
          versao: true, dadosPedido: true,
          aplicativoSolicitante: { select: { nome: true } },
          aplicativoFilial: { select: { id: true, nome: true } },
        },
      }),
      prisma.pedidoFornecedorQueue.count({ where }),
      prisma.aplicativo.findMany({ where: { aplicativoPaiId: aplicativoId }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    ]);
    const resultado: ListaFilaAdministracao = {
      pedidos: pedidos.map((pedido) => {
        const dados = dadosPedidoFilaSchema.safeParse(pedido.dadosPedido);
        return {
          id: pedido.id, solicitacaoProducaoId: pedido.solicitacaoProducaoId,
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
    if (!parsed.success) throw new ErroAdministracaoFila("Informe pedido, filial e versão válidos.", 400);
    const { pedidoId, filialId, versao } = parsed.data;
    const resultado = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedidoFornecedorQueue.findFirst({
        where: { id: pedidoId, aplicativoFornecedorId: aplicativoId }, select: { id: true },
      });
      if (!pedido) throw new ErroAdministracaoFila("Pedido não encontrado na fila deste aplicativo.", 404);
      // Impede a troca do aplicativo pai da filial durante a atribuição.
      const filiais = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM aplicativo
        WHERE id = ${filialId}::uuid AND aplicativo_pai_id = ${aplicativoId}::uuid
        FOR SHARE
      `;
      if (!filiais.length) throw new ErroAdministracaoFila("Selecione uma filial vinculada ao seu aplicativo.", 400);
      const direcionadoEm = new Date();
      const atualizacao = await tx.pedidoFornecedorQueue.updateMany({
        where: { id: pedidoId, aplicativoFornecedorId: aplicativoId, versao },
        data: { aplicativoFilialId: filialId, direcionadoPorId: usuarioId, direcionadoEm, versao: { increment: 1 } },
      });
      if (atualizacao.count !== 1) {
        throw new ErroAdministracaoFila("Este pedido foi alterado por outro usuário. Atualize a fila antes de direcionar novamente.", 409);
      }
      return { id: pedidoId, filialId, direcionadoEm: direcionadoEm.toISOString(), versao: versao + 1 };
    });
    return NextResponse.json(resultado);
  } catch (error) { return falha(error); }
}
