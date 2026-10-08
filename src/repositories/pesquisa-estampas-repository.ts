import type { FacetasDesignPesquisa, FiltrosDesignPesquisa } from "@/domain/pesquisa-estampas-design";
import { filtrosDesignEstampasSql, confiancaAplicacaoSql } from "@/repositories/filtros-design-estampas-sql";
import { Prisma } from "@prisma/client";
import {
  CONTEUDOS_IMAGEM_ESTAMPA,
  SUPORTES_APLICACAO_ESTAMPA,
  TIPOS_IMAGEM_ESTAMPA,
  type ConteudoImagemEstampa,
  type SuporteAplicacaoEstampa,
  type TipoImagemEstampa,
} from "@/domain/estampa-apresentacao";
import { prisma } from "@/lib/prisma";
import { expandirConsultaComVocabularioTextil } from "@/domain/estampa-taxonomia-textil";
import { consultaEstampasSql } from "@/repositories/consulta-estampas-sql";

export const ORDENACOES_PESQUISA_ESTAMPAS = [
  "RELEVANCIA",
  "RECENTES",
  "CODIGO_ASC",
  "CODIGO_DESC",
] as const;

export type OrdenacaoPesquisaEstampas =
  (typeof ORDENACOES_PESQUISA_ESTAMPAS)[number];

export const STATUS_PESQUISA_ESTAMPAS = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

export type StatusPesquisaEstampas =
  (typeof STATUS_PESQUISA_ESTAMPAS)[number];

export type FiltrosPesquisaEstampas = FiltrosDesignPesquisa & {
  modoCores?: "TODAS" | "QUALQUER";
  consulta?: string;
  codigo?: string;
  variante?: string;
  tema?: string;
  cores?: string[];
  palavraChave?: string;
  elementoVisual?: string;
  categoria?: string;
  ocasiao?: string;
  publicoSugerido?: string;
  contextoUso?: string;
  afinidadeVisual?: string;
  padraoTextil?: string;
  tipoImagem?: TipoImagemEstampa;
  suporteAplicacao?: SuporteAplicacaoEstampa;
  conteudoImagem?: ConteudoImagemEstampa;
  status?: StatusPesquisaEstampas;
  ordenacao: OrdenacaoPesquisaEstampas;
  limite: number;
  offset: number;
  somenteAtivas?: boolean;
};

export type EstampaPesquisaRow = {
  id: bigint;
  codigo: string;
  variante: string | null;
  previewUrl: string | null;
  titulo: string | null;
  descricao: string | null;
  tema: string | null;
  subtemas: string[];
  palavrasChave: string[];
  cores: string[];
  elementosVisuais: string[];
  ocasioes: string[];
  categorias: string[];
  estilo: string | null;
  tipoImagem: TipoImagemEstampa;
  conteudosImagem: ConteudoImagemEstampa[];
  suporteAplicacao: SuporteAplicacaoEstampa;
  descricaoAplicacao: string | null;
  confiancaTipoImagem: number | null;
  publicosSugeridos: string[];
  contextosUso: string[];
  afinidadesVisuais: string[];
  confiancaSegmentacao: number | null;
  segmentacaoBusca: unknown;
  padroesTexteis: string[];
  confiancaPadraoTextil: number | null;
  classificacaoTextil: unknown;
  processingStatus: string;
  processedAt: Date | null;
  createdAt: Date;
  relevancia: number;
  atributosDesign: unknown;
};

export type FacetasPesquisaEstampas = FacetasDesignPesquisa & {
  temas: string[];
  cores: string[];
  elementosVisuais: string[];
  categorias: string[];
  ocasioes: string[];
  publicosSugeridos: string[];
  contextosUso: string[];
  afinidadesVisuais: string[];
  padroesTexteis: string[];
  tiposImagem: TipoImagemEstampa[];
  conteudosImagem: ConteudoImagemEstampa[];
  suportesAplicacao: SuporteAplicacaoEstampa[];
};

