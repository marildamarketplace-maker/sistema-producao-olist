import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ErroFilaOlist } from "./fila-olist-cadastros";
import type { ItemPedidoManual } from "./pedido-manual-contrato";
import { metrosPedido } from "./itens-pedido-producao";

export class ErroMetragemPedido extends ErroFilaOlist {
  readonly codigo = "ITENS_METRAGEM_DESATUALIZADA";
  constructor() {
    super("O consumo do tamanho mudou ou a metragem automática é inválida. Selecione o tamanho novamente ou ajuste a metragem.", 409);
  }
}

const consultaSchema = z.object({ busca: z.string().trim().max(100), pagina: z.coerce.number().int().min(1).max(10000) });
type Banco = { tamanho: { findMany: (args: Prisma.TamanhoFindManyArgs) => Promise<Array<{ id: string; sku: string; titulo?: string; quantidadeProdutoFornecedor: unknown }>> } };
/** Cadastro de tamanhos é global no modelo atual; não retorna preços nem relações. */
export async function consultarTamanhosPedido(params: URLSearchParams, db: Banco = prisma) {
  const { busca, pagina } = consultaSchema.parse({ busca: params.get("busca") ?? "", pagina: params.get("pagina") ?? 1 });
  const itens = await db.tamanho.findMany({
    where: busca ? { OR: [{ titulo: { contains: busca, mode: "insensitive" } }, { sku: { contains: busca, mode: "insensitive" } }] } : {},
    select: { id: true, titulo: true, sku: true, quantidadeProdutoFornecedor: true },
    orderBy: [{ titulo: "asc" }, { id: "asc" }], take: 51, skip: (pagina - 1) * 50,
  });
  return { itens: itens.slice(0, 50).map(t => ({ id: t.id, titulo: t.titulo ?? t.sku, sku: t.sku,
    consumo: t.quantidadeProdutoFornecedor === null ? null : Number(t.quantidadeProdutoFornecedor) })), mais: itens.length > 50, pagina };
}
/** Uma consulta para todos os cálculos automáticos, após autorização e antes do aceite. */
export async function validarMetragensPedido(itens: ItemPedidoManual[], db: Banco = prisma) {
  const automaticos = itens.filter(i => i.modoMetragem === "AUTOMATICA");
  if (!automaticos.length) return;
  const ids = [...new Set(automaticos.flatMap(i => i.tamanhoId ? [i.tamanhoId] : []))];
  const tamanhos = await db.tamanho.findMany({ where: { id: { in: ids } },
    select: { id: true, sku: true, quantidadeProdutoFornecedor: true }, take: ids.length });
  const porId = new Map(tamanhos.map(t => [t.id, t]));
  for (const item of automaticos) {
    const tamanho = porId.get(item.tamanhoId ?? "");
    const consumo = Number(tamanho?.quantidadeProdutoFornecedor);
    if (!tamanho || !Number.isFinite(consumo) || consumo <= 0 || tamanho.sku !== item.tamanho ||
      consumo !== item.consumoUnidade || Math.abs(metrosPedido(item.quantidade, consumo) - item.quantidadeTecido) > 0.0000001) {
      throw new ErroMetragemPedido();
    }
  }
}
