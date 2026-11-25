import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bloquearRelacaoFornecedor, resolverRelacaoFornecedor } from "@/lib/fornecedor-relacao";
import { obterVinculoVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";

import { type VendedorOrigemFila } from "./vendedor-fila-contrato";
export type EntradaOrigemFila = Omit<VendedorOrigemFila, "tipo"> & { fonte?: "VINCULO" | "MANUAL"; revisaoEsperada?: number };

export async function capturarVendedorFila(entrada: EntradaOrigemFila, db: Prisma.TransactionClient = prisma): Promise<VendedorOrigemFila> {
  const relacao = await resolverRelacaoFornecedor(entrada.aplicativoSolicitanteId, entrada.aplicativoId, db);
  if (!relacao || relacao.matrizId !== entrada.matrizId) throw new ErroFilaOlist("A relação de fornecimento foi encerrada ou alterada.", 409);
  const { usuarioId, aplicativoSolicitanteId, matrizId, aplicativoId, vendedorOlistId } = entrada;
  if (entrada.fonte !== "VINCULO") return { tipo: "MANUAL", usuarioId, aplicativoSolicitanteId, matrizId, aplicativoId, vendedorOlistId };
  const usuario = await db.usuario.findFirst({ where: { id: usuarioId, aplicativoId: aplicativoSolicitanteId, ativo: true }, select: { id: true } });
  const vinculo = usuario ? await obterVinculoVendedorDoUsuario(usuarioId, aplicativoId, db) : null;
  if (!vinculo || vinculo.vendedorOlistId !== vendedorOlistId || vinculo.revisao !== entrada.revisaoEsperada) throw new ErroFilaOlist("Vínculo do vendedor alterado. Atualize e revise a seleção.", 409);
  return { tipo: "VINCULO", usuarioId, aplicativoSolicitanteId, matrizId, aplicativoId, vendedorOlistId, revisao: vinculo.revisao };
}

/** O lock do par precede os locks de usuário e fila; nunca permanece aberto durante HTTP. */
export async function bloquearVendedorFila(tx: Prisma.TransactionClient, origem: VendedorOrigemFila) {
  await bloquearRelacaoFornecedor(tx, origem.aplicativoSolicitanteId, origem.matrizId);
  if (origem.tipo === "VINCULO") await tx.$queryRaw`SELECT id FROM usuario WHERE id=${origem.usuarioId}::uuid FOR SHARE`;
  await capturarVendedorFila({ ...origem, fonte: origem.tipo, revisaoEsperada: origem.tipo === "VINCULO" ? origem.revisao : undefined }, tx);
}

export async function validarOperadorFornecedor(tx: Prisma.TransactionClient, usuarioId: string, matrizId: string) {
  await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuarioId}::uuid FOR SHARE`;
  const operador = await tx.usuario.findFirst({ where: { id: usuarioId, aplicativoId: matrizId, ativo: true, podeGerenciarFilaPedidos: true }, select: { id: true } });
  if (!operador) throw new ErroFilaOlist("Permissão para gerenciar a fila alterada. Atualize a página.", 403);
}
