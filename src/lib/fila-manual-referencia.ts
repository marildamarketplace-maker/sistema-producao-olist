import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import type { ReferenciaPedidoManual, FornecedorPedidoManual } from "@/lib/pedido-manual-referencia";
import type { UsuarioCorrespondenciaPedidoManual } from "@/lib/pedido-manual-correspondencia";
import { bloquearFornecedorPedidoManual, validarFornecedorPedidoManual } from "@/lib/pedido-manual-fornecedor";

export type AutorReferenciaFilaManual = UsuarioCorrespondenciaPedidoManual & { vinculosOlistVersao: number; podeSelecionarFilialFornecedor: boolean };
export type GuardaReferenciaFilaManual = {
  autorId: string;
  aplicativoId: string;
  vinculosOlistVersao: number;
  podeSelecionarFilialFornecedor: boolean;
  origemAplicativoId: string;
  fornecedorManual?: FornecedorPedidoManual;
};

export async function obterAutorReferenciaFilaManual(autorId: string | null, aplicativoId: string): Promise<AutorReferenciaFilaManual> {
  if (!autorId) throw new ErroFilaOlist("O autor do pedido não está disponível para validar a referência.", 409);
  const autor = await prisma.usuario.findFirst({
    where: { id: autorId, aplicativoId, ativo: true },
    select: { id: true, aplicativoId: true, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: true },
  });
  if (!autor) throw new ErroFilaOlist("O autor do pedido está inativo ou não pertence mais a este aplicativo.", 409);
  return autor;
}

export function guardaReferenciaFilaManual(autor: AutorReferenciaFilaManual, referencia: ReferenciaPedidoManual, fornecedorManual?: FornecedorPedidoManual): GuardaReferenciaFilaManual {
  return { autorId: autor.id, aplicativoId: autor.aplicativoId, vinculosOlistVersao: autor.vinculosOlistVersao,
    podeSelecionarFilialFornecedor: autor.podeSelecionarFilialFornecedor, origemAplicativoId: referencia.aplicativoId,
    ...(fornecedorManual ? { fornecedorManual } : {}) };
}

async function validarOperadorAtual(tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string) {
  const operador = await tx.usuario.findUnique({ where: { id: usuarioId }, select: {
    ativo: true, aplicativoId: true, podeGerenciarFilaPedidos: true,
  } });
  if (!operador?.ativo || operador.aplicativoId !== aplicativoId || !operador.podeGerenciarFilaPedidos) {
    throw new ErroFilaOlist("Permissão para gerenciar a fila alterada. Atualize a página.", 403);
  }
}

async function validarGuardaAtual(tx: Prisma.TransactionClient, guarda: GuardaReferenciaFilaManual) {
  const atual = await tx.usuario.findUnique({ where: { id: guarda.autorId }, select: {
    ativo: true, aplicativoId: true, vinculosOlistVersao: true, podeSelecionarFilialFornecedor: true,
  } });
  if (!atual?.ativo || atual.aplicativoId !== guarda.aplicativoId || (!guarda.fornecedorManual && atual.vinculosOlistVersao !== guarda.vinculosOlistVersao) ||
      atual.podeSelecionarFilialFornecedor !== guarda.podeSelecionarFilialFornecedor) {
    throw new ErroFilaOlist("Permissões ou vínculos do autor alterados. Revise o pedido novamente.", 409);
  }
  if (guarda.fornecedorManual) {
    if (guarda.fornecedorManual.autorId !== guarda.autorId || guarda.fornecedorManual.aplicativoSolicitanteId !== guarda.aplicativoId ||
        guarda.fornecedorManual.referencia.aplicativoId !== guarda.origemAplicativoId) {
      throw new ErroFilaOlist("Origem do fornecedor inválida. Revise o pedido.", 409);
    }
    await validarFornecedorPedidoManual(tx, guarda.fornecedorManual);
  }
}

/** O cadastro de vínculos usa FOR UPDATE no usuário. */
export async function validarGuardaReferenciaFilaManual(tx: Prisma.TransactionClient, guarda: GuardaReferenciaFilaManual) {
  if (guarda.fornecedorManual) await bloquearFornecedorPedidoManual(tx, guarda.fornecedorManual);
  await tx.$queryRaw`SELECT id FROM usuario WHERE id=${guarda.autorId}::uuid FOR SHARE`;
  await validarGuardaAtual(tx, guarda);
}

/** Mantém a mesma ordem de locks quando operador e autor são pessoas diferentes. */
export async function validarAtoresFilaManual(tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string,
  guarda?: GuardaReferenciaFilaManual, autorLegadoId?: string) {
  if (guarda?.fornecedorManual) {
    if (guarda.fornecedorManual.matrizId !== aplicativoId) throw new ErroFilaOlist("Fornecedor não corresponde à fila.", 403);
    await bloquearFornecedorPedidoManual(tx, guarda.fornecedorManual);
  }
  const ids = [...new Set([usuarioId, ...(guarda ? [guarda.autorId] : autorLegadoId ? [autorLegadoId] : [])])].sort();
  for (const id of ids) await tx.$queryRaw`SELECT id FROM usuario WHERE id=${id}::uuid FOR SHARE`;
  await validarOperadorAtual(tx, usuarioId, aplicativoId);
  if (guarda) await validarGuardaAtual(tx, guarda);
}
