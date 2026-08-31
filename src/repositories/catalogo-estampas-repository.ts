import { Prisma, type EstampaCatalogoIa } from "@prisma/client";
import {
  ROTULOS_CONTEUDO_IMAGEM_ESTAMPA,
  ROTULOS_SUPORTE_APLICACAO_ESTAMPA,
  ROTULOS_TIPO_IMAGEM_ESTAMPA,
  type ConteudoImagemEstampa,
  type SuporteAplicacaoEstampa,
  type TipoImagemEstampa,
} from "@/domain/estampa-apresentacao";
import { prisma } from "@/lib/prisma";
import { pesquisarCatalogoEstampas } from "@/repositories/pesquisa-estampas-repository";
import { construirTextoPesquisa, type DadosTextoPesquisa } from "@/services/construirTextoPesquisa";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ProcessingStatusEstampa = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type EstampaCatalogo = {
  id: string; codigo: string; variante: string | null; preview_url: string | null;
  storage_key: string | null; original_relative_path: string | null; original_filename: string | null;
  content_hash: string | null; titulo: string | null; descricao: string | null; tema: string | null;
  subtemas: string[] | null; palavras_chave: string[] | string | null; cores: string[] | null;
  elementos_visuais: string[] | null; ocasioes: string[] | null; categorias: string[] | null;
  estilo: string | null; tipo_imagem: TipoImagemEstampa; conteudos_imagem: ConteudoImagemEstampa[];
  suporte_aplicacao: SuporteAplicacaoEstampa; descricao_aplicacao: string | null; confianca_tipo_imagem: number | null;
  publicos_sugeridos: string[]; contextos_uso: string[]; afinidades_visuais: string[];
  confianca_segmentacao: number | null;
  padroes_texteis: string[]; confianca_padrao_textil: number | null;
  texto_pesquisa: string | null; ai_metadata: JsonValue | null;
  ai_processed_hash: string | null; processing_status: ProcessingStatusEstampa;
  processing_error: string | null; processed_at: string | null; created_at: string; updated_at: string;
  is_active: boolean;
};
export type AtualizacaoEstampaCatalogo = Partial<Omit<EstampaCatalogo, "id" | "created_at" | "updated_at">>;
export type EstampaPedidosRow = Pick<EstampaCatalogo, "id" | "codigo" | "variante" | "titulo" | "descricao" | "preview_url" | "cores" | "palavras_chave">;
export type ResultadoPesquisaEstampa = { estampa: EstampaPedidosRow; relevancia: number };

const CAMPOS_PESQUISAVEIS = new Set<keyof AtualizacaoEstampaCatalogo>([
  "codigo", "variante", "titulo", "descricao", "tema", "subtemas", "palavras_chave", "cores",
  "elementos_visuais", "ocasioes", "categorias", "estilo", "ai_metadata",
  "tipo_imagem", "conteudos_imagem", "suporte_aplicacao", "descricao_aplicacao",
  "publicos_sugeridos", "contextos_uso", "afinidades_visuais",
  "padroes_texteis",
]);

