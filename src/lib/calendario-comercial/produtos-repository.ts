import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aplicarAlteracoesProdutos, TAMANHO_PAGINA, type AlteracoesProdutos, type ProdutoEvento } from "./produtos";

export async function buscarProdutosEvento(aplicativoId: string, filtros: {
  eventoId: string; busca: string; associados: boolean; pagina: number;
}) {
  // Literalizar curingas: a busca por SKU não deve transformar % e _ em filtros amplos.
  const termo = `%${filtros.busca.replace(/[\\%_]/g, "\\$&")}%`;
  const linhas = await prisma.$queryRaw<ProdutoEvento[]>(Prisma.sql`
    SELECT p.id, p.sku, COALESCE(NULLIF(t.titulo, ''), 'Sem título') AS titulo,
      p.ativo, (v.produto_id IS NOT NULL) AS associado
    FROM public.produtos p
    LEFT JOIN LATERAL (
      SELECT po.titulo_final AS titulo FROM public.produto_olist po
      WHERE po.produto_id = p.id
      ORDER BY po.updated_at DESC, po.id ASC LIMIT 1
    ) t ON true
    LEFT JOIN public.calendario_evento_produtos v
      ON v.aplicativo_id = ${aplicativoId}::uuid AND v.evento_id = ${filtros.eventoId}
      AND v.produto_id = p.id
    WHERE p.aplicativo_id = ${aplicativoId}::uuid
      AND ${filtros.associados ? Prisma.sql`v.produto_id IS NOT NULL` : Prisma.sql`p.ativo = true`}
      AND (p.sku ILIKE ${termo} OR t.titulo ILIKE ${termo})
    ORDER BY p.sku ASC, p.id ASC
    LIMIT ${TAMANHO_PAGINA + 1} OFFSET ${filtros.pagina * TAMANHO_PAGINA}
  `);
  return { produtos: linhas.slice(0, TAMANHO_PAGINA), temMais: linhas.length > TAMANHO_PAGINA };
}

export async function contarProdutosEventos(aplicativoId: string, eventos: string[]) {
  if (!eventos.length) return {};
  const linhas = await prisma.$queryRaw<{ eventoId: string; total: number }[]>(Prisma.sql`
    SELECT evento_id AS "eventoId", count(*)::int AS total
    FROM public.calendario_evento_produtos
    WHERE aplicativo_id = ${aplicativoId}::uuid AND evento_id IN (${Prisma.join(eventos)})
    GROUP BY evento_id
  `);
  return Object.fromEntries(linhas.map((linha) => [linha.eventoId, linha.total]));
}

export async function salvarProdutosEvento(aplicativoId: string, dados: AlteracoesProdutos) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
    // Serializa salvamentos do mesmo evento, inclusive quando ainda não há vínculos.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${aplicativoId}:${dados.eventoId}`}, 0))::text`;
    await aplicarAlteracoesProdutos(dados, {
      bloquearProdutosAtivos: async (ids) => {
        const linhas = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM public.produtos
          WHERE aplicativo_id = ${aplicativoId}::uuid AND ativo = true
            AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY id FOR UPDATE
        `);
        return linhas.map((linha) => linha.id);
      },
      adicionar: async (ids) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO public.calendario_evento_produtos (aplicativo_id, evento_id, produto_id)
          VALUES ${Prisma.join(ids.map((id) => Prisma.sql`(${aplicativoId}::uuid, ${dados.eventoId}, ${id}::uuid)`))}
          ON CONFLICT (aplicativo_id, evento_id, produto_id) DO NOTHING
        `);
      },
      remover: async (ids) => {
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM public.calendario_evento_produtos
          WHERE aplicativo_id = ${aplicativoId}::uuid AND evento_id = ${dados.eventoId}
            AND produto_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        `);
      },
    });
  }, { maxWait: 5000, timeout: 10000 });
}
