import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildProdutoMockupPrompt } from "@/lib/mockup-prompt";
import {
  deleteGoogleStorageObject,
  getGoogleStorageObjectInfo,
  GoogleStorageServiceError,
  uploadToGoogleStorage,
} from "@/services/googleStorageService";
import { gerarImagemMockupComEstampa } from "@/services/openaiImageService";

const PREVIEW_IMAGE_MODEL = "gpt-image-1-mini";
const ESTAMPA_IMAGEM_TIPO_PRODUTO_SKU = "TECIDO-METRO-TRICOLINE";

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Campo obrigatorio: ${field}.`);
  }

  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function optionalNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const normalized =
    typeof value === "string" ? value.trim().replace(/\./g, "").replace(",", ".") : value;
  const numberValue = Number(normalized);
  if (Number.isNaN(numberValue) || numberValue < 0) {
    throw new Error(`Campo numerico invalido: ${field}.`);
  }

  return numberValue;
}

function formatDecimalPtBr(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function requiredPositiveNumber(value: unknown, field: string) {
  const numberValue = optionalNumber(value, field);

  if (numberValue === null || numberValue <= 0) {
    throw new Error(`Campo numerico invalido: ${field}.`);
  }

  return numberValue;
}

function removeTemplateVariables(value: string | null | undefined) {
  return (value ?? "").replace(/\$\{[^}]+\}/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanCodePart(value: string) {
  return removeTemplateVariables(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function buildKitSku(produtos: Array<{ sku: string }>) {
  return ["KIT", ...produtos.map((produto) => produto.sku.trim().toUpperCase()).filter(Boolean)].join("__");
}

function buildEstampaImagemStoragePath(codigo: string, index: number) {
  const codigoLimpo = cleanCodePart(codigo);

  if (!codigoLimpo) {
    throw new Error("Codigo da estampa invalido para upload.");
  }
  if (!Number.isInteger(index) || index < 0 || index > 1) {
    throw new Error("Indice de imagem da estampa invalido.");
  }

  return `${ESTAMPA_IMAGEM_TIPO_PRODUTO_SKU}/${codigoLimpo}/${codigoLimpo}-${index}.jpg`;
}

function buildTemporaryMockupEstampaPath(produtoId: string, contentType: string) {
  const produtoPart = cleanCodePart(produtoId) || "produto";
  const extensionByMimeType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensionByMimeType[contentType] || "png";

  return `_temp/mockup-estampas/${produtoPart}/${Date.now()}.${extension}`;
}

function joinTextParts(parts: Array<string | null | undefined>) {
  return cleanText(parts.filter((part): part is string => Boolean(part?.trim())).join(" "));
}

function joinKeywordParts(parts: Array<string | null | undefined>) {
  return cleanText(parts.filter((part): part is string => Boolean(part?.trim())).join(", "));
}

function buildSlugFinal(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) =>
      removeTemplateVariables(part)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTipoProdutoMarkers(tipoProduto: {
  corteLaser: boolean;
  tecidoCorrido: boolean;
}) {
  return [
    tipoProduto.corteLaser ? "C/LASER" : null,
    tipoProduto.tecidoCorrido ? "C/CORRIDO" : null,
  ].filter((marker): marker is string => Boolean(marker));
}

function buildProdutoFinalSku(
  tipoProduto: { sku: string; corteLaser: boolean; tecidoCorrido: boolean },
  tamanhoSku: string | null | undefined,
  estampaCodigo: string,
  varianteCodigo: string | null | undefined,
) {
  const skuTipoProduto = tipoProduto.sku.trim();
  const usaPadraoMeury2 = skuTipoProduto.toUpperCase().startsWith("MEURY2-");

  if (usaPadraoMeury2) {
    return [
      `TP/${cleanCodePart(skuTipoProduto.replace(/^MEURY2-+/i, ""))}`,
      ...buildTipoProdutoMarkers(tipoProduto),
      tamanhoSku ? `TA/${cleanCodePart(tamanhoSku)}` : "",
      `EST/${cleanCodePart(estampaCodigo)}`,
      cleanCodePart(varianteCodigo ?? ""),
    ]
      .filter(Boolean)
      .join("-")
      .replace(/-+/g, "-");
  }

  return [
    cleanCodePart(tipoProduto.sku),
    ...buildTipoProdutoMarkers(tipoProduto),
    cleanCodePart(tamanhoSku ?? ""),
    cleanCodePart(estampaCodigo),
    cleanCodePart(varianteCodigo ?? ""),
  ]
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-");
}

function hasTemplateVariable(value: string | null | undefined) {
  return Boolean(value?.match(/\$\{[A-Z_]+\}/));
}

function renderTemplate(
  template: string | null | undefined,
  variables: Record<string, string | null | undefined>,
) {
  return cleanText(
    (template ?? "").replace(/\$\{([A-Z_]+)\}/g, (_, key: string) => variables[key] ?? ""),
  );
}

function buildProdutoVariables(
  tipoProduto: {
    palavrasChave: string | null;
  },
  estampa: {
    codigo: string;
    extra: string | null;
    descricao: string | null;
    palavrasChave: string | null;
  },
  variante: {
    codigo: string;
    descricao: string | null;
    palavrasChave: string | null;
  } | null,
) {
  return {
    TAMANHO: variante?.codigo,
    ESTAMPA: estampa.codigo,
    VARIANTE: variante?.codigo,
    EXTRA: estampa.extra,
    PALAVRAS_CHAVE_ESTAMPA: estampa.palavrasChave,
    PALAVRAS_CHAVE_PRODUTO: tipoProduto.palavrasChave,
    PALAVRAS_CHAVE_VARIANTE: variante?.palavrasChave,
    DESCRICAO_ESTAMPA: estampa.descricao,
    DESCRICAO_VARIANTE: variante?.descricao,
  };
}

function normalizeMockupMode(value: unknown) {
  return value === "final" ? "final" : "preview";
}

function normalizeMockupQuality(value: unknown) {
  return value === "low" || value === "high" ? value : "medium";
}

async function findExistingMockup(outputPath: string) {
  try {
    const storageObject = await getGoogleStorageObjectInfo(outputPath);
    return storageObject.exists ? storageObject : null;
  } catch (error) {
    if (error instanceof GoogleStorageServiceError && error.message.includes("Variavel de ambiente")) {
      return null;
    }

    throw error;
  }
}

async function buildProdutoMockupStorageInfo(produtoId: string, mockupIndex: number) {
  if (!Number.isInteger(mockupIndex) || mockupIndex < 1 || mockupIndex > 5) {
    throw new Error("Mockup invalido. Informe um numero de 1 a 5.");
  }

  const produto = await prisma.produtoOlist.findUniqueOrThrow({
    where: { id: produtoId },
    include: {
      tipoProduto: { select: { sku: true, detalhesPromptIa: true } },
      estampa: { select: { codigo: true, descricao: true, imagemUrl: true } },
      variante: { select: { codigo: true, descricao: true } },
      tamanho: { select: { sku: true, titulo: true } },
    },
  });

  if (!produto.tamanho?.sku) {
    throw new Error("Produto sem tamanho/SKU de tamanho para localizar o mockup.");
  }
  if (!produto.estampa?.codigo) {
    throw new Error("Produto sem estampa para localizar a imagem de referencia.");
  }
  if (!produto.variante?.codigo) {
    throw new Error("Produto sem variante para localizar a imagem de referencia.");
  }

  const tipoSku = cleanCodePart(produto.tipoProduto.sku);
  const tamanhoSku = cleanCodePart(produto.tamanho.sku);
  const estampaCodigo = cleanCodePart(produto.estampa.codigo);
  const varianteCodigo = cleanCodePart(produto.variante.codigo);

  return {
    produto,
    tamanhoTitulo: produto.tamanho.titulo,
    descricaoVariante: produto.variante.descricao ?? "",
    mockupUrl: `https://storage.googleapis.com/forro-de-mesa-retangular/${tipoSku}/${tamanhoSku}/mockup-${mockupIndex}.png`,
    estampaUrl:
      produto.estampa.imagemUrl ??
      `https://storage.googleapis.com/forro-de-mesa-retangular/${tipoSku}/${estampaCodigo}/${estampaCodigo}-${varianteCodigo}-0.jpg`,
    outputPath: `${tipoSku}/${estampaCodigo}/${estampaCodigo}-${varianteCodigo}-${mockupIndex - 1}.jpg`,
  };
}