function textoObrigatorio(valor: string, campo: string) {
  const texto = valor.trim();
  if (!texto) throw new Error(`${campo} é obrigatório.`);
  return texto;
}
function idCatalogo(valor: string | bigint) {
  try {
    const id = typeof valor === "bigint" ? valor : BigInt(valor.trim());
    if (id <= BigInt(0)) throw new Error();
    return id;
  } catch { throw new Error("id deve ser um inteiro positivo."); }
}
function paraCatalogo(row: EstampaCatalogoIa): EstampaCatalogo {
  return {
    id: row.id.toString(), codigo: row.codigo, variante: row.variante, preview_url: row.previewUrl,
    storage_key: row.storageKey, original_relative_path: row.originalRelativePath,
    original_filename: row.originalFilename, content_hash: row.contentHash, titulo: row.titulo,
    descricao: row.descricao, tema: row.tema, subtemas: row.subtemas,
    palavras_chave: row.palavrasChave, cores: row.cores, elementos_visuais: row.elementosVisuais,
    ocasioes: row.ocasioes, categorias: row.categorias, estilo: row.estilo,
    tipo_imagem: row.tipoImagem as TipoImagemEstampa,
    conteudos_imagem: row.conteudosImagem as ConteudoImagemEstampa[],
    suporte_aplicacao: row.suporteAplicacao as SuporteAplicacaoEstampa,
    descricao_aplicacao: row.descricaoAplicacao,
    confianca_tipo_imagem: row.confiancaTipoImagem,
    publicos_sugeridos: row.publicosSugeridos,
    contextos_uso: row.contextosUso,
    afinidades_visuais: row.afinidadesVisuais,
    confianca_segmentacao: row.confiancaSegmentacao,
    padroes_texteis: row.padroesTexteis,
    confianca_padrao_textil: row.confiancaPadraoTextil,
    texto_pesquisa: row.textoPesquisa, ai_metadata: row.aiMetadata as JsonValue | null,
    ai_processed_hash: row.aiProcessedHash, processing_status: row.processingStatus as ProcessingStatusEstampa,
    processing_error: row.processingError, processed_at: row.processedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(), is_active: row.isActive,
  };
}
function paraPedidos(row: EstampaCatalogoIa): EstampaPedidosRow {
  const e = paraCatalogo(row);
  return { id: e.id, codigo: e.codigo, variante: e.variante, titulo: e.titulo, descricao: e.descricao,
    preview_url: e.preview_url, cores: e.cores, palavras_chave: e.palavras_chave };
}
function objetoJson(valor: JsonValue | null): Record<string, JsonValue> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}
function listaJson(valor: JsonValue | undefined) {
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string") : null;
}
function dadosPesquisa(e: EstampaCatalogo): DadosTextoPesquisa {
  const resposta = objetoJson(objetoJson(e.ai_metadata).response ?? null);
  return { codigo: e.codigo, variante: e.variante, titulo: e.titulo, descricao: e.descricao, tema: e.tema,
    subtemas: e.subtemas ?? listaJson(resposta.subtemas), palavrasChave: e.palavras_chave, cores: e.cores,
    coresPrincipais: listaJson(resposta.coresPrincipais), coresSecundarias: listaJson(resposta.coresSecundarias),
    elementosVisuais: e.elementos_visuais, ocasioes: e.ocasioes, categorias: e.categorias,
    estilo: e.estilo ?? (typeof resposta.estilo === "string" ? resposta.estilo : null),
    tipoImagem: e.tipo_imagem === "INDEFINIDO"
      ? null
      : ROTULOS_TIPO_IMAGEM_ESTAMPA[e.tipo_imagem],
    conteudosImagem: e.conteudos_imagem.map(
      (conteudo) => ROTULOS_CONTEUDO_IMAGEM_ESTAMPA[conteudo],
    ),
    suporteAplicacao: e.suporte_aplicacao === "NAO_APLICAVEL"
      ? null
      : ROTULOS_SUPORTE_APLICACAO_ESTAMPA[e.suporte_aplicacao],
    descricaoAplicacao: e.descricao_aplicacao,
    publicosSugeridos: e.publicos_sugeridos,
    contextosUso: e.contextos_uso,
    afinidadesVisuais: e.afinidades_visuais,
    padroesTexteis: e.padroes_texteis,
  };
}

