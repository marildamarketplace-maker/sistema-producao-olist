import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PAGINA_DIVULGACAO, type OrdemDivulgacao, type EventoDivulgacao, type PaginaDivulgacao } from "./divulgacao";

// Funções de janela classificam o universo mensal antes do LIMIT. Nenhum histórico
// ou catálogo completo sai do banco. O título só é carregado para a página final.
export function montarConsultaDivulgacao(aplicativoId: string, eventos: EventoDivulgacao[], pagina: number, referencia: Date, ordem: OrdemDivulgacao = "prioridade") {
  const valoresEventos = eventos.length
    ? Prisma.join(eventos.map((evento) => Prisma.sql`(${evento.id}::text, ${evento.peso}::numeric)`))
    : Prisma.sql`(NULL::text, NULL::numeric)`;
  const ordenacao = ordem === "estoque_asc"
    ? Prisma.sql`(c.estoque <= 0) ASC, c.estoque ASC, o.posicao ASC`
    : ordem === "estoque_desc"
      ? Prisma.sql`(c.estoque <= 0) ASC, c.estoque DESC, o.posicao ASC`
      : Prisma.sql`o.posicao ASC`;
  return Prisma.sql`
    WITH parametros AS (
      SELECT ${referencia}::timestamptz AS referencia,
        ((${referencia}::timestamptz AT TIME ZONE 'America/Sao_Paulo') - interval '12 months')
          AT TIME ZONE 'America/Sao_Paulo' AS inicio
    ), eventos(id, peso) AS (VALUES ${valoresEventos}),
    vinculos AS (
      SELECT p.id, p.sku, array_agg(e.id ORDER BY e.peso DESC, e.id COLLATE "C") AS eventos,
        (array_agg(e.id ORDER BY e.peso DESC, e.id COLLATE "C"))[1] AS evento_principal, max(e.peso) AS peso
      FROM public.produtos p
      JOIN public.calendario_evento_produtos v ON v.produto_id = p.id AND v.aplicativo_id = ${aplicativoId}::uuid
      JOIN eventos e ON e.id = v.evento_id
      WHERE p.aplicativo_id = ${aplicativoId}::uuid AND p.ativo = true
      GROUP BY p.id, p.sku
    ), metricas AS (
      SELECT v.id, COALESCE(sum(CASE WHEN m.tipo_movimento = 'entrada' THEN m.quantidade::bigint
        WHEN m.tipo_movimento = 'saida' THEN -m.quantidade::bigint ELSE 0::bigint END), 0)::bigint AS estoque,
        count(m.id) FILTER (WHERE m.tipo_movimento = 'saida' AND m.created_at >= par.inicio)::bigint AS saidas
      FROM vinculos v CROSS JOIN parametros par
      LEFT JOIN public.movimentacoes_estoque m ON m.produto_id = v.id
        AND m.aplicativo_id = ${aplicativoId}::uuid AND m.created_at < par.referencia
      GROUP BY v.id
    ), estatisticas AS (
      -- A mediana inferior produz a mesma separação <=/> da mediana contínua,
      -- inclusive no caso par, sem converter contagens bigint para float.
      SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY saidas) AS mediana, max(saidas) AS maximo
      FROM metricas WHERE estoque > 0
    ), corte AS (
      SELECT CASE WHEN mediana = maximo THEN COALESCE(
        (SELECT max(saidas) FROM metricas WHERE estoque > 0 AND saidas < maximo), mediana
      ) ELSE mediana END AS valor FROM estatisticas
    ), classificados AS (
      SELECT v.id, v.sku, v.eventos, v.evento_principal, v.peso, m.estoque, m.saidas,
        CASE WHEN m.estoque <= 0 THEN 'sem_estoque' WHEN m.saidas <= c.valor THEN 'estoque' ELSE 'saidas' END AS perfil
      FROM vinculos v JOIN metricas m ON m.id = v.id CROSS JOIN corte c
    ), locais AS (
      SELECT id, sku, eventos, evento_principal, peso, estoque, saidas, perfil,
        row_number() OVER (PARTITION BY perfil, evento_principal ORDER BY
          CASE WHEN perfil = 'estoque' THEN estoque END DESC,
          CASE WHEN perfil = 'estoque' THEN saidas END ASC,
          CASE WHEN perfil = 'saidas' THEN saidas END DESC,
          CASE WHEN perfil = 'saidas' THEN estoque END DESC, sku COLLATE "C", id) AS pos_local
      FROM classificados WHERE estoque > 0
    ), filas AS (
      SELECT id, perfil, row_number() OVER (PARTITION BY perfil ORDER BY
        (pos_local::numeric - 0.5) / peso, evento_principal COLLATE "C", sku COLLATE "C", id) AS pos_perfil
      FROM locais
    ), slots AS (
      SELECT id, perfil, CASE WHEN perfil = 'estoque'
        THEN ((pos_perfil - 1) / 6) * 10 + (ARRAY[1,3,4,6,8,9])[((pos_perfil - 1) % 6 + 1)::int]
        ELSE ((pos_perfil - 1) / 4) * 10 + (ARRAY[2,5,7,10])[((pos_perfil - 1) % 4 + 1)::int] END AS pos_virtual
      FROM filas
    ), ordenados AS (
      SELECT id, row_number() OVER (ORDER BY pos_virtual) AS posicao FROM slots
      UNION ALL
      SELECT id, (SELECT count(*) FROM slots) + row_number() OVER (
        ORDER BY estoque DESC, peso DESC, sku COLLATE "C", id) AS posicao
      FROM classificados WHERE estoque <= 0
    ), pagina AS (
      SELECT c.id, c.sku, c.estoque, c.saidas, c.perfil, c.evento_principal, c.eventos, row_number() OVER (ORDER BY ${ordenacao}) AS posicao
      FROM ordenados o JOIN classificados c ON c.id = o.id
      ORDER BY ${ordenacao} LIMIT ${PAGINA_DIVULGACAO + 1} OFFSET ${pagina * PAGINA_DIVULGACAO}
    )
    SELECT pg.id, pg.sku, COALESCE(NULLIF(btrim(p.titulo), ''), NULLIF(btrim(t.titulo), ''), 'Sem título') AS titulo,
      pg.estoque, pg.saidas, pg.perfil, pg.evento_principal AS "eventoPrincipal", pg.eventos,
      par.referencia AS "referenciaEm", par.inicio AS "inicioEm"
    FROM parametros par LEFT JOIN pagina pg ON true
    LEFT JOIN public.produtos p ON p.id = pg.id AND p.aplicativo_id = ${aplicativoId}::uuid
    LEFT JOIN LATERAL (
      SELECT po.titulo_final AS titulo FROM public.produto_olist po WHERE po.produto_id = pg.id
      ORDER BY po.updated_at DESC, po.id ASC LIMIT 1
    ) t ON true ORDER BY pg.posicao
  `;
}

