import { CRITERIOS_FLEXIVEIS_ESTAMPAS, validarPreferenciasPesquisa } from "@/domain/preferencias-pesquisa-estampas";
import type { FacetasDesignPesquisa, FiltrosDesignPesquisa } from "@/domain/pesquisa-estampas-design";
import { filtrosDesignEstampasSql } from "@/repositories/filtros-design-estampas-sql";
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
import { correspondenciaEstampasSql } from "@/repositories/correspondencia-estampas-sql";
import { extrairReferenciaCodigo } from "@/domain/consulta-profissional-estampas";

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
  preferencias?: string[];
  correspondenciaMinima?: number;
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
  originalFilename: string | null;
  originalRelativePath: string | null;
  storageKey: string | null;
  textoPesquisa: string | null;
  searchVector: string | null;
  isActive: boolean;
  updatedAt: Date | null;
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
  percentualCorrespondencia: number | null;
  termosEncontrados: string[];
  termosAusentes: string[];
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
): Promise<{ estampas: EstampaPesquisaRow[]; total: number; completas: number; parciais: number; criterios: string[]; excluidos: string[] }> {
  const consulta = normalizarTexto(filtros.consulta);
  const preferencias = validarPreferenciasPesquisa(filtros.preferencias);
  const obrigatorios = { ...filtros };
  const adicionais: Array<{ termo: string; teste: Prisma.Sql }> = [];
  for (const campo of preferencias) {
    if (campo === "consulta") continue;
    const valor = filtros[campo];
    if (!valor || (Array.isArray(valor) && !valor.length)) continue;
    const condicoes = condicoesFiltrosEstampas({ [campo]: valor, modoCores: filtros.modoCores, somenteAtivas: false });
    if (condicoes.length) adicionais.push({ termo: `${CRITERIOS_FLEXIVEIS_ESTAMPAS[campo]}: ${Array.isArray(valor) ? valor.join(filtros.modoCores === "QUALQUER" ? " ou " : " + ") : valor}`, teste: Prisma.sql`COALESCE((${Prisma.join(condicoes, " AND ")}), FALSE)` });
    delete obrigatorios[campo];
  }
  const correspondencia = correspondenciaEstampasSql(consulta, adicionais, preferencias.includes("consulta"));
  const possuiPreferencias = correspondencia.criterios.length > 0;
  const codigoConsulta = extrairCodigoConsulta(consulta);
  const codigoVarianteConsulta = extrairCodigoVarianteConsulta(consulta);
  const termos = correspondencia.termos;
  const lateral = possuiPreferencias
    ? Prisma.sql`CROSS JOIN LATERAL (SELECT ${correspondencia.percentual} AS percentual) AS aderencia`
    : Prisma.empty;
  const percentual = possuiPreferencias ? Prisma.sql`aderencia.percentual` : Prisma.sql`NULL::DOUBLE PRECISION`;

  const condicoes = condicoesFiltrosEstampas(obrigatorios);

  condicoes.push(...correspondencia.obrigatorios, ...correspondencia.exclusoes);
  if (possuiPreferencias) {
    condicoes.push(correspondencia.candidatos);
    condicoes.push(Prisma.sql`aderencia.percentual >= ${filtros.correspondenciaMinima ?? 1}`);
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
        + COALESCE(ts_rank_cd(e.search_vector, ${termos}, 32), 0) * 25
        + COALESCE(ts_rank_cd(e.search_vector_arquivo, ${termos}, 32), 0) * 10
      )::DOUBLE PRECISION`
    : Prisma.sql`0::DOUBLE PRECISION`;
  const orderBy = criarOrdenacao(filtros.ordenacao, possuiPreferencias, Boolean(consulta));
  // O JOIN não preserva a ordem da CTE: repita os mesmos critérios na saída.
  const ordemPagina = criarOrdenacao(filtros.ordenacao, possuiPreferencias, Boolean(consulta), true);

  // Leituras independentes: não precisam manter uma transação aberta durante
  // a pesquisa, que pode ultrapassar o timeout transacional padrão do Prisma.
  // A CTE materializada limita IDs/score antes de projetar os metadados pesados.
  const [estampas, totalRows] = await Promise.all([
    prisma.$queryRaw<EstampaPesquisaRow[]>`
      WITH pagina AS MATERIALIZED (
        SELECT e.id, ${relevancia} AS relevancia, ${percentual} AS percentual
        FROM estampas AS e
        ${lateral}
        ${where}
        ${orderBy}
        LIMIT ${filtros.limite}
        OFFSET ${filtros.offset}
      )
      SELECT
        e.id,
        e.codigo,
        e.variante,
        e.original_filename AS "originalFilename",
        e.original_relative_path AS "originalRelativePath",
        e.storage_key AS "storageKey",
        e.texto_pesquisa AS "textoPesquisa",
        e.search_vector::text AS "searchVector",
        e.is_active AS "isActive",
        e.updated_at AS "updatedAt",
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
        pagina.relevancia AS relevancia,
        pagina.percentual AS "percentualCorrespondencia",
        ${correspondencia.encontrados} AS "termosEncontrados",
        ${correspondencia.ausentes} AS "termosAusentes"
      FROM estampas AS e
      INNER JOIN pagina ON pagina.id = e.id
      ${ordemPagina}
    `,
    prisma.$queryRaw<Array<{ total: bigint; completas: bigint; parciais: bigint }>>`
      SELECT COUNT(*)::BIGINT AS total,
        COUNT(*) FILTER (WHERE ${percentual} = 100)::BIGINT AS completas,
        COUNT(*) FILTER (WHERE ${percentual} < 100)::BIGINT AS parciais
      FROM estampas AS e
      ${lateral}
      ${where}
    `,
  ]);

  return {
    criterios: correspondencia.criterios, excluidos: correspondencia.plano.excluidos.map(({ termo }) => termo),
    estampas, total: Number(totalRows[0]?.total ?? 0),
    completas: Number(totalRows[0]?.completas ?? 0), parciais: Number(totalRows[0]?.parciais ?? 0),
  };
}

export async function listarFacetasPesquisaEstampas(status?: StatusPesquisaEstampas): Promise<FacetasPesquisaEstampas> {
  const rows = await prisma.$queryRaw<Array<{ tipo: string; valor: string }>>`
    SELECT tipo, valor
    FROM estampas_interno.facetas_pesquisa
    WHERE status = ${status ?? "TODOS"}
    ORDER BY tipo, posicao
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

function criarOrdenacao(ordenacao: OrdenacaoPesquisaEstampas, possuiConsulta: boolean, pesquisaTextual = false, paginaSelecionada = false) {
  if (ordenacao === "CODIGO_ASC") {
    return Prisma.sql`ORDER BY lower(e.codigo) ASC, lower(COALESCE(e.variante, '')) ASC, e.id ASC`;
  }
  if (ordenacao === "CODIGO_DESC") {
    return Prisma.sql`ORDER BY lower(e.codigo) DESC, lower(COALESCE(e.variante, '')) DESC, e.id DESC`;
  }
  if (ordenacao === "RELEVANCIA" && possuiConsulta) {
    const percentual = paginaSelecionada ? Prisma.sql`pagina.percentual` : Prisma.sql`aderencia.percentual`;
    return Prisma.sql`ORDER BY ${percentual} DESC, relevancia DESC, e.updated_at DESC, e.id DESC`;
  }
  if (ordenacao === "RELEVANCIA" && pesquisaTextual) return Prisma.sql`ORDER BY relevancia DESC, e.updated_at DESC, e.id DESC`;
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
  return extrairReferenciaCodigo(consulta)?.codigo ?? null;
}

function extrairCodigoVarianteConsulta(consulta: string) {
  const referencia = extrairReferenciaCodigo(consulta);
  return referencia?.variante ? { codigo: referencia.codigo, variante: referencia.variante } : null;
}

function condicoesFiltrosEstampas(filtros: Partial<FiltrosPesquisaEstampas>): Prisma.Sql[] {
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
  const categoria = normalizarTexto(filtros.categoria);
  if (categoria) {
    condicoes.push(Prisma.sql`e.categorias @> ARRAY[lower(${categoria})]::TEXT[]`);
  }
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

  return condicoes;
}