export async function buscarEstampaPorId(id: string | bigint) {
  const row = await prisma.estampaCatalogoIa.findUnique({ where: { id: idCatalogo(id) } });
  return row ? paraCatalogo(row) : null;
}
export async function buscarEstampaPorCodigoVariante(codigo: string, variante: string) {
  const row = await prisma.estampaCatalogoIa.findFirst({ where: {
    codigo: textoObrigatorio(codigo, "codigo"), variante: textoObrigatorio(variante, "variante"),
  } });
  return row ? paraCatalogo(row) : null;
}
export async function listarEstampasCompletasPorCodigoParaPedidos(codigo: string) {
  const rows = await prisma.estampaCatalogoIa.findMany({ where: {
    codigo: textoObrigatorio(codigo, "codigo"), processingStatus: "COMPLETED", isActive: true,
  }, orderBy: { variante: "asc" } });
  return rows.map(paraPedidos);
}
export async function buscarEstampaCompletaPorCodigoVarianteParaPedidos(codigo: string, variante: string) {
  const row = await prisma.estampaCatalogoIa.findFirst({ where: {
    codigo: textoObrigatorio(codigo, "codigo"), variante: textoObrigatorio(variante, "variante"),
    processingStatus: "COMPLETED", isActive: true,
  } });
  return row ? paraPedidos(row) : null;
}
export async function buscarEstampaCompletaPorIdParaPedidos(id: string) {
  const row = await prisma.estampaCatalogoIa.findFirst({ where: {
    id: idCatalogo(id), processingStatus: "COMPLETED", isActive: true,
  } });
  return row ? paraPedidos(row) : null;
}
export async function pesquisarEstampasPorRelevancia(consulta: string, options: { limite?: number; offset?: number } = {}) {
  const termo = consulta.trim().replace(/\s+/g, " ");
  if (!termo) return [];
  if (termo.length > 200) throw new Error("A consulta deve possuir no máximo 200 caracteres.");
  const limite = options.limite ?? 50; const offset = options.offset ?? 0;
  if (!Number.isInteger(limite) || limite <= 0 || limite > 100) throw new Error("limite deve ser um inteiro entre 1 e 100.");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset deve ser um inteiro maior ou igual a zero.");
  const resultado = await pesquisarCatalogoEstampas({
    consulta: termo,
    status: "COMPLETED",
    ordenacao: "RELEVANCIA",
    limite,
    offset,
    somenteAtivas: true,
  });
  return resultado.estampas.map((row) => ({
    estampa: {
      id: row.id.toString(),
      codigo: row.codigo,
      variante: row.variante,
      titulo: row.titulo,
      descricao: row.descricao,
      preview_url: row.previewUrl,
      cores: row.cores,
      palavras_chave: row.palavrasChave,
    },
    relevancia: Number(row.relevancia),
  }));
}
export async function listarEstampasPorProcessingStatus(processingStatus: ProcessingStatusEstampa, options: { limite?: number; offset?: number } = {}) {
  const limite = options.limite ?? 200; const offset = options.offset ?? 0;
  if (!Number.isInteger(limite) || limite <= 0 || limite > 1000) throw new Error("limite deve ser um inteiro entre 1 e 1000.");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset deve ser um inteiro maior ou igual a zero.");
  return (await prisma.estampaCatalogoIa.findMany({ where: { processingStatus }, orderBy: { id: "asc" }, skip: offset, take: limite })).map(paraCatalogo);
}
export async function listarEstampasParaVerificarAnalise(options: { limite?: number; afterId?: string } = {}) {
  const limite = options.limite ?? 200;
  if (!Number.isInteger(limite) || limite <= 0 || limite > 1000) throw new Error("limite deve ser um inteiro entre 1 e 1000.");
  const rows = await prisma.estampaCatalogoIa.findMany({ where: {
    processingStatus: "PENDING", contentHash: { not: null },
    ...(options.afterId ? { id: { gt: idCatalogo(options.afterId) } } : {}),
  }, orderBy: { id: "asc" }, take: limite });
  return rows.map(paraCatalogo);
}

