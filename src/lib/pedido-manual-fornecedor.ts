import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { bloquearRelacaoFornecedor, resolverRelacaoFornecedor } from "@/lib/fornecedor-relacao";
import { obterVinculoVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import type { FornecedorPedidoManual } from "@/lib/pedido-manual-referencia";

type AutorManual = { id: string; aplicativoId: string };

export function mesmaConfirmacaoFornecedorManual(a?: FornecedorPedidoManual, b?: FornecedorPedidoManual): boolean {
  if (!a || !b) return a === b;
  return a.autorId === b.autorId && a.aplicativoSolicitanteId === b.aplicativoSolicitanteId && a.matrizId === b.matrizId &&
    JSON.stringify(a.referencia) === JSON.stringify(b.referencia) && JSON.stringify(a.destino) === JSON.stringify(b.destino);
}

/** O servidor deriva a identidade do fornecedor e a confirmação de cada conta. */
export async function capturarFornecedorPedidoManual(autor: AutorManual, referenciaId: string, destinoId: string,
  db: Prisma.TransactionClient = prisma): Promise<FornecedorPedidoManual> {
  const [origem, destino] = await Promise.all([
    resolverRelacaoFornecedor(autor.aplicativoId, referenciaId, db),
    resolverRelacaoFornecedor(autor.aplicativoId, destinoId, db),
  ]);
  if (!origem || !destino || origem.matrizId !== destino.matrizId) {
    throw new ErroFilaOlist("O fornecedor ou a conta destinatária não estão mais autorizados.", 409);
  }
  const referencia = await obterVinculoVendedorDoUsuario(autor.id, referenciaId, db);
  const vinculoDestino = referenciaId === destinoId ? referencia : await obterVinculoVendedorDoUsuario(autor.id, destinoId, db);
  if (!referencia || !vinculoDestino || [referencia, vinculoDestino].some(v =>
    v.origemAplicativoId !== autor.aplicativoId || v.fornecedorMatrizId !== origem.matrizId)) {
    throw new ErroFilaOlist("Aguardando configuração de vendedor pelo fornecedor.", 409);
  }
  return { fornecedorId: origem.fornecedorId, matrizId: origem.matrizId, aplicativoSolicitanteId: autor.aplicativoId, autorId: autor.id,
    referencia: { aplicativoId: referenciaId, vendedorOlistId: referencia.vendedorOlistId, revisao: referencia.revisao },
    destino: { aplicativoId: destinoId, vendedorOlistId: vinculoDestino.vendedorOlistId, revisao: vinculoDestino.revisao } };
}

/** Chamar antes dos locks de usuários para serializar com o encerramento do fornecimento. */
export async function bloquearFornecedorPedidoManual(tx: Prisma.TransactionClient, fornecedor: FornecedorPedidoManual) {
  await bloquearRelacaoFornecedor(tx, fornecedor.aplicativoSolicitanteId, fornecedor.matrizId);
}

export async function validarFornecedorPedidoManual(tx: Prisma.TransactionClient, esperado: FornecedorPedidoManual) {
  const atual = await capturarFornecedorPedidoManual({ id: esperado.autorId, aplicativoId: esperado.aplicativoSolicitanteId },
    esperado.referencia.aplicativoId, esperado.destino.aplicativoId, tx);
  // Cadastros duplicados representam a mesma relação. O ID histórico do cadastro
  // não é reescrito e o encerramento de somente uma linha não revoga o par ativo.
  if (!mesmaConfirmacaoFornecedorManual(atual, esperado)) {
    throw new ErroFilaOlist("Vínculo do vendedor alterado. Gere outra prévia.", 409);
  }
}