function normalizeTipoProduto(tipoProduto: {
  id: string;
  titulo: string;
  sku: string;
  descricao: string | null;
  descricaoSeo: string | null;
  palavrasChave: string | null;
  detalhesPromptIa: string | null;
  corteLaser: boolean;
  tecidoCorrido: boolean;
  slug: string | null;
  categoria: string | null;
  precoCusto: unknown;
  preco: unknown;
  pesoLiquido: unknown;
  pesoBruto: unknown;
  larguraEmbalagem: unknown;
  alturaEmbalagem: unknown;
  comprimentoEmbalagem: unknown;
  createdAt: Date;
  produtosFornecedor?: Array<{
    id: string;
    produtoFornecedorId: string;
    quantidadeUsada: unknown;
    produtoFornecedor: {
      id: string;
      fornecedorId: string;
      nome: string;
      descricao: string | null;
      referencia: string | null;
      precoUnitarioMetro: unknown;
      pesoLiquidoMetro?: unknown;
      pesoBrutoMetro?: unknown;
      larguraEmbalagemMetro?: unknown;
      alturaEmbalagemMetro?: unknown;
      comprimentoEmbalagemMetro?: unknown;
      fornecedor: {
        nome: string;
      };
    };
  }>;
}) {
  return {
    id: tipoProduto.id,
    titulo: tipoProduto.titulo,
    sku: tipoProduto.sku,
    nome: tipoProduto.titulo,
    prefixoSku: tipoProduto.sku,
    descricao: tipoProduto.descricao,
    descricaoSeo: tipoProduto.descricaoSeo,
    palavrasChave: tipoProduto.palavrasChave,
    detalhesPromptIa: tipoProduto.detalhesPromptIa,
    corteLaser: tipoProduto.corteLaser,
    tecidoCorrido: tipoProduto.tecidoCorrido,
    slug: tipoProduto.slug,
    categoria: tipoProduto.categoria,
    precoCusto: decimalToNumber(tipoProduto.precoCusto),
    preco: decimalToNumber(tipoProduto.preco),
    pesoLiquido: decimalToNumber(tipoProduto.pesoLiquido),
    pesoBruto: decimalToNumber(tipoProduto.pesoBruto),
    larguraEmbalagem: decimalToNumber(tipoProduto.larguraEmbalagem),
    alturaEmbalagem: decimalToNumber(tipoProduto.alturaEmbalagem),
    comprimentoEmbalagem: decimalToNumber(tipoProduto.comprimentoEmbalagem),
    precoBase: decimalToNumber(tipoProduto.preco),
    pesoGramas: decimalToNumber(tipoProduto.pesoBruto),
    larguraCm: decimalToNumber(tipoProduto.larguraEmbalagem),
    alturaCm: decimalToNumber(tipoProduto.alturaEmbalagem),
    comprimentoCm: decimalToNumber(tipoProduto.comprimentoEmbalagem),
    ativo: true,
    createdAt: tipoProduto.createdAt.toISOString(),
    produtosFornecidos: (tipoProduto.produtosFornecedor ?? []).map((associacao) => ({
      id: associacao.id,
      produtoFornecedorId: associacao.produtoFornecedorId,
      quantidadeUsada: decimalToNumber(associacao.quantidadeUsada) ?? 0,
      produtoFornecedor: normalizeProdutoFornecedor(associacao.produtoFornecedor),
    })),
  };
}

function normalizeProdutoFornecedor(produto: {
  id: string;
  fornecedorId: string;
  nome: string;
  descricao: string | null;
  referencia: string | null;
  precoUnitarioMetro: unknown;
  pesoLiquidoMetro?: unknown;
  pesoBrutoMetro?: unknown;
  larguraEmbalagemMetro?: unknown;
  alturaEmbalagemMetro?: unknown;
  comprimentoEmbalagemMetro?: unknown;
  fornecedor: {
    nome: string;
  };
}) {
  return {
    id: produto.id,
    fornecedorId: produto.fornecedorId,
    fornecedorNome: produto.fornecedor.nome,
    nome: produto.nome,
    descricao: produto.descricao,
    referencia: produto.referencia,
    precoUnitarioMetro: decimalToNumber(produto.precoUnitarioMetro) ?? 0,
    pesoLiquidoMetro: decimalToNumber(produto.pesoLiquidoMetro),
    pesoBrutoMetro: decimalToNumber(produto.pesoBrutoMetro),
    larguraEmbalagemMetro: decimalToNumber(produto.larguraEmbalagemMetro),
    alturaEmbalagemMetro: decimalToNumber(produto.alturaEmbalagemMetro),
    comprimentoEmbalagemMetro: decimalToNumber(produto.comprimentoEmbalagemMetro),
  };
}

function normalizeEstampa(estampa: {
  id: string;
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  extra: string | null;
  imagemUrl: string | null;
  imagemUrl2: string | null;
  createdAt: Date;
}) {
  return {
    id: estampa.id,
    nome: estampa.descricao ?? estampa.codigo,
    codigo: estampa.codigo,
    descricao: estampa.descricao,
    palavrasChave: estampa.palavrasChave,
    extra: estampa.extra,
    imagemUrl: estampa.imagemUrl,
    imagemUrl2: estampa.imagemUrl2,
    ativo: true,
    createdAt: estampa.createdAt.toISOString(),
  };
}

function normalizeVariante(variante: {
  id: string;
  estampaId: string | null;
  estampa?: { id: string; codigo: string; descricao: string | null } | null;
  tamanhoId: string | null;
  tamanho?: { id: string; titulo: string; sku: string; slug: string | null } | null;
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  createdAt: Date;
}) {
  return {
    id: variante.id,
    estampaId: variante.estampaId,
    estampa: variante.estampa
      ? {
          id: variante.estampa.id,
          nome: variante.estampa.descricao ?? variante.estampa.codigo,
          codigo: variante.estampa.codigo,
        }
      : null,
    tamanhoId: variante.tamanhoId,
    tamanho: variante.tamanho
      ? {
          id: variante.tamanho.id,
          titulo: variante.tamanho.titulo,
          sku: variante.tamanho.sku,
          slug: variante.tamanho.slug,
        }
      : null,
    nome: variante.descricao ?? variante.codigo,
    codigo: variante.codigo,
    descricao: variante.descricao,
    palavrasChave: variante.palavrasChave,
    atributo: "Variante",
    valor: variante.descricao ?? variante.codigo,
    ativo: true,
    createdAt: variante.createdAt.toISOString(),
  };
}

function normalizeTamanho(tamanho: {
  id: string;
  titulo: string;
  sku: string;
  slug: string | null;
  precoCusto: unknown;
  preco: unknown;
  pesoLiquido: unknown;
  pesoBruto: unknown;
  larguraEmbalagem: unknown;
  alturaEmbalagem: unknown;
  comprimentoEmbalagem: unknown;
  quantidadeProdutoFornecedor: unknown;
  createdAt: Date;
  produtosFornecedor?: Array<{
    id: string;
    produtoFornecedorId: string;
    quantidadeUsada: unknown;
    produtoFornecedor: {
      id: string;
      fornecedorId: string;
      nome: string;
      descricao: string | null;
      referencia: string | null;
      precoUnitarioMetro: unknown;
      pesoLiquidoMetro?: unknown;
      pesoBrutoMetro?: unknown;
      larguraEmbalagemMetro?: unknown;
      alturaEmbalagemMetro?: unknown;
      comprimentoEmbalagemMetro?: unknown;
      fornecedor: {
        nome: string;
      };
    };
  }>;
}) {
  const produtosFornecidos = (tamanho.produtosFornecedor ?? []).map((associacao) => ({
    id: associacao.id,
    produtoFornecedorId: associacao.produtoFornecedorId,
    quantidadeUsada: decimalToNumber(associacao.quantidadeUsada) ?? 0,
    produtoFornecedor: normalizeProdutoFornecedor(associacao.produtoFornecedor),
  }));

  return {
    id: tamanho.id,
    titulo: tamanho.titulo,
    sku: tamanho.sku,
    slug: tamanho.slug,
    precoCusto: decimalToNumber(tamanho.precoCusto),
    preco: decimalToNumber(tamanho.preco),
    pesoLiquido: decimalToNumber(tamanho.pesoLiquido),
    pesoBruto: decimalToNumber(tamanho.pesoBruto),
    larguraEmbalagem: decimalToNumber(tamanho.larguraEmbalagem),
    alturaEmbalagem: decimalToNumber(tamanho.alturaEmbalagem),
    comprimentoEmbalagem: decimalToNumber(tamanho.comprimentoEmbalagem),
    quantidadeProdutoFornecedor: decimalToNumber(tamanho.quantidadeProdutoFornecedor),
    ativo: true,
    createdAt: tamanho.createdAt.toISOString(),
    custoPorProdutoFornecedor: produtosFornecidos.length > 0,
    produtosFornecidos,
  };
}