export async function atualizarEstampa(id: string, atualizacao: AtualizacaoEstampaCatalogo, options: { contentHashEsperado?: string } = {}) {
  const estampaId = idCatalogo(id);
  const campos = Object.fromEntries(Object.entries(atualizacao).filter(([, valor]) => valor !== undefined));
  if (Object.keys(campos).length === 0) throw new Error("Informe ao menos um campo para atualizar a estampa.");
  if (Object.keys(campos).some((campo) => CAMPOS_PESQUISAVEIS.has(campo as keyof AtualizacaoEstampaCatalogo))) {
    const atual = await buscarEstampaPorId(estampaId); if (!atual) return null;
    campos.texto_pesquisa = construirTextoPesquisa(dadosPesquisa({ ...atual, ...campos } as EstampaCatalogo));
  }
  const data: Prisma.EstampaCatalogoIaUpdateManyMutationInput = {};
  if (campos.codigo !== undefined) data.codigo = String(campos.codigo);
  if (campos.variante !== undefined) data.variante = campos.variante as string | null;
  if (campos.titulo !== undefined) data.titulo = campos.titulo as string | null;
  if (campos.descricao !== undefined) data.descricao = campos.descricao as string | null;
  if (campos.tema !== undefined) data.tema = campos.tema as string | null;
  if (campos.subtemas !== undefined) data.subtemas = campos.subtemas as string[];
  if (campos.palavras_chave !== undefined) {
    data.palavrasChave = Array.isArray(campos.palavras_chave)
      ? campos.palavras_chave.filter(
          (item): item is string => typeof item === "string",
        ) as string[]
      : String(campos.palavras_chave ?? "")
          .split(/[,;\n]+/u)
          .map((valor) => valor.trim())
          .filter(Boolean);
  }
  if (campos.cores !== undefined) data.cores = campos.cores as string[];
  if (campos.elementos_visuais !== undefined) data.elementosVisuais = campos.elementos_visuais as string[];
  if (campos.ocasioes !== undefined) data.ocasioes = campos.ocasioes as string[];
  if (campos.categorias !== undefined) data.categorias = campos.categorias as string[];
  if (campos.estilo !== undefined) data.estilo = campos.estilo as string | null;
  if (campos.tipo_imagem !== undefined) data.tipoImagem = String(campos.tipo_imagem);
  if (campos.conteudos_imagem !== undefined) data.conteudosImagem = campos.conteudos_imagem as string[];
  if (campos.suporte_aplicacao !== undefined) data.suporteAplicacao = String(campos.suporte_aplicacao);
  if (campos.descricao_aplicacao !== undefined) data.descricaoAplicacao = campos.descricao_aplicacao as string | null;
  if (campos.confianca_tipo_imagem !== undefined) data.confiancaTipoImagem = campos.confianca_tipo_imagem as number | null;
  if (campos.publicos_sugeridos !== undefined) data.publicosSugeridos = campos.publicos_sugeridos as string[];
  if (campos.contextos_uso !== undefined) data.contextosUso = campos.contextos_uso as string[];
  if (campos.afinidades_visuais !== undefined) data.afinidadesVisuais = campos.afinidades_visuais as string[];
  if (campos.confianca_segmentacao !== undefined) data.confiancaSegmentacao = campos.confianca_segmentacao as number | null;
  if (campos.padroes_texteis !== undefined) data.padroesTexteis = campos.padroes_texteis as string[];
  if (campos.confianca_padrao_textil !== undefined) data.confiancaPadraoTextil = campos.confianca_padrao_textil as number | null;
  if (campos.texto_pesquisa !== undefined) data.textoPesquisa = campos.texto_pesquisa as string | null;
  if (campos.ai_metadata !== undefined) data.aiMetadata = campos.ai_metadata === null ? Prisma.DbNull : campos.ai_metadata as Prisma.InputJsonValue;
  if (campos.ai_processed_hash !== undefined) data.aiProcessedHash = campos.ai_processed_hash as string | null;
  if (campos.processing_status !== undefined) data.processingStatus = String(campos.processing_status);
  if (campos.processing_error !== undefined) data.processingError = campos.processing_error as string | null;
  if (campos.processed_at !== undefined) data.processedAt = campos.processed_at ? new Date(String(campos.processed_at)) : null;
  if (campos.is_active !== undefined) data.isActive = Boolean(campos.is_active);
  const resultado = await prisma.estampaCatalogoIa.updateMany({ where: {
    id: estampaId, ...(options.contentHashEsperado ? { contentHash: options.contentHashEsperado } : {}),
  }, data });
  if (resultado.count !== 1) return null;
  return buscarEstampaPorId(estampaId);
}
