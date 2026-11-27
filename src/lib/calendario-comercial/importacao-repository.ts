import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { prepararImportacao, type EntradaImportacao, type ImportacaoCompleta } from "./importacao";

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

// Uma única transação limitada: valida e bloqueia todo o arquivo antes de inserir.
export async function salvarImportacaoCompleta(aplicativoId: string, vinculos: ImportacaoCompleta["vinculos"]) {
  const skus = [...new Set(vinculos.map(v => v.sku))].sort();
  const chaves = [...new Set(vinculos.map(v => `${aplicativoId}:${v.eventoId}`))].sort();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '12s'`;
    // Mesmas chaves do seletor manual, adquiridas em ordem estável para evitar deadlocks.
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(chave, 0))::text
      FROM (SELECT chave FROM (VALUES ${Prisma.join(chaves.map(chave => Prisma.sql`(${chave}::text)`))}) AS e(chave) ORDER BY chave) AS ordenados
    `);
    const produtos = await tx.$queryRaw<{ id: string; sku: string; ativo: boolean }[]>(Prisma.sql`
      SELECT id, sku, ativo FROM public.produtos
      WHERE aplicativo_id = ${aplicativoId}::uuid AND sku IN (${Prisma.join(skus)})
      ORDER BY id FOR UPDATE
    `);
    if (produtos.length !== skus.length || produtos.some(p => !p.ativo)) {
      throw new Error("Produto indisponível na importação.");
    }
    const porSku = new Map(produtos.map(p => [p.sku, p.id]));
    const adicionados = await tx.$executeRaw(Prisma.sql`
      INSERT INTO public.calendario_evento_produtos (aplicativo_id, evento_id, produto_id)
      VALUES ${Prisma.join(vinculos.map(v => Prisma.sql`(${aplicativoId}::uuid, ${v.eventoId}, ${porSku.get(v.sku)}::uuid)`))}
      ON CONFLICT (aplicativo_id, evento_id, produto_id) DO NOTHING
    `);
    return { processados: vinculos.length, adicionados };
  }, { maxWait: 5000, timeout: 20000 });
}
