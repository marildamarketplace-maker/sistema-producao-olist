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

export type FiltrosPesquisaEstampas = {
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
};

export type FacetasPesquisaEstampas = {
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
  const termos = consulta
    ? Prisma.sql`websearch_to_tsquery('simple', extensions.unaccent(${consultaTextilExpandida}))`
    : Prisma.sql`NULL::tsquery`;

  const condicoes: Prisma.Sql[] = [];
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
      Prisma.sql`e.cores @> ARRAY[${Prisma.join(cores)}]::TEXT[]`,
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

export async function listarFacetasPesquisaEstampas(): Promise<FacetasPesquisaEstampas> {
  const rows = await prisma.$queryRaw<Array<{ tipo: string; valor: string }>>`
    WITH valores AS (
      SELECT 'temas'::TEXT AS tipo, tema AS valor FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'cores', unnest(cores) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'elementosVisuais', unnest(elementos_visuais) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'categorias', unnest(categorias) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'ocasioes', unnest(ocasioes) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'publicosSugeridos', unnest(publicos_sugeridos) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'contextosUso', unnest(contextos_uso) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'afinidadesVisuais', unnest(afinidades_visuais) FROM estampas WHERE is_active = TRUE
      UNION ALL SELECT 'padroesTexteis', unnest(padroes_texteis) FROM estampas WHERE is_active = TRUE
    ), distintos AS (
      SELECT tipo, lower(regexp_replace(btrim(valor), '\s+', ' ', 'g')) AS valor
      FROM valores
      WHERE btrim(COALESCE(valor, '')) <> ''
      GROUP BY tipo, lower(regexp_replace(btrim(valor), '\s+', ' ', 'g'))
    ), numerados AS (
      SELECT tipo, valor, row_number() OVER (PARTITION BY tipo ORDER BY lower(valor)) AS posicao
      FROM distintos
    )
    SELECT tipo, valor FROM numerados WHERE posicao <= 300 ORDER BY tipo, lower(valor)
  `;
  const facetas: FacetasPesquisaEstampas = {
    temas: [],
    cores: [],
    elementosVisuais: [],
    categorias: [],
    ocasioes: [],
    publicosSugeridos: [],
    contextosUso: [],
    afinidadesVisuais: [],
    padroesTexteis: [],
    tiposImagem: [...TIPOS_IMAGEM_ESTAMPA],
    conteudosImagem: [...CONTEUDOS_IMAGEM_ESTAMPA],
    suportesAplicacao: [...SUPORTES_APLICACAO_ESTAMPA],
  };
  for (const row of rows) {
    switch (row.tipo) {
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
