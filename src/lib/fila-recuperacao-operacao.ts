import type { PedidoFornecedorQueue, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { dadosPedidoFilaSchema } from "./fila-fornecedor-contrato";
import { entradaRecuperacaoSchema, referenciaRecuperacao, recuperarCampoOlist, estadoRecuperacao } from "./fila-recuperacao-olist";
import { ErroFilaOlist } from "./fila-olist-cadastros";
import { destinoFornecedorWhere, bloquearDestinoFornecedor } from "./fila-fornecedor-destino";
import { validarOperadorFornecedor } from "./vendedor-fila-producao";
import { obterVendedorDoUsuario } from "./usuario-vendedor-olist";
import { envioBloqueado } from "./envio-fornecedor";
import { bloquearPedidoManual } from "./envio-pedido-manual";

/** Leitura remota fora da transação; resultados persistidos com comparação de versão. */
export async function operarRecuperacaoFila(fila: PedidoFornecedorQueue, matrizId: string, usuarioId: string, entrada: unknown) {
  const body = entradaRecuperacaoSchema.parse(entrada);
  if (fila.versao !== body.versao || fila.aplicativoFilialId !== body.filialId || !["PENDENTE", "FALHADO"].includes(fila.status)) {
    throw new ErroFilaOlist("Pedido ou aplicativo alterado. Feche e atualize a fila.", 409);
  }
  const dados = dadosPedidoFilaSchema.parse(fila.dadosPedido), referencia = referenciaRecuperacao(dados, body.filialId);
  if (!referencia) throw new ErroFilaOlist("Pedido sem referência em outro aplicativo.", 409);
  for (const app of new Set([referencia.filialId, body.filialId])) {
    if (!await prisma.aplicativo.findFirst({ where: destinoFornecedorWhere(matrizId, app), select: { id: true } })) throw new ErroFilaOlist("Conta não autorizada para recuperar os cadastros.", 403);
  }
  const fixo = fila.tipoOrigem === "MANUAL" && fila.vendedorFixo && fila.autorId ? await obterVendedorDoUsuario(fila.autorId, body.filialId) : null;
  if (fila.vendedorFixo && fila.tipoOrigem === "MANUAL" && !fixo) throw new ErroFilaOlist("Vínculo do vendedor indisponível nesta conta.", 409);
  const resultado = await recuperarCampoOlist(dados, body.filialId, body.chave, fixo);
  const antigos = dados.recuperacaoOlist?.filialId === body.filialId ? dados.recuperacaoOlist.campos : [];
  const novos = [...antigos.filter(c => c.chave !== body.chave), resultado.campo];
  const atualizado = { ...dados, olistAnterior: referencia, olist: { filialId: body.filialId, selecoes: resultado.selecoes },
    recuperacaoOlist: { filialId: body.filialId, campos: novos } };
  await prisma.$transaction(async tx => {
    await validarOperadorFornecedor(tx, usuarioId, matrizId);
    for (const app of [...new Set([referencia.filialId, body.filialId])].sort()) {
      if (!await bloquearDestinoFornecedor(tx, matrizId, app)) throw new ErroFilaOlist("Conta alterada durante a recuperação.", 409);
    }
    if (fila.tipoOrigem === "MANUAL") await bloquearPedidoManual(tx, fila.id);
    else if (fila.solicitacaoProducaoId) await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id=${fila.solicitacaoProducaoId}::uuid FOR UPDATE`;
    const envio = fila.tipoOrigem === "MANUAL" ? await tx.envioPedidoManual.findUnique({ where: { filaId: fila.id }, select: { estado: true } })
      : fila.solicitacaoProducaoId ? await tx.envioFornecedor.findUnique({ where: { solicitacaoId: fila.solicitacaoProducaoId }, select: { estado: true } }) : null;
    if (envio && envioBloqueado(envio.estado)) throw new ErroFilaOlist("Envio em andamento ou sem conferência.", 409);
    const salvo = await tx.pedidoFornecedorQueue.updateMany({ where: { id: fila.id, aplicativoFornecedorId: matrizId,
      aplicativoFilialId: body.filialId, versao: body.versao, status: { in: ["PENDENTE", "FALHADO"] } },
      data: { versao: { increment: 1 }, dadosPedido: JSON.parse(JSON.stringify(atualizado)) as Prisma.InputJsonValue } });
    if (salvo.count !== 1) throw new ErroFilaOlist("Pedido alterado durante a recuperação. Atualize a fila.", 409);
  });
  return { filialId: body.filialId, versao: body.versao + 1, selecoes: resultado.selecoes, recuperacao: estadoRecuperacao(atualizado, body.filialId) };
}
