import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getGoogleStorageObjectInfo,
  GoogleStorageServiceError,
  uploadToGoogleStorage,
} from "@/services/googleStorageService";
import { gerarImagemMockupComEstampa } from "@/services/openaiImageService";

const PREVIEW_IMAGE_MODEL = "gpt-image-1-mini";

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

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanCodePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
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
      part
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
    EXTRA: estampa.extra,
    PALAVRAS_CHAVE_ESTAMPA: estampa.palavrasChave,
    PALAVRAS_CHAVE_PRODUTO: tipoProduto.palavrasChave,
    PALAVRAS_CHAVE_VARIANTE: variante?.palavrasChave,
    DESCRICAO_ESTAMPA: estampa.descricao,
    DESCRICAO_VARIANTE: variante?.descricao,
  };
}

function buildProdutoMockupPrompt(input: {
  nomeProduto: string;
  sku: string;
  tamanho: string;
  descricaoEstampa: string;
  descricaoVariante: string;
  detalhesPromptIa: string;
}) {
  return `Use a primeira imagem como mockup principal do produto.

Use a segunda imagem como referencia obrigatoria da estampa/arte.

Prioridade maxima: a estampa da segunda imagem deve ser preservada como arte original. Nao redesenhe, nao resuma, nao interprete e nao substitua a arte. Trate a segunda imagem como fonte visual literal que deve ser transferida para o produto.

Se a estampa possuir texto, letras, numeros, logotipos, frases, simbolos ou assinatura visual:
- manter exatamente o mesmo texto
- manter todas as palavras legiveis
- manter grafia, acentos, pontuacao e ordem dos caracteres
- manter tipografia aparente
- manter logotipos e simbolos sem alteracao
- nao inventar letras
- nao trocar palavras
- nao borrar texto
- nao omitir textos pequenos quando estiverem visiveis na arte original
- nao substituir texto por pseudo-texto

Aplique a estampa da segunda imagem no produto do mockup mantendo:

- mesmo enquadramento base
- mesma perspectiva principal
- mesma proposta visual
- mesma estrutura do mockup
- mesmo formato do produto
- mesma proporcao visual
- mesmo estilo comercial marketplace

O mockup deve continuar altamente fiel ao original, porem e PERMITIDO realizar pequenas variacoes naturais para evitar imagens excessivamente identicas entre geracoes.

Variacoes permitidas:
- leves ajustes de iluminacao
- pequenas variacoes de sombra
- pequenas mudancas de textura do ambiente
- variacoes suaves de fundo mantendo o mesmo estilo
- pequenas mudancas de tons neutros do ambiente
- pequenas variacoes de pose/persona (quando houver modelo)
- pequenas variacoes de acessorios neutros
- pequenas variacoes de profundidade de campo
- pequenas variacoes de composicao secundaria

As variacoes devem:
- manter identidade visual consistente
- manter aspecto profissional
- manter padrao marketplace
- parecer fotos reais diferentes do mesmo produto
- evitar aparencia de imagem duplicada

NUNCA alterar:
- geometria do produto
- modelagem do produto
- proporcao do produto
- posicionamento principal
- identidade da estampa
- cores originais da arte
- textos, letras, palavras, numeros, logotipos ou simbolos da arte
- estilo principal do mockup

Ajuste obrigatoriamente a proporcao e escala da arte conforme o tamanho real informado do produto, respeitando:
- area util de impressao
- caimento natural do tecido
- proporcao correta da estampa
- densidade visual adequada
- tamanho real do produto
- posicionamento proporcional da arte

A estampa NAO deve:
- ficar esticada
- comprimida
- distorcida
- desproporcional
- ampliar ou reduzir elementos aleatoriamente

Utilize o tamanho informado para manter a relacao correta entre:
- dimensao do produto
- escala da estampa
- repeticao da arte
- ocupacao visual no mockup

Caso a arte seja localizada:
- centralizar proporcionalmente
- respeitar margens naturais do produto
- manter alinhamento realista

Caso a arte seja padrao/pattern:
- repetir mantendo escala coerente com o tamanho informado
- evitar elementos exageradamente grandes ou pequenos

Regras obrigatorias:
- manter aparencia realista
- resultado profissional para marketplace
- alta fidelidade a estampa enviada
- reproduzir a arte original com maxima fidelidade visual
- preservar textos e elementos graficos da estampa exatamente como enviados
- qualidade fotografica
- textura natural do tecido
- sombras coerentes
- perspectiva realista

Produto:
${input.nomeProduto}

SKU:
${input.sku}

Tamanho:
${input.tamanho}

Descricao da estampa:
${input.descricaoEstampa}

Descricao da variante:
${input.descricaoVariante}

Detalhes especificos do tipo de produto:
${input.detalhesPromptIa}`;
}

