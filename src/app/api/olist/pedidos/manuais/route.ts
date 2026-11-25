import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { autorizarPedidoManual, resolverContaPedidoManual } from "@/lib/pedido-manual-acesso";
import { pedidoManualSchema, pedidoManualLegadoSchema, montarDadosPedidoManual } from "@/lib/pedido-manual-contrato";
import { consultarCadastrosFilaOlist, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { obterReferenciaPedidoManual, resolverCorrespondenciaPedidoManual } from "@/lib/pedido-manual-correspondencia";
import { resolverDirecionamentoPedido, validarVersaoDirecionamento, ErroDirecionamentoPedidos } from "@/lib/direcionamento-pedidos";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";

const resposta = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });
const comprovanteSelect = { id: true, status: true, createdAt: true, aplicativoFilial: { select: { id: true, nome: true } } } as const;
function comprovante(p: { id: string; status: string; createdAt: Date; aplicativoFilial: { id: string; nome: string } | null }) {
  return { id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), aplicativo: p.aplicativoFilial };
}
type ConfirmacaoManual = {
  where: { aplicativoSolicitanteId: string; autorId: string; chaveIdempotencia: string };
  hashEntrada: string;
};
async function recuperarConfirmacao({ where, hashEntrada }: ConfirmacaoManual) {
  const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where, select: { ...comprovanteSelect, hashEntrada: true } });
  if (!pedido) return null;
  if (pedido.hashEntrada !== hashEntrada) return resposta({ error: "Esta confirmação já foi usada para outro conteúdo. As alterações atuais não foram aplicadas.", pedidoExistente: comprovante(pedido) }, 409);
  return resposta(comprovante(pedido));
}
function falha(error: unknown) {
  if (error instanceof ErroFilaOlist || error instanceof ErroAutorizacaoOlist || error instanceof ErroDirecionamentoPedidos) return resposta({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return resposta({ error: "Revise vendedor, cliente, itens e dados comerciais." }, 400);
  return resposta({ error: "Não foi possível concluir a operação. Confira a integração e tente novamente." }, 502);
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
    if (params.get("acao") === "resolver") {
      const ids = z.object({ vendedorOrigemId: z.coerce.number().int().positive(), clienteOrigemId: z.coerce.number().int().positive(), aplicativoOrigemId: z.guid() }).parse({
        vendedorOrigemId: params.get("vendedorOrigemId"), clienteOrigemId: params.get("clienteOrigemId"), aplicativoOrigemId: params.get("aplicativoOrigemId"),
      });
      const referencia = await obterReferenciaPedidoManual(usuario, ids);
      const { nome, cpfCnpj, uf } = referencia.cliente;
      const decisao = await resolverDirecionamentoPedido(usuario.aplicativoId, { nome, cpfCnpj, uf });
      const selecoes = await resolverCorrespondenciaPedidoManual(usuario, referencia, decisao.aplicativoId, { validarDadosDirecionamento: true });
      return resposta({ referencia, decisao, selecoes: { clienteId: selecoes.clienteId, vendedorId: selecoes.vendedorId, vendedorFixo: selecoes.vendedorFixo } });
    }
    if (!params.has("aplicativoId")) {
      const aplicativos = await prisma.aplicativo.findMany({ where: { OR: [{ id: usuario.aplicativoId }, { aplicativoPaiId: usuario.aplicativoId }] },
        select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1001 });
      if (aplicativos.length > 1000) throw new ErroFilaOlist("Limite de aplicativos excedido.");
      const filhos = aplicativos.filter(a => a.id !== usuario.aplicativoId);
      const opcoes = filhos.length ? filhos : aplicativos;
      const referencia = opcoes[0];
      if (!referencia) throw new ErroFilaOlist("Nenhum aplicativo de referência autorizado.", 403);
      await resolverContaPedidoManual(usuario, referencia.id);
      return resposta({ aplicativos: opcoes, aplicativoPadraoId: referencia.id });
    }
    const { conta, vendedorId } = await resolverContaPedidoManual(usuario, params.get("aplicativoId")!);
    if (!params.has("recurso")) return resposta({ conta, vendedorId, vendedorFixo: vendedorId !== null });
    return resposta(await consultarCadastrosFilaOlist(conta.id, params, { vendedorId }));
  } catch (error) { return falha(error); }
}
export async function POST(request: Request) {
  let confirmacao: ConfirmacaoManual | null = null;
  try {
    const usuario = await autorizarPedidoManual(request);
    const payload: unknown = await request.json().catch(() => null);
    const atual = pedidoManualSchema.safeParse(payload);
    const original = atual.success ? atual.data : pedidoManualLegadoSchema.parse(payload);
    const hashEntrada = createHash("sha256").update(JSON.stringify(original)).digest("hex");
    const where = { aplicativoSolicitanteId: usuario.aplicativoId, autorId: usuario.id, chaveIdempotencia: original.chaveIdempotencia };
    confirmacao = { where, hashEntrada };
    // Repetir um aceite não repete consultas externas nem muda seu resultado.
    const existente = await recuperarConfirmacao(confirmacao);
    if (existente) return existente;
    if (!atual.success) throw new ErroFilaOlist("Atualize a página e revise a origem e o direcionamento do pedido.", 409);
    const entrada = atual.data;
    const origem = await obterReferenciaPedidoManual(usuario, {
      aplicativoOrigemId: entrada.origemManual.aplicativoId,
      vendedorOrigemId: entrada.origemManual.vendedor.id, clienteOrigemId: entrada.origemManual.cliente.id,
    });
    const { nome, cpfCnpj, uf } = origem.cliente;
    const decisao = await resolverDirecionamentoPedido(usuario.aplicativoId, { nome, cpfCnpj, uf });
    if (JSON.stringify(origem) !== JSON.stringify(entrada.origemManual) || JSON.stringify(decisao) !== JSON.stringify(entrada.decisaoDirecionamento) || decisao.aplicativoId !== entrada.aplicativoId) {
      throw new ErroFilaOlist("Cliente ou regras alterados. Revise o direcionamento antes de incluir na fila.", 409);
    }
    const correspondencia = await resolverCorrespondenciaPedidoManual(usuario, origem, decisao.aplicativoId, { validarDadosDirecionamento: true });
    if (entrada.selecoes.clienteId !== correspondencia.clienteId || entrada.selecoes.vendedorId !== correspondencia.vendedorId) throw new ErroFilaOlist("Cadastros do destino alterados. Revise o pedido.", 409);
    const { conta, vendedorId } = await resolverContaPedidoManual(usuario, entrada.aplicativoId);
    if (vendedorId !== null) {
      if (entrada.selecoes.vendedorId !== vendedorId) throw new ErroFilaOlist("Use o vendedor vinculado nesta conta.", 403);
    }
    // O aceite valida apenas os cadastros obrigatórios. Produtos, preços,
    // pagamento e laser permanecem no snapshot e são conferidos na revisão,
    // antes de qualquer criação real na Olist.
    const dados = montarDadosPedidoManual(entrada);
    const resultado = await prisma.$transaction(async tx => {
      // O cadastro de vínculos usa FOR UPDATE no mesmo usuário.
      await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuario.id}::uuid FOR SHARE`;
      const atual = await tx.usuario.findUnique({ where: { id: usuario.id }, select: {
        ativo: true, aplicativoId: true, podeCriarOlistPedido: true, vinculosOlistVersao: true,
      } });
      if (!atual?.ativo || !atual.podeCriarOlistPedido || atual.aplicativoId !== usuario.aplicativoId) throw new ErroFilaOlist("Permissões alteradas. Atualize a página.", 403);
      if (atual.vinculosOlistVersao !== usuario.vinculosOlistVersao) throw new ErroFilaOlist("Vínculos do vendedor alterados. Revise o pedido.", 409);
      await validarVersaoDirecionamento(tx, usuario.aplicativoId, decisao);
      if (!await bloquearDestinoFornecedor(tx, usuario.aplicativoId, origem.aplicativoId)) throw new ErroFilaOlist("Referência alterada. Revise o pedido.", 409);
      if (!await bloquearDestinoFornecedor(tx, usuario.aplicativoId, conta.id)) throw new ErroFilaOlist("Destino alterado. Revise o pedido.", 409);
      return tx.pedidoFornecedorQueue.create({ data: { ...where, aplicativoFornecedorId: usuario.aplicativoId,
        tipoOrigem: "MANUAL", hashEntrada, vendedorFixo: vendedorId !== null,
        aplicativoFilialId: conta.id, direcionadoPorId: usuario.id, direcionadoEm: new Date(),
        dadosPedido: dados as unknown as Prisma.InputJsonValue, status: "PENDENTE",
      }, select: comprovanteSelect });
    });
    return resposta(comprovante(resultado), 201);
  } catch (error) {
    // O aceite concorrente pode terminar durante qualquer consulta/validação,
    // não apenas ao disputar a constraint. Recuperar sempre antes de rejeitar.
    if (confirmacao) {
      try {
        const atual = await autorizarPedidoManual(request);
        if (atual.id === confirmacao.where.autorId && atual.aplicativoId === confirmacao.where.aplicativoSolicitanteId) {
          const existente = await recuperarConfirmacao(confirmacao);
          if (existente) return existente;
        }
      } catch { /* Sem autorização/banco, preservar o erro original e a chave no cliente. */ }
    }
    return falha(error);
  }
}