const inteiroSeguro = z.union([z.bigint(), z.number().int(), z.string().regex(/^-?\d+$/)])
  .transform((valor, ctx) => {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero)) {
      ctx.addIssue({ code: "custom", message: "Valor fora dos limites numéricos seguros." });
      return z.NEVER;
    }
    return numero;
  });
const linhaSchema = z.object({
  id: z.uuid(), sku: z.string(), titulo: z.string(), estoque: inteiroSeguro,
  saidas: inteiroSeguro.pipe(z.number().nonnegative()),
  perfil: z.enum(["estoque", "saidas", "sem_estoque"]), eventoPrincipal: z.string(), eventos: z.array(z.string()),
});
const datasSchema = z.object({ referenciaEm: z.date(), inicioEm: z.date() });
export function serializarPaginaDivulgacao(linhas: unknown[]): PaginaDivulgacao {
  const datas = datasSchema.parse(linhas[0]);
  const produtos = linhas.filter((linha) => z.object({ id: z.null() }).safeParse(linha).success === false).map((linha) => linhaSchema.parse(linha));
  return { produtos: produtos.slice(0, PAGINA_DIVULGACAO), temMais: produtos.length > PAGINA_DIVULGACAO,
    referenciaEm: datas.referenciaEm.toISOString(), inicioEm: datas.inicioEm.toISOString() };
}