function normalizeProdutoOlist(produto: {
  id: string;
  produtoId: string | null;
  skuFinal: string;
  tituloFinal: string;
  descricaoFinal: string | null;
  descricaoSeoFinal: string | null;
  palavrasChaveFinal: string | null;
  slugFinal: string | null;
  categoria: string | null;
  precoCusto: unknown;
  preco: unknown;
  pesoLiquido: unknown;
  pesoBruto: unknown;
  larguraEmbalagem: unknown;
  alturaEmbalagem: unknown;
  comprimentoEmbalagem: unknown;
  createdAt: Date;
  produto: {
    id: string;
    sku: string;
    idCadastroOlist: string | null;
  } | null;
  tipoProduto: {
    id: string;
    titulo: string;
    sku: string;
    descricao: string | null;
    descricaoSeo: string | null;
    palavrasChave: string | null;
    detalhesPromptIa: string | null;
    corteLaser: boolean;
    tecidoCorrido: boolean;
    slug: string | null;
    categoria: string | null;
    precoCusto: unknown;
    preco: unknown;
    pesoLiquido: unknown;
    pesoBruto: unknown;
    larguraEmbalagem: unknown;
    alturaEmbalagem: unknown;
    comprimentoEmbalagem: unknown;
  };
  estampa: {
    id: string;
    codigo: string;
    descricao: string | null;
    palavrasChave: string | null;
    extra: string | null;
    imagemUrl: string | null;
    imagemUrl2: string | null;
  };
  variante: { id: string; codigo: string; descricao: string | null; palavrasChave: string | null } | null;
  tamanho: {
    id: string;
    titulo: string;
    sku: string;
    slug: string | null;
    precoCusto: unknown;
    preco: unknown;
    pesoLiquido: unknown;
    pesoBruto: unknown;
    larguraEmbalagem: unknown;
    alturaEmbalagem: unknown;
    comprimentoEmbalagem: unknown;
  } | null;
}) {
  return {
    id: produto.id,
    produtoId: produto.produtoId,
    sku: produto.skuFinal,
    skuFinal: produto.skuFinal,
    titulo: produto.tituloFinal,
    tituloFinal: produto.tituloFinal,
    descricao: produto.descricaoFinal,
    descricaoFinal: produto.descricaoFinal,
    descricaoSeoFinal: produto.descricaoSeoFinal,
    palavrasChaveFinal: produto.palavrasChaveFinal,
    slugFinal: produto.slugFinal,
    categoria: produto.categoria,
    precoCusto: decimalToNumber(produto.precoCusto),
    preco: decimalToNumber(produto.preco),
    pesoLiquido: decimalToNumber(produto.pesoLiquido),
    pesoBruto: decimalToNumber(produto.pesoBruto),
    larguraEmbalagem: decimalToNumber(produto.larguraEmbalagem),
    alturaEmbalagem: decimalToNumber(produto.alturaEmbalagem),
    comprimentoEmbalagem: decimalToNumber(produto.comprimentoEmbalagem),
    quantidade: 0,
    status: "pronto_para_exportar",
    createdAt: produto.createdAt.toISOString(),
    produto: produto.produto
      ? {
          id: produto.produto.id,
          sku: produto.produto.sku,
          idCadastroOlist: produto.produto.idCadastroOlist,
        }
      : null,
    tipoProduto: {
      id: produto.tipoProduto.id,
      titulo: produto.tipoProduto.titulo,
      sku: produto.tipoProduto.sku,
      nome: produto.tipoProduto.titulo,
      prefixoSku: produto.tipoProduto.sku,
      descricao: produto.tipoProduto.descricao,
      descricaoSeo: produto.tipoProduto.descricaoSeo,
      palavrasChave: produto.tipoProduto.palavrasChave,
      detalhesPromptIa: produto.tipoProduto.detalhesPromptIa,
      corteLaser: produto.tipoProduto.corteLaser,
      tecidoCorrido: produto.tipoProduto.tecidoCorrido,
      slug: produto.tipoProduto.slug,
      categoria: produto.tipoProduto.categoria,
      precoCusto: decimalToNumber(produto.tipoProduto.precoCusto),
      preco: decimalToNumber(produto.tipoProduto.preco),
      pesoLiquido: decimalToNumber(produto.tipoProduto.pesoLiquido),
      pesoBruto: decimalToNumber(produto.tipoProduto.pesoBruto),
      larguraEmbalagem: decimalToNumber(produto.tipoProduto.larguraEmbalagem),
      alturaEmbalagem: decimalToNumber(produto.tipoProduto.alturaEmbalagem),
      comprimentoEmbalagem: decimalToNumber(produto.tipoProduto.comprimentoEmbalagem),
    },
    estampa: {
      id: produto.estampa.id,
      nome: produto.estampa.descricao ?? produto.estampa.codigo,
      codigo: produto.estampa.codigo,
      descricao: produto.estampa.descricao,
      palavrasChave: produto.estampa.palavrasChave,
      extra: produto.estampa.extra,
      imagemUrl: produto.estampa.imagemUrl,
      imagemUrl2: produto.estampa.imagemUrl2,
    },
    variante: produto.variante
      ? {
          id: produto.variante.id,
          nome: produto.variante.descricao ?? produto.variante.codigo,
          codigo: produto.variante.codigo,
          descricao: produto.variante.descricao,
          palavrasChave: produto.variante.palavrasChave,
          atributo: "Variante",
          valor: produto.variante.descricao ?? produto.variante.codigo,
        }
      : null,
    tamanho: produto.tamanho
      ? {
          id: produto.tamanho.id,
          titulo: produto.tamanho.titulo,
          sku: produto.tamanho.sku,
          slug: produto.tamanho.slug,
          precoCusto: decimalToNumber(produto.tamanho.precoCusto),
          preco: decimalToNumber(produto.tamanho.preco),
          pesoLiquido: decimalToNumber(produto.tamanho.pesoLiquido),
          pesoBruto: decimalToNumber(produto.tamanho.pesoBruto),
          larguraEmbalagem: decimalToNumber(produto.tamanho.larguraEmbalagem),
          alturaEmbalagem: decimalToNumber(produto.tamanho.alturaEmbalagem),
          comprimentoEmbalagem: decimalToNumber(produto.tamanho.comprimentoEmbalagem),
        }
      : null,
  };
}

function normalizeProdutoKitBase(produto: {
  id: string;
  sku: string;
  idCadastroOlist: string | null;
  imagemUrl: string | null;
  produtosOlist?: Array<{
    id: string;
    skuFinal: string;
    tituloFinal: string;
    precoCusto: unknown;
    preco: unknown;
    pesoLiquido: unknown;
    pesoBruto: unknown;
    larguraEmbalagem: unknown;
    alturaEmbalagem: unknown;
    comprimentoEmbalagem: unknown;
    tipoProdutoId: string;
    estampaId: string;
  }>;
  produtoFornecedorOlist?: {
    produtoFornecedorId: string;
    quantidadeUsada: unknown;
    produtoFornecedor: {
      id: string;
      fornecedorId: string;
      nome: string;
      descricao: string | null;
      referencia: string | null;
      precoUnitarioMetro: unknown;
      pesoLiquidoMetro?: unknown;
      pesoBrutoMetro?: unknown;
      larguraEmbalagemMetro?: unknown;
      alturaEmbalagemMetro?: unknown;
      comprimentoEmbalagemMetro?: unknown;
      fornecedor: {
        nome: string;
      };
    };
  } | null;
}) {
  const produtoOlist = produto.produtosOlist?.[0] ?? null;
  const produtoFornecido = produto.produtoFornecedorOlist ?? null;

  return {
    id: produto.id,
    sku: produto.sku,
    idCadastroOlist: produto.idCadastroOlist,
    imagemUrl: produto.imagemUrl,
    produtoOlist: produtoOlist
      ? {
          id: produtoOlist.id,
          skuFinal: produtoOlist.skuFinal,
          tituloFinal: produtoOlist.tituloFinal,
          precoCusto: decimalToNumber(produtoOlist.precoCusto),
          preco: decimalToNumber(produtoOlist.preco),
          pesoLiquido: decimalToNumber(produtoOlist.pesoLiquido),
          pesoBruto: decimalToNumber(produtoOlist.pesoBruto),
          larguraEmbalagem: decimalToNumber(produtoOlist.larguraEmbalagem),
          alturaEmbalagem: decimalToNumber(produtoOlist.alturaEmbalagem),
          comprimentoEmbalagem: decimalToNumber(produtoOlist.comprimentoEmbalagem),
          tipoProdutoId: produtoOlist.tipoProdutoId,
          estampaId: produtoOlist.estampaId,
        }
      : null,
    produtoFornecido: produtoFornecido
      ? {
          produtoFornecedorId: produtoFornecido.produtoFornecedorId,
          quantidadeUsada: decimalToNumber(produtoFornecido.quantidadeUsada) ?? 0,
          produtoFornecedor: normalizeProdutoFornecedor(produtoFornecido.produtoFornecedor),
        }
      : null,
  };
}

