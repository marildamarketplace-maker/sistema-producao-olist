import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { prepararImportacao, type EntradaImportacao } from "./importacao";

export async function previaImportacaoCalendario(aplicativoId: string, entrada: EntradaImportacao) {
  return prepararImportacao(entrada, {
    produtos: async skus => {
      const produtos: { id: string; sku: string; ativo: boolean }[] = [];
      for (let i = 0; i < skus.length; i += 500) produtos.push(...await prisma.produto.findMany({
        where: { aplicativoId, sku: { in: skus.slice(i, i + 500) } },
        select: { id: true, sku: true, ativo: true }, take: 500,
      }));
      return produtos;
    },
    existentes: async pares => {
      const vinculos: { produtoId: string; eventoId: string }[] = [];
      for (let i = 0; i < pares.length; i += 500) vinculos.push(...await prisma.$queryRaw<{ produtoId: string; eventoId: string }[]>(Prisma.sql`
        SELECT produto_id AS "produtoId", evento_id AS "eventoId"
        FROM public.calendario_evento_produtos
        WHERE aplicativo_id = ${aplicativoId}::uuid AND (produto_id, evento_id) IN (
          VALUES ${Prisma.join(pares.slice(i, i + 500).map(p => Prisma.sql`(${p.produtoId}::uuid, ${p.eventoId}::text)`))}
        ) LIMIT 500
      `));
      return vinculos;
    },
  });
}
