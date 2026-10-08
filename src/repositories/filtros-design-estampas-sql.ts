import { Prisma } from "@prisma/client";
import { CONFIANCA_MINIMA_APLICACAO_PESQUISA, FILTROS_DESIGN_PESQUISA, type FiltrosDesignPesquisa } from "@/domain/pesquisa-estampas-design";

export function filtrosDesignEstampasSql(filtros: FiltrosDesignPesquisa): Prisma.Sql[] {
  const condicoes: Prisma.Sql[] = [];
  for (const { campo } of FILTROS_DESIGN_PESQUISA) {
    const valor = filtros[campo];
    if (!valor) continue;
    if (campo === "estilo") {
      condicoes.push(Prisma.sql`lower(e.estilo) = lower(${valor})`);
    } else if (campo === "aplicacaoSugerida") {
      condicoes.push(Prisma.sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE
          WHEN e.ai_metadata #>> '{response,aplicacoesSugeridas,estado}' = 'IDENTIFICADO'
            AND jsonb_typeof(e.ai_metadata #> '{response,aplicacoesSugeridas,sugestoes}') = 'array'
          THEN e.ai_metadata #> '{response,aplicacoesSugeridas,sugestoes}' ELSE '[]'::jsonb END) AS sugestao
        WHERE sugestao->>'termo' = ${valor}
          AND ${confiancaAplicacaoSql()}
      )`);
    } else {
      const atributo = { estado: "IDENTIFICADO", valores: [valor] };
      const resposta = campo === "linguagemVisual"
        ? { linguagemVisual: atributo } : { composicaoVisual: { [campo]: atributo } };
      condicoes.push(Prisma.sql`e.ai_metadata @> ${JSON.stringify({ response: resposta })}::jsonb`);
    }
  }
  return condicoes;
}

export function confiancaAplicacaoSql() {
  return Prisma.sql`CASE WHEN jsonb_typeof(sugestao->'confianca') = 'number'
    THEN (sugestao->>'confianca')::numeric BETWEEN ${CONFIANCA_MINIMA_APLICACAO_PESQUISA} AND 1
    ELSE FALSE END`;
}