async function carregarDados() {
  const [tiposProduto, produtosFornecedor, estampas, variantes, tamanhos, produtosFinais, produtos] = await Promise.all([
    prisma.tipoProduto.findMany({
      include: {
        produtosFornecedor: {
          include: {
            produtoFornecedor: {
              include: {
                fornecedor: { select: { nome: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { titulo: "asc" },
    }),
    prisma.produtoFornecedor.findMany({
      include: {
        fornecedor: { select: { nome: true } },
      },
      orderBy: { nome: "asc" },
    }),
    prisma.estampa.findMany({
      orderBy: { codigo: "asc" },
    }),
    prisma.variante.findMany({
      include: {
        estampa: { select: { id: true, codigo: true, descricao: true } },
        tamanho: { select: { id: true, titulo: true, sku: true, slug: true } },
      },
      orderBy: { codigo: "asc" },
    }),
    prisma.tamanho.findMany({
      include: {
        produtosFornecedor: {
          include: {
            produtoFornecedor: {
              include: {
                fornecedor: { select: { nome: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { titulo: "asc" },
    }),
    prisma.produtoOlist.findMany({
      include: {
        produto: { select: { id: true, sku: true, idCadastroOlist: true } },
        tipoProduto: {
          select: {
            id: true,
            titulo: true,
            sku: true,
            descricao: true,
            descricaoSeo: true,
            palavrasChave: true,
            detalhesPromptIa: true,
            corteLaser: true,
            tecidoCorrido: true,
            slug: true,
            categoria: true,
            precoCusto: true,
            preco: true,
            pesoLiquido: true,
            pesoBruto: true,
            larguraEmbalagem: true,
            alturaEmbalagem: true,
            comprimentoEmbalagem: true,
          },
        },
        estampa: {
          select: {
            id: true,
            codigo: true,
            descricao: true,
            palavrasChave: true,
            extra: true,
            imagemUrl: true,
            imagemUrl2: true,
          },
        },
        variante: {
          select: { id: true, codigo: true, descricao: true, palavrasChave: true },
        },
        tamanho: {
          select: {
            id: true,
            titulo: true,
            sku: true,
            slug: true,
            precoCusto: true,
            preco: true,
            pesoLiquido: true,
            pesoBruto: true,
            larguraEmbalagem: true,
            alturaEmbalagem: true,
            comprimentoEmbalagem: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.produto.findMany({
      where: { ativo: true },
      select: {
        id: true,
        sku: true,
        idCadastroOlist: true,
        imagemUrl: true,
        produtosOlist: {
          select: {
            id: true,
            skuFinal: true,
            tituloFinal: true,
            precoCusto: true,
            preco: true,
            pesoLiquido: true,
            pesoBruto: true,
            larguraEmbalagem: true,
            alturaEmbalagem: true,
            comprimentoEmbalagem: true,
            tipoProdutoId: true,
            estampaId: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        produtoFornecedorOlist: {
          select: {
            produtoFornecedorId: true,
            quantidadeUsada: true,
            produtoFornecedor: {
              include: {
                fornecedor: { select: { nome: true } },
              },
            },
          },
        },
      },
      orderBy: { sku: "asc" },
    }),
  ]);

  return {
    tiposProduto: tiposProduto.map(normalizeTipoProduto),
    produtosFornecedor: produtosFornecedor.map(normalizeProdutoFornecedor),
    estampas: estampas.map(normalizeEstampa),
    variantes: variantes.map(normalizeVariante),
    tamanhos: tamanhos.map(normalizeTamanho),
    produtosFinais: produtosFinais.map(normalizeProdutoOlist),
    produtos: produtos.map(normalizeProdutoKitBase),
  };
}

export async function GET() {
  try {
    return NextResponse.json(await carregarDados());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar dados." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const action = String(formData.get("action") ?? "");

      if (!["upload-estampa-imagem", "upload-estampa-temporaria-mockup"].includes(action)) {
        return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
      }

      if (action === "upload-estampa-temporaria-mockup") {
        const produtoId = requiredString(formData.get("produtoId"), "produtoId");
        const file = formData.get("file");

        if (!(file instanceof File) || file.size === 0) {
          throw new Error("Cole uma imagem da estampa.");
        }

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("Formato de imagem invalido para upload.");
        }

        await prisma.produtoOlist.findUniqueOrThrow({ where: { id: produtoId }, select: { id: true } });
        const uploadedImage = await uploadToGoogleStorage({
          path: buildTemporaryMockupEstampaPath(produtoId, file.type),
          buffer: Buffer.from(await file.arrayBuffer()),
          contentType: file.type,
        });

        return NextResponse.json({
          upload: {
            uploadedUrl: uploadedImage.publicUrl,
            uploadedPath: uploadedImage.path,
          },
        });
      }

      const id = requiredString(formData.get("id"), "id");
      const codigo = requiredString(formData.get("codigo"), "codigo").toUpperCase();
      const index = Number(formData.get("index") ?? 0);
      const file = formData.get("file");

      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Envie uma imagem da estampa.");
      }

      if (!file.type.startsWith("image/")) {
        throw new Error("Formato de imagem invalido para upload.");
      }

      const estampaAtual = await prisma.estampa.findUniqueOrThrow({ where: { id } });
      if (estampaAtual.codigo.toUpperCase() !== codigo) {
        throw new Error("Codigo da estampa nao confere com o cadastro salvo.");
      }

      const outputPath = buildEstampaImagemStoragePath(codigo, index);
      await deleteGoogleStorageObject(outputPath);

      const uploadedImage = await uploadToGoogleStorage({
        path: outputPath,
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || "image/jpeg",
      });

      const estampa = await prisma.estampa.update({
        where: { id },
        data: index === 0 ? { imagemUrl: uploadedImage.publicUrl } : { imagemUrl2: uploadedImage.publicUrl },
      });

      return NextResponse.json({
        upload: {
          uploadedUrl: uploadedImage.publicUrl,
          uploadedPath: uploadedImage.path,
        },
        estampa: normalizeEstampa(estampa),
      });
    }

    const body = (await request.json()) as { action?: string; payload?: Record<string, unknown> };
    const payload = body.payload ?? {};

    if (body.action === "salvar-tipo-produto") {
      const titulo = requiredString(payload.nome ?? payload.titulo, "titulo");
      const sku = cleanCodePart(optionalString(payload.prefixoSku ?? payload.sku) ?? titulo);
      if (!sku) {
        throw new Error("Nao foi possivel gerar SKU a partir do titulo.");
      }
      const produtosFornecidosPayload = Array.isArray(payload.produtosFornecidos)
        ? payload.produtosFornecidos
        : [];
      const produtosFornecidos = produtosFornecidosPayload.map((item, index) => {
        if (!item || typeof item !== "object") {
          throw new Error(`Produto fornecido invalido na linha ${index + 1}.`);
        }

        const produtoFornecedorId = requiredString(
          (item as Record<string, unknown>).produtoFornecedorId,
          `produtosFornecidos[${index}].produtoFornecedorId`,
        );
        const quantidadeUsada = requiredPositiveNumber(
          (item as Record<string, unknown>).quantidadeUsada,
          `produtosFornecidos[${index}].quantidadeUsada`,
        );

        return { produtoFornecedorId, quantidadeUsada };
      });
      const produtosFornecidosUnicos = new Set<string>();
      for (const item of produtosFornecidos) {
        if (produtosFornecidosUnicos.has(item.produtoFornecedorId)) {
          throw new Error("Nao associe o mesmo produto fornecido mais de uma vez.");
        }

        produtosFornecidosUnicos.add(item.produtoFornecedorId);
      }
      if (produtosFornecidos.length !== 1) {
        throw new Error("Associe um produto fornecido ao tipo de produto.");
      }

      const produtoFornecedorExiste =
        produtosFornecidos.length > 0
          ? await prisma.produtoFornecedor.count({
              where: { id: produtosFornecidos[0].produtoFornecedorId },
            })
          : 0;

      if (produtosFornecidos.length > 0 && produtoFornecedorExiste !== 1) {
        throw new Error("Produto fornecido nao encontrado.");
      }
      const data = {
        titulo,
        sku,
        descricao: optionalString(payload.descricao),
        descricaoSeo: optionalString(payload.descricaoSeo),
        palavrasChave: optionalString(payload.palavrasChave),
        detalhesPromptIa: optionalString(payload.detalhesPromptIa),
        corteLaser: booleanValue(payload.corteLaser),
        tecidoCorrido: booleanValue(payload.tecidoCorrido),
        slug: buildSlugFinal([optionalString(payload.slug) ?? titulo]),
        categoria: optionalString(payload.categoria),
      };

      const tipoProduto = await prisma.$transaction(async (tx) => {
        const salvo =
          typeof payload.id === "string" && payload.id
            ? await tx.tipoProduto.update({ where: { id: payload.id }, data })
            : await tx.tipoProduto.create({ data });

        await tx.tipoProdutoProdutoFornecedor.deleteMany({
          where: { tipoProdutoId: salvo.id },
        });

        if (produtosFornecidos.length > 0) {
          await tx.tipoProdutoProdutoFornecedor.createMany({
            data: produtosFornecidos.map((item) => ({
              tipoProdutoId: salvo.id,
              produtoFornecedorId: item.produtoFornecedorId,
              quantidadeUsada: item.quantidadeUsada,
            })),
          });
        }

        return tx.tipoProduto.findUniqueOrThrow({
          where: { id: salvo.id },
          include: {
            produtosFornecedor: {
              include: {
                produtoFornecedor: {
                  include: {
                    fornecedor: { select: { nome: true } },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });
      });

      return NextResponse.json({ tipoProduto: normalizeTipoProduto(tipoProduto) });
    }

    if (body.action === "excluir-tipo-produto") {
      const id = requiredString(payload.id, "id");
      await prisma.tipoProduto.delete({ where: { id } });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "verificar-estampas-imagens") {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        : [];

      if (!ids.length) {
        throw new Error("Selecione ao menos uma estampa para verificar.");
      }

      const estampas = await prisma.estampa.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          codigo: true,
          imagemUrl: true,
          imagemUrl2: true,
        },
      });
      let imagem0Encontradas = 0;
      let imagem1Encontradas = 0;
      let estampasAtualizadas = 0;

      for (const estampa of estampas) {
        const [imagem0, imagem1] = await Promise.all([
          getGoogleStorageObjectInfo(buildEstampaImagemStoragePath(estampa.codigo, 0)),
          getGoogleStorageObjectInfo(buildEstampaImagemStoragePath(estampa.codigo, 1)),
        ]);
        const data: { imagemUrl?: string; imagemUrl2?: string } = {};

        if (imagem0.exists) {
          imagem0Encontradas += 1;
          if (estampa.imagemUrl !== imagem0.publicUrl) {
            data.imagemUrl = imagem0.publicUrl;
          }
        }

        if (imagem1.exists) {
          imagem1Encontradas += 1;
          if (estampa.imagemUrl2 !== imagem1.publicUrl) {
            data.imagemUrl2 = imagem1.publicUrl;
          }
        }

        if (Object.keys(data).length > 0) {
          await prisma.estampa.update({ where: { id: estampa.id }, data });
          estampasAtualizadas += 1;
        }
      }

      return NextResponse.json({
        totalVerificadas: estampas.length,
        imagem0Encontradas,
        imagem1Encontradas,
        estampasAtualizadas,
      });
    }

    if (body.action === "salvar-estampa") {
      const data = {
        codigo: requiredString(payload.codigo, "codigo").toUpperCase(),
        descricao: optionalString(payload.descricao ?? payload.nome),
        palavrasChave: optionalString(payload.palavrasChave),
        extra: optionalString(payload.extra),
      };

      const estampa =
        typeof payload.id === "string" && payload.id
          ? await prisma.estampa.update({ where: { id: payload.id }, data })
          : await prisma.estampa.create({ data });

      return NextResponse.json({ estampa: normalizeEstampa(estampa) });
    }

    if (body.action === "excluir-estampa") {
      const id = requiredString(payload.id, "id");
      await prisma.estampa.delete({ where: { id } });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "salvar-variante") {
      const estampaId = requiredString(payload.estampaId, "estampaId");
      const tamanhoId = requiredString(payload.tamanhoId, "tamanhoId");
      await Promise.all([
        prisma.estampa.findUniqueOrThrow({ where: { id: estampaId } }),
        prisma.tamanho.findUniqueOrThrow({ where: { id: tamanhoId } }),
      ]);

      const data = {
        estampaId,
        tamanhoId,
        codigo: requiredString(payload.codigo, "codigo").toUpperCase(),
        descricao: optionalString(payload.descricao ?? payload.nome ?? payload.valor),
        palavrasChave: optionalString(payload.palavrasChave),
      };

      const variante =
        typeof payload.id === "string" && payload.id
          ? await prisma.variante.update({
              where: { id: payload.id },
              data,
              include: {
                estampa: { select: { id: true, codigo: true, descricao: true } },
                tamanho: { select: { id: true, titulo: true, sku: true, slug: true } },
              },
            })
          : await prisma.variante.create({
              data,
              include: {
                estampa: { select: { id: true, codigo: true, descricao: true } },
                tamanho: { select: { id: true, titulo: true, sku: true, slug: true } },
              },
            });

      return NextResponse.json({ variante: normalizeVariante(variante) });
    }

    if (body.action === "excluir-variante") {
      const id = requiredString(payload.id, "id");
      await prisma.variante.delete({ where: { id } });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "salvar-tamanho") {
      const titulo = requiredString(payload.titulo, "titulo");
      const quantidadeProdutoFornecedor = requiredPositiveNumber(
        payload.quantidadeProdutoFornecedor,
        "quantidadeProdutoFornecedor",
      );
      const data = {
        titulo,
        sku: requiredString(payload.sku, "sku").toUpperCase(),
        slug: buildSlugFinal([optionalString(payload.slug) ?? titulo]),
        quantidadeProdutoFornecedor,
      };

      const tamanho = await prisma.$transaction(async (tx) => {
        const salvo =
          typeof payload.id === "string" && payload.id
            ? await tx.tamanho.update({ where: { id: payload.id }, data })
            : await tx.tamanho.create({ data });

        await tx.tamanhoProdutoFornecedor.deleteMany({
          where: { tamanhoId: salvo.id },
        });

        return tx.tamanho.findUniqueOrThrow({
          where: { id: salvo.id },
          include: {
            produtosFornecedor: {
              include: {
                produtoFornecedor: {
                  include: {
                    fornecedor: { select: { nome: true } },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });
      });

      return NextResponse.json({ tamanho: normalizeTamanho(tamanho) });
    }

    if (body.action === "excluir-tamanho") {
      const id = requiredString(payload.id, "id");
      await prisma.tamanho.delete({ where: { id } });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "gerar-produtos-finais-lote") {
      const tipoProdutoId = requiredString(payload.tipoProdutoId, "tipoProdutoId");
      const tamanhoId = requiredString(payload.tamanhoId, "tamanhoId");
      const estampaIds = Array.from(
        new Set(
          (Array.isArray(payload.estampaIds) ? payload.estampaIds : []).filter(
            (id): id is string => typeof id === "string" && Boolean(id.trim()),
          ),
        ),
      );
      const precoCusto = optionalNumber(payload.precoCusto, "precoCusto");
      const preco = optionalNumber(payload.preco, "preco");
      const pesoLiquido = optionalNumber(payload.pesoLiquido, "pesoLiquido");
      const pesoBruto = optionalNumber(payload.pesoBruto, "pesoBruto");
      const larguraEmbalagem = optionalNumber(payload.larguraEmbalagem, "larguraEmbalagem");
      const alturaEmbalagem = optionalNumber(payload.alturaEmbalagem, "alturaEmbalagem");
      const comprimentoEmbalagem = optionalNumber(payload.comprimentoEmbalagem, "comprimentoEmbalagem");

      if (estampaIds.length === 0) {
        throw new Error("Selecione ao menos uma estampa.");
      }
      if (alturaEmbalagem === null || alturaEmbalagem < 1) {
        throw new Error("A altura da embalagem deve ser no minimo 1.");
      }

      const [tipoProduto, tamanho, estampas, variantes] = await Promise.all([
        prisma.tipoProduto.findUniqueOrThrow({
          where: { id: tipoProdutoId },
          include: {
            produtosFornecedor: {
              include: { produtoFornecedor: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        }),
        prisma.tamanho.findUniqueOrThrow({ where: { id: tamanhoId } }),
        prisma.estampa.findMany({ where: { id: { in: estampaIds } } }),
        prisma.variante.findMany({
          where: {
            estampaId: { in: estampaIds },
            tamanhoId,
          },
        }),
      ]);
      const produtoFornecedorTipo = tipoProduto.produtosFornecedor[0]?.produtoFornecedor ?? null;
      const quantidadeProdutoFornecedor = decimalToNumber(tamanho.quantidadeProdutoFornecedor);

      if (!produtoFornecedorTipo) {
        throw new Error("O tipo de produto selecionado nao possui produto fornecido associado.");
      }
      if (quantidadeProdutoFornecedor === null || quantidadeProdutoFornecedor <= 0) {
        throw new Error("O tamanho selecionado nao possui quantidade usada do produto fornecido.");
      }
      if (estampas.length !== estampaIds.length) {
        throw new Error("Uma ou mais estampas selecionadas nao foram encontradas.");
      }
      if (variantes.length === 0) {
        throw new Error("Nenhuma variante encontrada para as estampas e tamanho selecionados.");
      }

      const precoCustoCalculado =
        Number(produtoFornecedorTipo.precoUnitarioMetro) * quantidadeProdutoFornecedor;
      const estampasPorId = new Map(estampas.map((estampa) => [estampa.id, estampa]));
      const skusGerados = new Set<string>();
      const produtosData = variantes.map((variante) => {
        const estampa = variante.estampaId ? estampasPorId.get(variante.estampaId) : null;
        if (!estampa) {
          throw new Error(`Estampa da variante ${variante.codigo} nao encontrada.`);
        }

        const skuFinal = buildProdutoFinalSku(
          tipoProduto,
          tamanho.sku,
          estampa.codigo,
          variante.codigo,
        );
        if (skusGerados.has(skuFinal)) {
          throw new Error(`A selecao atual gera SKU duplicado: ${skuFinal}.`);
        }
        skusGerados.add(skuFinal);

        const templateVariables = {
          ...buildProdutoVariables(tipoProduto, estampa, variante),
          TAMANHO: tamanho.titulo,
        };
        const tituloFinal = hasTemplateVariable(tipoProduto.titulo)
          ? renderTemplate(tipoProduto.titulo, templateVariables)
          : joinTextParts([tipoProduto.titulo, tamanho.titulo, estampa.codigo, variante.codigo]);
        const descricaoFinal = hasTemplateVariable(tipoProduto.descricao)
          ? renderTemplate(tipoProduto.descricao, templateVariables)
          : joinTextParts([
              tipoProduto.descricao,
              tamanho.titulo,
              estampa.descricao,
              variante.descricao,
            ]);
        const descricaoSeoFinal = hasTemplateVariable(tipoProduto.descricaoSeo)
          ? renderTemplate(tipoProduto.descricaoSeo, templateVariables)
          : joinTextParts([
              tipoProduto.descricaoSeo,
              estampa.descricao,
              variante.descricao,
            ]);

        return {
          tipoProdutoId,
          estampaId: estampa.id,
          varianteId: variante.id,
          tamanhoId,
          skuFinal,
          tituloFinal,
          descricaoFinal: descricaoFinal || null,
          descricaoSeoFinal: descricaoSeoFinal || null,
          palavrasChaveFinal: joinKeywordParts([
            tipoProduto.palavrasChave,
            estampa.palavrasChave,
            variante.palavrasChave,
          ]) || null,
          slugFinal: buildSlugFinal([
            tipoProduto.slug,
            ...buildTipoProdutoMarkers(tipoProduto),
            tamanho.slug ?? tamanho.titulo,
            estampa.codigo,
            variante.codigo,
          ]) || null,
          categoria: tipoProduto.categoria,
          precoCusto: precoCustoCalculado ?? precoCusto,
          preco,
          pesoLiquido,
          pesoBruto,
          larguraEmbalagem,
          alturaEmbalagem,
          comprimentoEmbalagem,
        };
      });
      const existentes = await prisma.produtoOlist.findMany({
        where: { skuFinal: { in: produtosData.map((produto) => produto.skuFinal) } },
        select: { skuFinal: true },
      });
      const skusExistentes = new Set(existentes.map((produto) => produto.skuFinal));

      const valoresSql = produtosData.map((data) => Prisma.sql`(
        ${data.tipoProdutoId}::uuid,
        ${data.estampaId}::uuid,
        ${data.varianteId}::uuid,
        ${data.tamanhoId}::uuid,
        ${data.skuFinal},
        ${data.tituloFinal},
        ${data.descricaoFinal},
        ${data.descricaoSeoFinal},
        ${data.palavrasChaveFinal},
        ${data.slugFinal},
        ${data.categoria},
        ${data.precoCusto},
        ${data.preco},
        ${data.pesoLiquido},
        ${data.pesoBruto},
        ${data.larguraEmbalagem},
        ${data.alturaEmbalagem},
        ${data.comprimentoEmbalagem}
      )`);

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO produto_olist (
          tipo_produto_id,
          estampa_id,
          variante_id,
          tamanho_id,
          sku_final,
          titulo_final,
          descricao_final,
          descricao_seo_final,
          palavras_chave_final,
          slug_final,
          categoria,
          preco_custo,
          preco,
          peso_liquido,
          peso_bruto,
          largura_embalagem,
          altura_embalagem,
          comprimento_embalagem
        )
        VALUES ${Prisma.join(valoresSql)}
        ON CONFLICT (sku_final) DO UPDATE SET
          tipo_produto_id = EXCLUDED.tipo_produto_id,
          estampa_id = EXCLUDED.estampa_id,
          variante_id = EXCLUDED.variante_id,
          tamanho_id = EXCLUDED.tamanho_id,
          titulo_final = EXCLUDED.titulo_final,
          descricao_final = EXCLUDED.descricao_final,
          descricao_seo_final = EXCLUDED.descricao_seo_final,
          palavras_chave_final = EXCLUDED.palavras_chave_final,
          slug_final = EXCLUDED.slug_final,
          categoria = EXCLUDED.categoria,
          preco_custo = EXCLUDED.preco_custo,
          preco = EXCLUDED.preco,
          peso_liquido = EXCLUDED.peso_liquido,
          peso_bruto = EXCLUDED.peso_bruto,
          largura_embalagem = EXCLUDED.largura_embalagem,
          altura_embalagem = EXCLUDED.altura_embalagem,
          comprimento_embalagem = EXCLUDED.comprimento_embalagem,
          updated_at = NOW()
      `);

      return NextResponse.json({
        criados: produtosData.length - skusExistentes.size,
        sobrescritos: skusExistentes.size,
        total: produtosData.length,
      });
    }

    if (body.action === "gerar-produto-final") {
      const tipoProdutoId = requiredString(payload.tipoProdutoId, "tipoProdutoId");
      const estampaId = requiredString(payload.estampaId, "estampaId");
      const varianteId = optionalString(payload.varianteId);
      const tamanhoId = optionalString(payload.tamanhoId);
      const precoCusto = optionalNumber(payload.precoCusto, "precoCusto");
      const preco = optionalNumber(payload.preco, "preco");
      const pesoLiquido = optionalNumber(payload.pesoLiquido, "pesoLiquido");
      const pesoBruto = optionalNumber(payload.pesoBruto, "pesoBruto");
      const larguraEmbalagem = optionalNumber(payload.larguraEmbalagem, "larguraEmbalagem");
      const alturaEmbalagem = optionalNumber(payload.alturaEmbalagem, "alturaEmbalagem");
      const comprimentoEmbalagem = optionalNumber(payload.comprimentoEmbalagem, "comprimentoEmbalagem");

      if (alturaEmbalagem === null || alturaEmbalagem < 1) {
        throw new Error("A altura da embalagem deve ser no minimo 1.");
      }

      const [tipoProduto, estampa, variante, tamanhoSelecionado] = await Promise.all([
        prisma.tipoProduto.findUniqueOrThrow({
          where: { id: tipoProdutoId },
          include: {
            produtosFornecedor: {
              include: {
                produtoFornecedor: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
        }),
        prisma.estampa.findUniqueOrThrow({ where: { id: estampaId } }),
        varianteId
          ? prisma.variante.findUniqueOrThrow({
              where: { id: varianteId },
              include: { tamanho: true },
            })
          : null,
        tamanhoId ? prisma.tamanho.findUniqueOrThrow({ where: { id: tamanhoId } }) : null,
      ]);
      const tamanho = variante?.tamanho ?? tamanhoSelecionado;
      const produtoFornecedorTipo = tipoProduto.produtosFornecedor[0]?.produtoFornecedor ?? null;
      const quantidadeProdutoFornecedor = decimalToNumber(tamanho?.quantidadeProdutoFornecedor ?? null);
      const precoCustoCalculado =
        produtoFornecedorTipo && quantidadeProdutoFornecedor !== null
          ? Number(produtoFornecedorTipo.precoUnitarioMetro) * quantidadeProdutoFornecedor
          : null;

      if (variante && variante.estampaId !== estampaId) {
        throw new Error("A variante selecionada nao pertence a estampa informada.");
      }
      if (variante && tamanhoId && variante.tamanhoId !== tamanhoId) {
        throw new Error("A variante selecionada nao pertence ao tamanho informado.");
      }
      if (!produtoFornecedorTipo) {
        throw new Error("O tipo de produto selecionado nao possui produto fornecido associado.");
      }
      if (quantidadeProdutoFornecedor === null || quantidadeProdutoFornecedor <= 0) {
        throw new Error("O tamanho selecionado nao possui quantidade usada do produto fornecido.");
      }

      const skuFinal = buildProdutoFinalSku(
        tipoProduto,
        tamanho?.sku,
        estampa.codigo,
        variante?.codigo,
      );
      const produtoExistente = await prisma.produtoOlist.findUnique({
        where: { skuFinal },
        select: { id: true },
      });

      const templateVariables = {
        ...buildProdutoVariables(tipoProduto, estampa, variante),
        TAMANHO: tamanho?.titulo ?? variante?.codigo,
      };
      const tituloFinal = hasTemplateVariable(tipoProduto.titulo)
        ? renderTemplate(tipoProduto.titulo, templateVariables)
        : joinTextParts([tipoProduto.titulo, tamanho?.titulo, estampa.codigo, variante?.codigo]);
      const descricaoFinal = hasTemplateVariable(tipoProduto.descricao)
        ? renderTemplate(tipoProduto.descricao, templateVariables)
        : joinTextParts([
            tipoProduto.descricao,
            tamanho?.titulo,
            estampa.descricao,
            variante?.descricao,
          ]);
      const descricaoSeoFinal = hasTemplateVariable(tipoProduto.descricaoSeo)
        ? renderTemplate(tipoProduto.descricaoSeo, templateVariables)
        : joinTextParts([
            tipoProduto.descricaoSeo,
            estampa.descricao,
            variante?.descricao,
          ]);
      const palavrasChaveFinal = joinKeywordParts([
        tipoProduto.palavrasChave,
        estampa.palavrasChave,
        variante?.palavrasChave,
      ]);
      const produtoFinalData = {
        tipoProdutoId,
        estampaId,
        varianteId,
        tamanhoId,
        skuFinal,
        tituloFinal,
        descricaoFinal: descricaoFinal || null,
        descricaoSeoFinal: descricaoSeoFinal || null,
        palavrasChaveFinal: palavrasChaveFinal || null,
        slugFinal: buildSlugFinal([
          tipoProduto.slug,
          ...buildTipoProdutoMarkers(tipoProduto),
          tamanho?.slug ?? tamanho?.titulo,
          estampa.codigo,
          variante?.codigo,
        ]) || null,
        categoria: tipoProduto.categoria,
        precoCusto: precoCustoCalculado ?? precoCusto,
        preco,
        pesoLiquido,
        pesoBruto,
        larguraEmbalagem,
        alturaEmbalagem,
        comprimentoEmbalagem,
      };
      const produtoFinal = produtoExistente
        ? await prisma.produtoOlist.update({
            where: { id: produtoExistente.id },
            data: produtoFinalData,
            include: {
              produto: { select: { id: true, sku: true, idCadastroOlist: true } },
              tipoProduto: {
                select: {
                  id: true,
                  titulo: true,
                  sku: true,
                  descricao: true,
                  descricaoSeo: true,
                  palavrasChave: true,
                  detalhesPromptIa: true,
                  corteLaser: true,
                  tecidoCorrido: true,
                  slug: true,
                  categoria: true,
                  precoCusto: true,
                  preco: true,
                  pesoLiquido: true,
                  pesoBruto: true,
                  larguraEmbalagem: true,
                  alturaEmbalagem: true,
                  comprimentoEmbalagem: true,
                },
              },
              estampa: {
                select: {
                  id: true,
                  codigo: true,
                  descricao: true,
                  palavrasChave: true,
                  extra: true,
                  imagemUrl: true,
                  imagemUrl2: true,
                },
              },
              variante: { select: { id: true, codigo: true, descricao: true, palavrasChave: true } },
              tamanho: {
                select: {
                  id: true,
                  titulo: true,
                  sku: true,
                  slug: true,
                  precoCusto: true,
                  preco: true,
                  pesoLiquido: true,
                  pesoBruto: true,
                  larguraEmbalagem: true,
                  alturaEmbalagem: true,
                  comprimentoEmbalagem: true,
                },
              },
            },
          })
        : await prisma.produtoOlist.create({
            data: produtoFinalData,
        include: {
          produto: { select: { id: true, sku: true, idCadastroOlist: true } },
          tipoProduto: {
            select: {
              id: true,
              titulo: true,
              sku: true,
              descricao: true,
              descricaoSeo: true,
              palavrasChave: true,
              detalhesPromptIa: true,
              corteLaser: true,
              tecidoCorrido: true,
              slug: true,
              categoria: true,
              precoCusto: true,
              preco: true,
              pesoLiquido: true,
              pesoBruto: true,
              larguraEmbalagem: true,
              alturaEmbalagem: true,
              comprimentoEmbalagem: true,
            },
          },
          estampa: {
            select: {
              id: true,
              codigo: true,
              descricao: true,
              palavrasChave: true,
              extra: true,
              imagemUrl: true,
              imagemUrl2: true,
            },
          },
          variante: { select: { id: true, codigo: true, descricao: true, palavrasChave: true } },
          tamanho: {
            select: {
              id: true,
              titulo: true,
              sku: true,
              slug: true,
              precoCusto: true,
              preco: true,
              pesoLiquido: true,
              pesoBruto: true,
              larguraEmbalagem: true,
              alturaEmbalagem: true,
              comprimentoEmbalagem: true,
            },
          },
        },
          });

      return NextResponse.json({ produtoFinal: normalizeProdutoOlist(produtoFinal) });
    }

    if (body.action === "salvar-produto-final") {
      const id = requiredString(payload.id, "id");
      const skuFinal = requiredString(payload.skuFinal, "skuFinal").toUpperCase();
      const tituloFinal = requiredString(payload.tituloFinal, "tituloFinal");
      const produtoComSku = await prisma.produtoOlist.findUnique({
        where: { skuFinal },
        select: { id: true },
      });

      if (produtoComSku && produtoComSku.id !== id) {
        throw new Error(`Ja existe um produto final com o SKU ${skuFinal}.`);
      }

      const produtoFinal = await prisma.produtoOlist.update({
        where: { id },
        data: {
          skuFinal,
          tituloFinal: cleanText(tituloFinal),
          categoria: optionalString(payload.categoria),
          precoCusto: optionalNumber(payload.precoCusto, "precoCusto"),
          preco: optionalNumber(payload.preco, "preco"),
        },
        include: {
          produto: { select: { id: true, sku: true, idCadastroOlist: true } },
          tipoProduto: {
            select: {
              id: true,
              titulo: true,
              sku: true,
              descricao: true,
              descricaoSeo: true,
              palavrasChave: true,
              detalhesPromptIa: true,
              corteLaser: true,
              tecidoCorrido: true,
              slug: true,
              categoria: true,
              precoCusto: true,
              preco: true,
              pesoLiquido: true,
              pesoBruto: true,
              larguraEmbalagem: true,
              alturaEmbalagem: true,
              comprimentoEmbalagem: true,
            },
          },
          estampa: {
            select: {
              id: true,
              codigo: true,
              descricao: true,
              palavrasChave: true,
              extra: true,
              imagemUrl: true,
              imagemUrl2: true,
            },
          },
          variante: { select: { id: true, codigo: true, descricao: true, palavrasChave: true } },
          tamanho: {
            select: {
              id: true,
              titulo: true,
              sku: true,
              slug: true,
              precoCusto: true,
              preco: true,
              pesoLiquido: true,
              pesoBruto: true,
              larguraEmbalagem: true,
              alturaEmbalagem: true,
              comprimentoEmbalagem: true,
            },
          },
        },
      });

      return NextResponse.json({ produtoFinal: normalizeProdutoOlist(produtoFinal) });
    }

    if (body.action === "salvar-produto-kit-final") {
      const tipoProdutoId = requiredString(payload.tipoProdutoId, "tipoProdutoId");
      const estampaId = requiredString(payload.estampaId, "estampaId");
      const tituloFinal = requiredString(payload.tituloFinal, "tituloFinal");
      const componentesPayload = Array.isArray(payload.componentes) ? payload.componentes : [];
      const componentes = componentesPayload.map((item, index) => {
        const itemRecord = item as Record<string, unknown>;
        const produtoId = requiredString(itemRecord.produtoId, `componentes[${index}].produtoId`);
        const quantidade = requiredPositiveNumber(itemRecord.quantidade, `componentes[${index}].quantidade`);

        return { produtoId, quantidade };
      });

      if (componentes.length === 0) {
        throw new Error("Selecione ao menos um produto para compor o kit.");
      }

      const [tipoProduto, estampa, produtosComponentes] = await Promise.all([
        prisma.tipoProduto.findUniqueOrThrow({ where: { id: tipoProdutoId } }),
        prisma.estampa.findUniqueOrThrow({ where: { id: estampaId } }),
        prisma.produto.findMany({
          where: { id: { in: componentes.map((item) => item.produtoId) }, ativo: true },
          select: {
            id: true,
            sku: true,
            produtosOlist: {
              select: {
                precoCusto: true,
                preco: true,
                pesoLiquido: true,
                pesoBruto: true,
                larguraEmbalagem: true,
                alturaEmbalagem: true,
                comprimentoEmbalagem: true,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            produtoFornecedorOlist: {
              select: {
                quantidadeUsada: true,
                produtoFornecedor: {
                  select: {
                    precoUnitarioMetro: true,
                    pesoLiquidoMetro: true,
                    pesoBrutoMetro: true,
                    larguraEmbalagemMetro: true,
                    alturaEmbalagemMetro: true,
                    comprimentoEmbalagemMetro: true,
                  },
                },
              },
            },
          },
        }),
      ]);
      const produtosPorId = new Map(produtosComponentes.map((produto) => [produto.id, produto]));
      const componenteAusente = componentes.find((item) => !produtosPorId.has(item.produtoId));

      if (componenteAusente) {
        throw new Error("Um dos produtos selecionados nao foi encontrado ou esta inativo.");
      }

      const skuFinal = buildKitSku(componentes.map((item) => produtosPorId.get(item.produtoId)!));
      if (!skuFinal) {
        throw new Error("Nao foi possivel gerar o SKU final do kit.");
      }

      const componentesDescricao = componentes.map((item) => {
        const produto = produtosPorId.get(item.produtoId)!;
        return `${formatDecimalPtBr(item.quantidade)} x ${produto.sku}`;
      });
      const calcularValorProduto = (
        produto: (typeof produtosComponentes)[number],
        key: "precoCusto" | "preco" | "pesoLiquido" | "pesoBruto" | "larguraEmbalagem" | "alturaEmbalagem" | "comprimentoEmbalagem",
      ) => decimalToNumber(produto.produtosOlist[0]?.[key] ?? null);
      const calcularFornecedor = (
        produto: (typeof produtosComponentes)[number],
        key:
          | "precoUnitarioMetro"
          | "pesoLiquidoMetro"
          | "pesoBrutoMetro"
          | "larguraEmbalagemMetro"
          | "alturaEmbalagemMetro"
          | "comprimentoEmbalagemMetro",
      ) => {
        const relacionamento = produto.produtoFornecedorOlist;
        const quantidadeUsada = decimalToNumber(relacionamento?.quantidadeUsada ?? null);
        const valor = decimalToNumber(relacionamento?.produtoFornecedor[key] ?? null);

        return quantidadeUsada !== null && valor !== null ? quantidadeUsada * valor : null;
      };
      const somarComponentes = (
        calcular: (produto: (typeof produtosComponentes)[number]) => number | null,
      ) => {
        let total = 0;
        let encontrouValor = false;

        for (const item of componentes) {
          const produto = produtosPorId.get(item.produtoId)!;
          const valor = calcular(produto);

          if (valor === null) continue;
          total += valor * item.quantidade;
          encontrouValor = true;
        }

        return encontrouValor ? total : null;
      };
      const somarComponentesSemQuantidade = (
        calcular: (produto: (typeof produtosComponentes)[number]) => number | null,
      ) => {
        let total = 0;
        let encontrouValor = false;

        for (const item of componentes) {
          const produto = produtosPorId.get(item.produtoId)!;
          const valor = calcular(produto);

          if (valor === null) continue;
          total += valor;
          encontrouValor = true;
        }

        return encontrouValor ? total : null;
      };
      const precoCustoCalculado = somarComponentes(
        (produto) => calcularValorProduto(produto, "precoCusto") ?? calcularFornecedor(produto, "precoUnitarioMetro"),
      );
      const pesoLiquidoCalculado = somarComponentes(
        (produto) => calcularValorProduto(produto, "pesoLiquido") ?? calcularFornecedor(produto, "pesoLiquidoMetro"),
      );
      const pesoBrutoCalculado = somarComponentes(
        (produto) => calcularValorProduto(produto, "pesoBruto") ?? calcularFornecedor(produto, "pesoBrutoMetro"),
      );
      const larguraCalculada = somarComponentesSemQuantidade(
        (produto) => calcularValorProduto(produto, "larguraEmbalagem") ?? calcularFornecedor(produto, "larguraEmbalagemMetro"),
      );
      const alturaCalculada = somarComponentes(
        (produto) => calcularValorProduto(produto, "alturaEmbalagem") ?? calcularFornecedor(produto, "alturaEmbalagemMetro"),
      );
      const comprimentoCalculado = somarComponentesSemQuantidade(
        (produto) =>
          calcularValorProduto(produto, "comprimentoEmbalagem") ?? calcularFornecedor(produto, "comprimentoEmbalagemMetro"),
      );
      const produtoExistente = await prisma.produtoOlist.findUnique({
        where: { skuFinal },
        select: { id: true },
      });
      const produtoFinalData = {
        tipoProdutoId,
        estampaId,
        varianteId: null,
        tamanhoId: null,
        skuFinal,
        tituloFinal: cleanText(tituloFinal),
        descricaoFinal:
          optionalString(payload.descricaoFinal) ??
          `Kit composto por: ${componentesDescricao.join("; ")}.`,
        descricaoSeoFinal: optionalString(payload.descricaoFinal),
        palavrasChaveFinal: componentes.map((item) => produtosPorId.get(item.produtoId)!.sku).join(", "),
        slugFinal: buildSlugFinal([tipoProduto.slug, estampa.codigo, skuFinal]) || null,
        categoria: tipoProduto.categoria,
        precoCusto: optionalNumber(payload.precoCusto, "precoCusto") ?? precoCustoCalculado,
        preco: optionalNumber(payload.preco, "preco"),
        pesoLiquido: optionalNumber(payload.pesoLiquido, "pesoLiquido") ?? pesoLiquidoCalculado,
        pesoBruto: optionalNumber(payload.pesoBruto, "pesoBruto") ?? pesoBrutoCalculado,
        larguraEmbalagem: optionalNumber(payload.larguraEmbalagem, "larguraEmbalagem") ?? larguraCalculada,
        alturaEmbalagem: optionalNumber(payload.alturaEmbalagem, "alturaEmbalagem") ?? alturaCalculada,
        comprimentoEmbalagem: optionalNumber(payload.comprimentoEmbalagem, "comprimentoEmbalagem") ?? comprimentoCalculado,
      };
      const include = {
        produto: { select: { id: true, sku: true, idCadastroOlist: true } },
        tipoProduto: {
          select: {
            id: true,
            titulo: true,
            sku: true,
            descricao: true,
            descricaoSeo: true,
            palavrasChave: true,
            detalhesPromptIa: true,
            corteLaser: true,
            tecidoCorrido: true,
            slug: true,
            categoria: true,
            precoCusto: true,
            preco: true,
            pesoLiquido: true,
            pesoBruto: true,
            larguraEmbalagem: true,
            alturaEmbalagem: true,
            comprimentoEmbalagem: true,
          },
        },
        estampa: {
          select: {
            id: true,
            codigo: true,
            descricao: true,
            palavrasChave: true,
            extra: true,
            imagemUrl: true,
            imagemUrl2: true,
          },
        },
        variante: { select: { id: true, codigo: true, descricao: true, palavrasChave: true } },
        tamanho: {
          select: {
            id: true,
            titulo: true,
            sku: true,
            slug: true,
            precoCusto: true,
            preco: true,
            pesoLiquido: true,
            pesoBruto: true,
            larguraEmbalagem: true,
            alturaEmbalagem: true,
            comprimentoEmbalagem: true,
          },
        },
      };
      const produtoFinal = produtoExistente
        ? await prisma.produtoOlist.update({
            where: { id: produtoExistente.id },
            data: produtoFinalData,
            include,
          })
        : await prisma.produtoOlist.create({
            data: produtoFinalData,
            include,
          });

      return NextResponse.json({ produtoFinal: normalizeProdutoOlist(produtoFinal) });
    }

    if (body.action === "vincular-produtos-finais") {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        : [];

      if (ids.length === 0) {
        throw new Error("Selecione ao menos um produto final para vincular.");
      }

      const produtosFinais = await prisma.produtoOlist.findMany({
        where: { id: { in: ids } },
        select: { id: true, skuFinal: true },
      });
      const produtosPorSku = new Map(
        (
          await prisma.produto.findMany({
            where: { sku: { in: produtosFinais.map((produto) => produto.skuFinal) } },
            select: { id: true, sku: true },
          })
        ).map((produto) => [produto.sku, produto]),
      );
      const naoEncontrados: string[] = [];
      let vinculados = 0;

      for (const produtoFinal of produtosFinais) {
        const produto = produtosPorSku.get(produtoFinal.skuFinal);

        if (!produto) {
          naoEncontrados.push(produtoFinal.skuFinal);
          continue;
        }

        await prisma.produtoOlist.update({
          where: { id: produtoFinal.id },
          data: { produtoId: produto.id },
        });
        vinculados += 1;
      }

      return NextResponse.json({ vinculados, naoEncontrados });
    }

    if (body.action === "excluir-produto-final") {
      const idsRecebidos = Array.isArray(payload.ids)
        ? payload.ids
        : payload.id
          ? [payload.id]
          : [];
      const ids = Array.from(
        new Set(
          idsRecebidos.filter(
            (id): id is string => typeof id === "string" && Boolean(id.trim()),
          ),
        ),
      );

      if (ids.length === 0) {
        throw new Error("Selecione ao menos um produto final para excluir.");
      }

      const resultado = await prisma.produtoOlist.deleteMany({
        where: { id: { in: ids } },
      });

      return NextResponse.json({ ok: true, excluidos: resultado.count });
    }

    if (body.action === "gerar-mockup-produto") {
      const produtoId = requiredString(payload.produtoId, "produtoId");
      const mockupIndex = Number(payload.mockupIndex);
      const mode = normalizeMockupMode(payload.mode);
      const quality = normalizeMockupQuality(payload.quality);
      const mockupUrlOverride = optionalString(payload.mockupUrlOverride);
      const estampaUrlOverride = optionalString(payload.estampaUrlOverride);
      const promptOverride = optionalString(payload.promptOverride);
      const forceRegenerate = payload.forceRegenerate === true;
      const {
        produto,
        tamanhoTitulo,
        descricaoVariante,
        mockupUrl: defaultMockupUrl,
        estampaUrl: defaultEstampaUrl,
        outputPath,
      } = await buildProdutoMockupStorageInfo(produtoId, mockupIndex);
      const mockupUrl = mockupUrlOverride ?? defaultMockupUrl;
      const estampaUrl = estampaUrlOverride ?? defaultEstampaUrl;
      const existingMockup = await findExistingMockup(outputPath);

      if (existingMockup && !forceRegenerate && !estampaUrlOverride) {
        return NextResponse.json({
          imagem: {
            dataUrl: existingMockup.publicUrl,
            base64: "",
            mimeType: "image/jpeg",
            mockupUrl,
            estampaUrl,
            uploadedUrl: existingMockup.publicUrl,
            uploadedPath: existingMockup.path,
            prompt: "",
            mode,
            quality,
            fromStorage: true,
          },
        });
      }

      const prompt =
        promptOverride ??
        buildProdutoMockupPrompt({
          nomeProduto: produto.tituloFinal,
          sku: produto.skuFinal,
          tamanho: tamanhoTitulo,
          descricaoEstampa: produto.estampa.descricao ?? "",
          descricaoVariante,
          detalhesPromptIa: produto.tipoProduto.detalhesPromptIa ?? "",
        });
      const imagem = await gerarImagemMockupComEstampa({
        mockupUrl,
        estampaUrl,
        prompt,
        model: quality === "low" ? PREVIEW_IMAGE_MODEL : undefined,
        size: "1024x1024",
        quality,
        outputFormat: "jpeg",
      });

      return NextResponse.json({
        imagem: {
          dataUrl: `data:${imagem.mimeType};base64,${imagem.base64}`,
          base64: imagem.base64,
          mimeType: imagem.mimeType,
          mockupUrl,
          estampaUrl,
          mode,
          quality,
          fromStorage: false,
          replacingExisting: Boolean(existingMockup),
          prompt,
        },
      });
    }

    if (body.action === "upload-mockup-produto") {
      const produtoId = requiredString(payload.produtoId, "produtoId");
      const mockupIndex = Number(payload.mockupIndex);
      const base64 = requiredString(payload.base64, "base64");
      const mimeType = requiredString(payload.mimeType, "mimeType");

      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        throw new Error("Formato de imagem invalido para upload.");
      }

      const { outputPath } = await buildProdutoMockupStorageInfo(produtoId, mockupIndex);
      await deleteGoogleStorageObject(outputPath);

      const uploadedImage = await uploadToGoogleStorage({
        path: outputPath,
        buffer: Buffer.from(base64, "base64"),
        contentType: mimeType,
      });

      return NextResponse.json({
        upload: {
          uploadedUrl: uploadedImage.publicUrl,
          uploadedPath: uploadedImage.path,
        },
      });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    const errorDetails =
      error instanceof Error &&
      "details" in error &&
      error.details &&
      typeof error.details === "object"
        ? (error.details as { url?: unknown; role?: unknown })
        : null;
    const failedUrl = typeof errorDetails?.url === "string" ? errorDetails.url : null;
    const failedRole = typeof errorDetails?.role === "string" ? errorDetails.role : null;
    const errorMessage = error instanceof Error ? error.message : "Erro ao processar requisicao.";

    return NextResponse.json(
      {
        error: [errorMessage, failedUrl ? `URL: ${failedUrl}` : null, failedRole ? `Tipo: ${failedRole}` : null]
          .filter(Boolean)
          .join(" "),
      },
      { status: 400 },
    );
  }
}