export async function pesquisarCatalogoEstampas(
  filtros: FiltrosPesquisaEstampas,
): Promise<{ estampas: EstampaPesquisaRow[]; total: number }> {
  const consulta = normalizarTexto(filtros.consulta);
  const consultaTextilExpandida = expandirConsultaComVocabularioTextil(consulta);
  const codigoConsulta = extrairCodigoConsulta(consulta);
  const codigoVarianteConsulta = extrairCodigoVarianteConsulta(consulta);
  const termos = consultaEstampasSql(consultaTextilExpandida);

  const condicoes: Prisma.Sql[] = filtrosDesignEstampasSql(filtros);
  if (filtros.somenteAtivas !== false) {
    condicoes.push(Prisma.sql`e.is_active = TRUE`);
  }
  if (filtros.status) {
    condicoes.push(Prisma.sql`e.processing_status = ${filtros.status}`);
  }
  if (filtros.tipoImagem) {
    condicoes.push(Prisma.sql`e.tipo_imagem = ${filtros.tipoImagem}`);
  }
  if (filtros.suporteAplicacao) {
    condicoes.push(Prisma.sql`e.suporte_aplicacao = ${filtros.suporteAplicacao}`);
  }
  if (filtros.conteudoImagem) {
    condicoes.push(
      Prisma.sql`e.conteudos_imagem @> ARRAY[${filtros.conteudoImagem}]::TEXT[]`,
    );
  }
  if (normalizarTexto(filtros.codigo)) {
    condicoes.push(
      Prisma.sql`lower(e.codigo) = lower(${normalizarTexto(filtros.codigo)})`,
    );
  }
  if (normalizarTexto(filtros.variante)) {
    condicoes.push(
      Prisma.sql`lower(COALESCE(e.variante, '')) = lower(${normalizarTexto(filtros.variante)})`,
    );
  }
  if (normalizarTexto(filtros.tema)) {
    condicoes.push(
      Prisma.sql`lower(COALESCE(e.tema, '')) = lower(${normalizarTexto(filtros.tema)})`,
    );
  }
  const cores = normalizarLista(filtros.cores);
  if (cores.length > 0) {
    condicoes.push(
      filtros.modoCores === "QUALQUER"
        ? Prisma.sql`e.cores && ARRAY[${Prisma.join(cores)}]::TEXT[]`
        : Prisma.sql`e.cores @> ARRAY[${Prisma.join(cores)}]::TEXT[]`,
    );
  }
  adicionarFiltroArrayParcial(
    condicoes,
    "palavras_chave",
    normalizarTexto(filtros.palavraChave),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "elementos_visuais",
    normalizarTexto(filtros.elementoVisual),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "categorias",
    normalizarTexto(filtros.categoria),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "ocasioes",
    normalizarTexto(filtros.ocasiao),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "publicos_sugeridos",
    normalizarTexto(filtros.publicoSugerido),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "contextos_uso",
    normalizarTexto(filtros.contextoUso),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "afinidades_visuais",
    normalizarTexto(filtros.afinidadeVisual),
  );
  adicionarFiltroArrayExato(
    condicoes,
    "padroes_texteis",
    normalizarTexto(filtros.padraoTextil),
  );

  if (consulta) {
    const correspondencias: Prisma.Sql[] = [
      Prisma.sql`e.search_vector @@ ${termos}`,
    ];
    if (codigoVarianteConsulta) {
      correspondencias.push(Prisma.sql`(
        lower(e.codigo) = lower(${codigoVarianteConsulta.codigo})
        AND lower(COALESCE(e.variante, '')) = lower(${codigoVarianteConsulta.variante})
      )`);
    } else if (codigoConsulta) {
      correspondencias.push(
        Prisma.sql`lower(e.codigo) = lower(${codigoConsulta})`,
      );
    }
    condicoes.push(
      Prisma.sql`(${Prisma.join(correspondencias, " OR ")})`,
    );
  }

  const where = condicoes.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}`
    : Prisma.empty;
  const relevancia = consulta
    ? Prisma.sql`(
        CASE WHEN ${codigoVarianteConsulta !== null}
          AND lower(e.codigo) = lower(${codigoVarianteConsulta?.codigo ?? ""})
          AND lower(COALESCE(e.variante, '')) = lower(${codigoVarianteConsulta?.variante ?? ""})
          THEN 1000 ELSE 0 END
        + CASE WHEN ${codigoConsulta !== null}
          AND lower(e.codigo) = lower(${codigoConsulta ?? ""})
          THEN 500 ELSE 0 END
        + CASE WHEN lower(extensions.unaccent(COALESCE(e.titulo, ''))) = lower(extensions.unaccent(${consulta})) THEN 100 ELSE 0 END
        + CASE WHEN lower(extensions.unaccent(COALESCE(e.titulo, ''))) LIKE '%' || lower(extensions.unaccent(${consulta})) || '%' THEN 50 ELSE 0 END
        + ts_rank_cd(e.search_vector, ${termos}, 32) * 25
      )::DOUBLE PRECISION`
    : Prisma.sql`0::DOUBLE PRECISION`;
  const orderBy = criarOrdenacao(filtros.ordenacao, Boolean(consulta));

  const [estampas, totalRows] = await prisma.$transaction([
    prisma.$queryRaw<EstampaPesquisaRow[]>`
      SELECT
        e.id,
        e.codigo,
        e.variante,
        e.preview_url AS "previewUrl",
        e.titulo,
        e.descricao,
        e.tema,
        e.subtemas,
        e.palavras_chave AS "palavrasChave",
        e.cores,
        e.elementos_visuais AS "elementosVisuais",
        e.ocasioes,
        e.categorias,
        e.estilo,
        e.ai_metadata->'response' AS "atributosDesign",
        e.tipo_imagem AS "tipoImagem",
        e.conteudos_imagem AS "conteudosImagem",
        e.suporte_aplicacao AS "suporteAplicacao",
        e.descricao_aplicacao AS "descricaoAplicacao",
        e.confianca_tipo_imagem AS "confiancaTipoImagem",
        e.publicos_sugeridos AS "publicosSugeridos",
        e.contextos_uso AS "contextosUso",
        e.afinidades_visuais AS "afinidadesVisuais",
        e.confianca_segmentacao AS "confiancaSegmentacao",
        COALESCE(
          e.ai_metadata->'response'->'segmentacaoBusca',
          '{"publicosSugeridos":[],"contextosUso":[],"afinidadesVisuais":[]}'::JSONB
        ) AS "segmentacaoBusca",
        e.padroes_texteis AS "padroesTexteis",
        e.confianca_padrao_textil AS "confiancaPadraoTextil",
        COALESCE(
          e.ai_metadata->'response'->'classificacaoTextil',
          '{"padroesTexteis":[]}'::JSONB
        ) AS "classificacaoTextil",
        e.processing_status AS "processingStatus",
        e.processed_at AS "processedAt",
        e.created_at AS "createdAt",
        ${relevancia} AS relevancia
      FROM estampas AS e
      ${where}
      ${orderBy}
      LIMIT ${filtros.limite}
      OFFSET ${filtros.offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::BIGINT AS total
      FROM estampas AS e
      ${where}
    `,
  ]);

  return { estampas, total: Number(totalRows[0]?.total ?? 0) };
}

export async function listarFacetasPesquisaEstampas(status?: StatusPesquisaEstampas): Promise<FacetasPesquisaEstampas> {
  const rows = await prisma.$queryRaw<Array<{ tipo: string; valor: string }>>`
    WITH base AS MATERIALIZED (
      SELECT * FROM estampas WHERE is_active = TRUE
      ${status ? Prisma.sql`AND processing_status = ${status}` : Prisma.empty}
    ), valores AS (
      SELECT 'temas'::TEXT AS tipo, tema AS valor FROM base
      UNION ALL SELECT 'cores', unnest(cores) FROM base
      UNION ALL SELECT 'elementosVisuais', unnest(elementos_visuais) FROM base
      UNION ALL SELECT 'categorias', unnest(categorias) FROM base
      UNION ALL SELECT 'ocasioes', unnest(ocasioes) FROM base
      UNION ALL SELECT 'publicosSugeridos', unnest(publicos_sugeridos) FROM base
      UNION ALL SELECT 'contextosUso', unnest(contextos_uso) FROM base
      UNION ALL SELECT 'afinidadesVisuais', unnest(afinidades_visuais) FROM base
      UNION ALL SELECT 'padroesTexteis', unnest(padroes_texteis) FROM base
      UNION ALL SELECT 'estilos', estilo FROM base
      UNION ALL SELECT 'tiposImagem', tipo_imagem FROM base
      UNION ALL SELECT 'conteudosImagem', unnest(conteudos_imagem) FROM base
      UNION ALL SELECT 'suportesAplicacao', suporte_aplicacao FROM base
      UNION ALL SELECT 'distribuicoes', jsonb_array_elements_text(CASE WHEN ai_metadata #>> '{response,composicaoVisual,distribuicao,estado}' = 'IDENTIFICADO' AND jsonb_typeof(ai_metadata #> '{response,composicaoVisual,distribuicao,valores}') = 'array' THEN ai_metadata #> '{response,composicaoVisual,distribuicao,valores}' ELSE '[]'::jsonb END) FROM base
      UNION ALL SELECT 'orientacoes', jsonb_array_elements_text(CASE WHEN ai_metadata #>> '{response,composicaoVisual,orientacao,estado}' = 'IDENTIFICADO' AND jsonb_typeof(ai_metadata #> '{response,composicaoVisual,orientacao,valores}') = 'array' THEN ai_metadata #> '{response,composicaoVisual,orientacao,valores}' ELSE '[]'::jsonb END) FROM base
      UNION ALL SELECT 'densidades', jsonb_array_elements_text(CASE WHEN ai_metadata #>> '{response,composicaoVisual,densidade,estado}' = 'IDENTIFICADO' AND jsonb_typeof(ai_metadata #> '{response,composicaoVisual,densidade,valores}') = 'array' THEN ai_metadata #> '{response,composicaoVisual,densidade,valores}' ELSE '[]'::jsonb END) FROM base
      UNION ALL SELECT 'linguagensVisuais', jsonb_array_elements_text(CASE WHEN ai_metadata #>> '{response,linguagemVisual,estado}' = 'IDENTIFICADO' AND jsonb_typeof(ai_metadata #> '{response,linguagemVisual,valores}') = 'array' THEN ai_metadata #> '{response,linguagemVisual,valores}' ELSE '[]'::jsonb END) FROM base
      UNION ALL SELECT 'aplicacoesSugeridas', sugestao->>'termo' FROM base
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN ai_metadata #>> '{response,aplicacoesSugeridas,estado}' = 'IDENTIFICADO' AND jsonb_typeof(ai_metadata #> '{response,aplicacoesSugeridas,sugestoes}') = 'array' THEN ai_metadata #> '{response,aplicacoesSugeridas,sugestoes}' ELSE '[]'::jsonb END) AS sugestao
        WHERE ${confiancaAplicacaoSql()}
    ), distintos AS (
      SELECT tipo,
        CASE WHEN tipo IN ('tiposImagem', 'conteudosImagem', 'suportesAplicacao')
          THEN upper(btrim(valor))
          ELSE lower(regexp_replace(btrim(valor), '[[:space:]]+', ' ', 'g')) END AS valor,
        count(*) AS frequencia
      FROM valores
      WHERE btrim(COALESCE(valor, '')) <> ''
      GROUP BY tipo, CASE WHEN tipo IN ('tiposImagem', 'conteudosImagem', 'suportesAplicacao')
        THEN upper(btrim(valor))
        ELSE lower(regexp_replace(btrim(valor), '[[:space:]]+', ' ', 'g')) END
    ), numerados AS (
      SELECT tipo, valor, frequencia,
        row_number() OVER (PARTITION BY tipo ORDER BY frequencia DESC, valor) AS posicao
      FROM distintos
    )
    SELECT tipo, valor FROM numerados WHERE posicao <= 300 ORDER BY tipo, frequencia DESC, valor
  `;
  const facetas: FacetasPesquisaEstampas = {
    estilos: [], distribuicoes: [], orientacoes: [], densidades: [], linguagensVisuais: [], aplicacoesSugeridas: [],
    temas: [],
    cores: [],
    elementosVisuais: [],
    categorias: [],
    ocasioes: [],
    publicosSugeridos: [],
    contextosUso: [],
    afinidadesVisuais: [],
    padroesTexteis: [],
    tiposImagem: [],
    conteudosImagem: [],
    suportesAplicacao: [],
  };
  for (const row of rows) {
    switch (row.tipo) {
      case "estilos": case "distribuicoes": case "orientacoes": case "densidades": case "linguagensVisuais": case "aplicacoesSugeridas":
        facetas[row.tipo].push(row.valor); break;
      case "tiposImagem": if ((TIPOS_IMAGEM_ESTAMPA as readonly string[]).includes(row.valor)) facetas.tiposImagem.push(row.valor as TipoImagemEstampa); break;
      case "conteudosImagem": if ((CONTEUDOS_IMAGEM_ESTAMPA as readonly string[]).includes(row.valor)) facetas.conteudosImagem.push(row.valor as ConteudoImagemEstampa); break;
      case "suportesAplicacao": if ((SUPORTES_APLICACAO_ESTAMPA as readonly string[]).includes(row.valor)) facetas.suportesAplicacao.push(row.valor as SuporteAplicacaoEstampa); break;
      case "temas": facetas.temas.push(row.valor); break;
      case "cores": facetas.cores.push(row.valor); break;
      case "elementosVisuais": facetas.elementosVisuais.push(row.valor); break;
      case "categorias": facetas.categorias.push(row.valor); break;
      case "ocasioes": facetas.ocasioes.push(row.valor); break;
      case "publicosSugeridos": facetas.publicosSugeridos.push(row.valor); break;
      case "contextosUso": facetas.contextosUso.push(row.valor); break;
      case "afinidadesVisuais": facetas.afinidadesVisuais.push(row.valor); break;
      case "padroesTexteis": facetas.padroesTexteis.push(row.valor); break;
    }
  }
  return facetas;
}

function criarOrdenacao(ordenacao: OrdenacaoPesquisaEstampas, possuiConsulta: boolean) {
  if (ordenacao === "CODIGO_ASC") {
    return Prisma.sql`ORDER BY lower(e.codigo) ASC, lower(COALESCE(e.variante, '')) ASC, e.id ASC`;
  }
  if (ordenacao === "CODIGO_DESC") {
    return Prisma.sql`ORDER BY lower(e.codigo) DESC, lower(COALESCE(e.variante, '')) DESC, e.id DESC`;
  }
  if (ordenacao === "RELEVANCIA" && possuiConsulta) {
    return Prisma.sql`ORDER BY relevancia DESC, e.updated_at DESC, e.id DESC`;
  }
  return Prisma.sql`ORDER BY e.created_at DESC, e.id DESC`;
}

function adicionarFiltroArrayParcial(
  condicoes: Prisma.Sql[],
  coluna: "palavras_chave",
  valor: string,
) {
  if (!valor) return;
  const identificador = Prisma.raw(`e.${coluna}`);
  condicoes.push(Prisma.sql`EXISTS (
    SELECT 1 FROM unnest(${identificador}) AS item
    WHERE lower(item) LIKE '%' || lower(${valor}) || '%'
  )`);
}

function adicionarFiltroArrayExato(
  condicoes: Prisma.Sql[],
  coluna:
    | "elementos_visuais"
    | "categorias"
    | "ocasioes"
    | "publicos_sugeridos"
    | "contextos_uso"
    | "afinidades_visuais"
    | "padroes_texteis",
  valor: string,
) {
  if (!valor) return;
  const identificador = Prisma.raw(`e.${coluna}`);
  condicoes.push(Prisma.sql`EXISTS (
    SELECT 1 FROM unnest(${identificador}) AS item
    WHERE lower(item) = lower(${valor})
  )`);
}

function normalizarTexto(valor: string | null | undefined) {
  return valor?.trim().replace(/\s+/gu, " ") ?? "";
}

function normalizarLista(valores: string[] | undefined) {
  return [...new Set((valores ?? []).map(normalizarTexto).filter(Boolean))];
}

function extrairCodigoConsulta(consulta: string) {
  return /^[0-9][\p{L}\p{N}.]*$/u.test(consulta) ? consulta : null;
}

function extrairCodigoVarianteConsulta(consulta: string) {
  const match = consulta.match(/^([0-9][\p{L}\p{N}.]*)[\s/-]+([\p{L}\p{N}]+)$/u);
  return match ? { codigo: match[1], variante: match[2] } : null;
}