function normalizeMockupMode(value: unknown) {
  return value === "final" ? "final" : "preview";
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
      estampa: { select: { codigo: true, descricao: true } },
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
    mockupUrl: `https://storage.googleapis.com/forro-de-mesa-retangular/${tipoSku}/${tamanhoSku}/mockup-${mockupIndex}.jpg`,
    estampaUrl: `https://storage.googleapis.com/forro-de-mesa-retangular/${tipoSku}/${estampaCodigo}/${estampaCodigo}-${varianteCodigo}-0.jpg`,
    outputPath: `${tipoSku}/${estampaCodigo}/ia/${estampaCodigo}-${varianteCodigo}-${mockupIndex - 1}.jpg`,
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
  };
}

function normalizeEstampa(estampa: {
  id: string;
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  extra: string | null;
  createdAt: Date;
}) {
  return {
    id: estampa.id,
    nome: estampa.descricao ?? estampa.codigo,
    codigo: estampa.codigo,
    descricao: estampa.descricao,
    palavrasChave: estampa.palavrasChave,
    extra: estampa.extra,
    imagemUrl: null,
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
  createdAt: Date;
}) {
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
    ativo: true,
    createdAt: tamanho.createdAt.toISOString(),
  };
}

function normalizeProdutoOlist(produto: {
  id: string;
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
  tipoProduto: {
    id: string;
    titulo: string;
    sku: string;
    descricao: string | null;
    descricaoSeo: string | null;
    palavrasChave: string | null;
    detalhesPromptIa: string | null;
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
  estampa: { id: string; codigo: string; descricao: string | null; palavrasChave: string | null; extra: string | null };
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

async function carregarDados() {
  const [tiposProduto, estampas, variantes, tamanhos, produtosFinais] = await Promise.all([
    prisma.tipoProduto.findMany({
      orderBy: { titulo: "asc" },
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
      orderBy: { titulo: "asc" },
    }),
    prisma.produtoOlist.findMany({
      include: {
        tipoProduto: {
          select: {
            id: true,
            titulo: true,
            sku: true,
            descricao: true,
            descricaoSeo: true,
            palavrasChave: true,
            detalhesPromptIa: true,
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
          select: { id: true, codigo: true, descricao: true, palavrasChave: true, extra: true },
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
  ]);

  return {
    tiposProduto: tiposProduto.map(normalizeTipoProduto),
    estampas: estampas.map(normalizeEstampa),
    variantes: variantes.map(normalizeVariante),
    tamanhos: tamanhos.map(normalizeTamanho),
    produtosFinais: produtosFinais.map(normalizeProdutoOlist),
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
    const body = (await request.json()) as { action?: string; payload?: Record<string, unknown> };
    const payload = body.payload ?? {};

    if (body.action === "salvar-tipo-produto") {
      const titulo = requiredString(payload.nome ?? payload.titulo, "titulo");
      const sku = requiredString(payload.prefixoSku ?? payload.sku, "sku").toUpperCase();
      const data = {
        titulo,
        sku,
        descricao: optionalString(payload.descricao),
        descricaoSeo: optionalString(payload.descricaoSeo),
        palavrasChave: optionalString(payload.palavrasChave),
        detalhesPromptIa: optionalString(payload.detalhesPromptIa),
        slug: buildSlugFinal([optionalString(payload.slug) ?? titulo]),
        categoria: optionalString(payload.categoria),
        precoCusto: optionalNumber(payload.precoCusto, "precoCusto"),
        preco: optionalNumber(payload.preco ?? payload.precoBase, "preco"),
        pesoLiquido: optionalNumber(payload.pesoLiquido, "pesoLiquido"),
        pesoBruto: optionalNumber(payload.pesoBruto ?? payload.pesoGramas, "pesoBruto"),
        larguraEmbalagem: optionalNumber(payload.larguraEmbalagem ?? payload.larguraCm, "larguraEmbalagem"),
        alturaEmbalagem: optionalNumber(payload.alturaEmbalagem ?? payload.alturaCm, "alturaEmbalagem"),
        comprimentoEmbalagem: optionalNumber(
          payload.comprimentoEmbalagem ?? payload.comprimentoCm,
          "comprimentoEmbalagem",
        ),
      };

      const tipoProduto =
        typeof payload.id === "string" && payload.id
          ? await prisma.tipoProduto.update({ where: { id: payload.id }, data })
          : await prisma.tipoProduto.create({ data });

      return NextResponse.json({ tipoProduto: normalizeTipoProduto(tipoProduto) });
    }

    if (body.action === "excluir-tipo-produto") {
      const id = requiredString(payload.id, "id");
      await prisma.tipoProduto.delete({ where: { id } });

      return NextResponse.json({ ok: true });
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
      const data = {
        titulo,
        sku: requiredString(payload.sku, "sku").toUpperCase(),
        slug: buildSlugFinal([optionalString(payload.slug) ?? titulo]),
        precoCusto: optionalNumber(payload.precoCusto, "precoCusto"),
        preco: optionalNumber(payload.preco, "preco"),
        pesoLiquido: optionalNumber(payload.pesoLiquido, "pesoLiquido"),
        pesoBruto: optionalNumber(payload.pesoBruto, "pesoBruto"),
        larguraEmbalagem: optionalNumber(payload.larguraEmbalagem, "larguraEmbalagem"),
        alturaEmbalagem: optionalNumber(payload.alturaEmbalagem, "alturaEmbalagem"),
        comprimentoEmbalagem: optionalNumber(payload.comprimentoEmbalagem, "comprimentoEmbalagem"),
      };

      const tamanho =
        typeof payload.id === "string" && payload.id
          ? await prisma.tamanho.update({ where: { id: payload.id }, data })
          : await prisma.tamanho.create({ data });

      return NextResponse.json({ tamanho: normalizeTamanho(tamanho) });
    }

    if (body.action === "excluir-tamanho") {
      const id = requiredString(payload.id, "id");
      await prisma.tamanho.delete({ where: { id } });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "gerar-produto-final") {
      const tipoProdutoId = requiredString(payload.tipoProdutoId, "tipoProdutoId");
      const estampaId = requiredString(payload.estampaId, "estampaId");
      const varianteId = optionalString(payload.varianteId);
      const tamanhoId = optionalString(payload.tamanhoId);

      const [tipoProduto, estampa, variante, tamanhoSelecionado] = await Promise.all([
        prisma.tipoProduto.findUniqueOrThrow({ where: { id: tipoProdutoId } }),
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

      if (variante && variante.estampaId !== estampaId) {
        throw new Error("A variante selecionada nao pertence a estampa informada.");
      }
      if (variante && tamanhoId && variante.tamanhoId !== tamanhoId) {
        throw new Error("A variante selecionada nao pertence ao tamanho informado.");
      }

      const skuFinal = [tipoProduto.sku, tamanho?.sku, estampa.codigo, variante?.codigo]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(cleanCodePart)
        .filter(Boolean)
        .join("-")
        .replace(/-+/g, "-");
      const produtoExistente = await prisma.produtoOlist.findUnique({
        where: { skuFinal },
        select: { id: true },
      });

      if (produtoExistente) {
        throw new Error(`Ja existe um produto final com o SKU ${skuFinal}.`);
      }

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
      const descricaoSeoFinal = joinTextParts([
        tipoProduto.descricaoSeo,
        estampa.descricao,
        variante?.descricao,
      ]);
      const palavrasChaveFinal = joinKeywordParts([
        tipoProduto.palavrasChave,
        estampa.palavrasChave,
        variante?.palavrasChave,
      ]);
      const produtoFinal = await prisma.produtoOlist.create({
        data: {
          tipoProdutoId,
          estampaId,
          varianteId,
          tamanhoId,
          skuFinal,
          tituloFinal,
          descricaoFinal: descricaoFinal || null,
          descricaoSeoFinal: descricaoSeoFinal || null,
          palavrasChaveFinal: palavrasChaveFinal || null,
          slugFinal: buildSlugFinal([tipoProduto.slug, tamanho?.slug ?? tamanho?.titulo, estampa.codigo, variante?.codigo]) || null,
          categoria: tipoProduto.categoria,
          precoCusto: tamanho?.precoCusto ?? tipoProduto.precoCusto,
          preco: tamanho?.preco ?? tipoProduto.preco,
          pesoLiquido: tamanho?.pesoLiquido ?? tipoProduto.pesoLiquido,
          pesoBruto: tamanho?.pesoBruto ?? tipoProduto.pesoBruto,
          larguraEmbalagem: tamanho?.larguraEmbalagem ?? tipoProduto.larguraEmbalagem,
          alturaEmbalagem: tamanho?.alturaEmbalagem ?? tipoProduto.alturaEmbalagem,
          comprimentoEmbalagem: tamanho?.comprimentoEmbalagem ?? tipoProduto.comprimentoEmbalagem,
        },
        include: {
          tipoProduto: {
            select: {
              id: true,
              titulo: true,
              sku: true,
              descricao: true,
              descricaoSeo: true,
              palavrasChave: true,
              detalhesPromptIa: true,
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
          estampa: { select: { id: true, codigo: true, descricao: true, palavrasChave: true, extra: true } },
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
          tipoProduto: {
            select: {
              id: true,
              titulo: true,
              sku: true,
              descricao: true,
              descricaoSeo: true,
              palavrasChave: true,
              detalhesPromptIa: true,
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
          estampa: { select: { id: true, codigo: true, descricao: true, palavrasChave: true, extra: true } },
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

    if (body.action === "excluir-produto-final") {
      const id = requiredString(payload.id, "id");
      await prisma.produtoOlist.delete({ where: { id } });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "gerar-mockup-produto") {
      const produtoId = requiredString(payload.produtoId, "produtoId");
      const mockupIndex = Number(payload.mockupIndex);
      const mode = normalizeMockupMode(payload.mode);
      const { produto, tamanhoTitulo, descricaoVariante, mockupUrl, estampaUrl, outputPath } =
        await buildProdutoMockupStorageInfo(produtoId, mockupIndex);
      const existingMockup = await findExistingMockup(outputPath);

      if (existingMockup) {
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
            fromStorage: true,
          },
        });
      }

      const prompt = buildProdutoMockupPrompt({
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
        model: mode === "preview" ? PREVIEW_IMAGE_MODEL : undefined,
        size: "1024x1024",
        quality: mode === "preview" ? "medium" : "high",
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
          fromStorage: false,
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao processar requisicao." },
      { status: 400 },
    );
  }
}
