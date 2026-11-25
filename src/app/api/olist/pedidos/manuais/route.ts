import { validarVendedorPedidoOlist } from "@/lib/olist-escopo-vendedor";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { autorizarPedidoManual, resolverContaPedidoManual } from "@/lib/pedido-manual-acesso";
import { pedidoManualSchema, montarDadosPedidoManual } from "@/lib/pedido-manual-contrato";
import { consultarCadastrosFilaOlist, validarSelecoesParciais, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";

const resposta = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });
const comprovanteSelect = { id: true, status: true, createdAt: true, aplicativoFilial: { select: { id: true, nome: true } } } as const;
function comprovante(p: { id: string; status: string; createdAt: Date; aplicativoFilial: { id: string; nome: string } | null }) {
  return { id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), aplicativo: p.aplicativoFilial };
}
function falha(error: unknown) {
  if (error instanceof ErroFilaOlist || error instanceof ErroAutorizacaoOlist) return resposta({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return resposta({ error: "Revise vendedor, cliente, itens e dados comerciais." }, 400);
  return resposta({ error: "Não foi possível concluir a operação. Confira a integração e tente novamente." }, 502);
}
function exigirHabilitacao() {
  if (process.env.PEDIDOS_MANUAIS_HABILITADOS !== "true") throw new ErroFilaOlist("A criação manual na fila ainda não foi habilitada.", 503);
}
export async function GET(request: Request) {
  try {
    const usuario = await autorizarPedidoManual(request);
    const params = new URL(request.url).searchParams;
    const pedidoId = params.get("pedidoId");
    if (pedidoId) {
      if (!z.guid().safeParse(pedidoId).success) throw new ErroFilaOlist("Pedido inválido.");
      const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where: {
        id: pedidoId, tipoOrigem: "MANUAL", aplicativoSolicitanteId: usuario.aplicativoId, autorId: usuario.id,
      }, select: comprovanteSelect });
      if (!pedido) throw new ErroFilaOlist("Comprovante não encontrado.", 404);
      return resposta(comprovante(pedido));
    }
    if (!params.has("aplicativoId")) {
      const aplicativos = await prisma.aplicativo.findMany({ where: usuario.podeSelecionarFilialFornecedor
        ? { OR: [{ id: usuario.aplicativoId }, { aplicativoPaiId: usuario.aplicativoId }] } : { id: usuario.aplicativoId },
        select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1001 });
      if (aplicativos.length > 1000) throw new ErroFilaOlist("Limite de aplicativos excedido.");
      return resposta({ aplicativos, aplicativoPadraoId: usuario.aplicativoId, habilitado: process.env.PEDIDOS_MANUAIS_HABILITADOS === "true" });
    }
    exigirHabilitacao();
    const { conta, vendedorId } = await resolverContaPedidoManual(usuario, params.get("aplicativoId")!);
    if (!params.has("recurso")) return resposta({ conta, vendedorId, vendedorFixo: vendedorId !== null });
    return resposta(await consultarCadastrosFilaOlist(conta.id, params, { vendedorId }));
  } catch (error) { return falha(error); }
}
export async function POST(request: Request) {
  try {
    const usuario = await autorizarPedidoManual(request);
    exigirHabilitacao();
    const entrada = pedidoManualSchema.parse(await request.json().catch(() => null));
    const hashEntrada = createHash("sha256").update(JSON.stringify(entrada)).digest("hex");
    const where = { aplicativoSolicitanteId: usuario.aplicativoId, autorId: usuario.id, chaveIdempotencia: entrada.chaveIdempotencia };
    // Repetir um aceite não repete consultas externas nem muda seu resultado.
    const existente = await prisma.pedidoFornecedorQueue.findFirst({ where, select: { ...comprovanteSelect, hashEntrada: true } });
    if (existente) {
      if (existente.hashEntrada !== hashEntrada) throw new ErroFilaOlist("Esta confirmação já foi usada para outro conteúdo.", 409);
      return resposta(comprovante(existente));
    }
    const { conta, vendedorId } = await resolverContaPedidoManual(usuario, entrada.aplicativoId);
    if (vendedorId !== null) {
      if (entrada.selecoes.vendedorId !== vendedorId) throw new ErroFilaOlist("Use o vendedor vinculado nesta conta.", 403);
    }
    // O aceite valida apenas os cadastros obrigatórios. Produtos, preços,
    // pagamento e laser permanecem no snapshot e são conferidos na revisão,
    // antes de qualquer criação real na Olist.
    const cadastros = await validarSelecoesParciais(conta.id, {
      vendedorId: entrada.selecoes.vendedorId, clienteId: entrada.selecoes.clienteId,
    });
    if (vendedorId !== null && cadastros.cliente) validarVendedorPedidoOlist(cadastros.cliente, vendedorId);
    const dados = montarDadosPedidoManual(entrada);
    const resultado = await prisma.$transaction(async tx => {
      // O cadastro de vínculos usa FOR UPDATE no mesmo usuário.
      await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuario.id}::uuid FOR SHARE`;
      const atual = await tx.usuario.findUnique({ where: { id: usuario.id }, select: {
        ativo: true, aplicativoId: true, podeCriarOlistPedido: true, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: true,
      } });
      if (!atual?.ativo || !atual.podeCriarOlistPedido || atual.aplicativoId !== usuario.aplicativoId ||
          (conta.id !== usuario.aplicativoId && !atual.podeSelecionarFilialFornecedor)) throw new ErroFilaOlist("Permissões alteradas. Atualize a página.", 403);
      if (atual.vinculosOlistVersao !== usuario.vinculosOlistVersao) throw new ErroFilaOlist("Vínculos do vendedor alterados. Revise o pedido.", 409);
      if (!await bloquearDestinoFornecedor(tx, usuario.aplicativoId, conta.id)) throw new ErroFilaOlist("Destino alterado. Revise o pedido.", 409);
      return tx.pedidoFornecedorQueue.create({ data: { ...where, aplicativoFornecedorId: usuario.aplicativoId,
        tipoOrigem: "MANUAL", hashEntrada, vendedorFixo: vendedorId !== null,
        aplicativoFilialId: conta.id, direcionadoPorId: usuario.id, direcionadoEm: new Date(),
        dadosPedido: dados as unknown as Prisma.InputJsonValue, status: "PENDENTE",
      }, select: comprovanteSelect });
    }).catch(async (error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const repetido = await prisma.pedidoFornecedorQueue.findFirst({ where, select: { ...comprovanteSelect, hashEntrada: true } });
      if (!repetido || repetido.hashEntrada !== hashEntrada) throw new ErroFilaOlist("Confirmação concorrente com conteúdo diferente.", 409);
      return repetido;
    });
    return resposta(comprovante(resultado), 201);
  } catch (error) { return falha(error); }
}
