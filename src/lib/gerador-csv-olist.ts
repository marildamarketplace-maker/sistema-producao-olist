export type TipoProdutoOlist = {
  id: string;
  titulo: string;
  sku: string;
  descricaoSeo: string | null;
  palavrasChave: string | null;
  detalhesPromptIa: string | null;
  slug: string | null;
  categoria: string | null;
  precoCusto: number | null;
  preco: number | null;
  pesoLiquido: number | null;
  pesoBruto: number | null;
  larguraEmbalagem: number | null;
  alturaEmbalagem: number | null;
  comprimentoEmbalagem: number | null;
  nome: string;
  prefixoSku: string;
  descricao: string | null;
  precoBase: number | null;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  ativo: boolean;
  createdAt: string;
};

export type EstampaOlist = {
  id: string;
  nome: string;
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  extra: string | null;
  imagemUrl: string | null;
  ativo: boolean;
  createdAt: string;
};

export type VarianteOlist = {
  id: string;
  estampaId: string | null;
  estampa: Pick<EstampaOlist, "id" | "nome" | "codigo"> | null;
  tamanhoId: string | null;
  tamanho: Pick<TamanhoOlist, "id" | "titulo" | "sku" | "slug"> | null;
  nome: string;
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  atributo: string;
  valor: string;
  ativo: boolean;
  createdAt: string;
};

export type TamanhoOlist = {
  id: string;
  titulo: string;
  sku: string;
  slug: string | null;
  precoCusto: number | null;
  preco: number | null;
  pesoLiquido: number | null;
  pesoBruto: number | null;
  larguraEmbalagem: number | null;
  alturaEmbalagem: number | null;
  comprimentoEmbalagem: number | null;
  ativo: boolean;
  createdAt: string;
};

export type ProdutoFinalOlist = {
  id: string;
  produtoId: string | null;
  sku: string;
  skuFinal: string;
  titulo: string;
  tituloFinal: string;
  descricao: string | null;
  descricaoFinal: string | null;
  descricaoSeoFinal: string | null;
  palavrasChaveFinal: string | null;
  slugFinal: string | null;
  categoria: string | null;
  precoCusto: number | null;
  preco: number | null;
  pesoLiquido: number | null;
  pesoBruto: number | null;
  larguraEmbalagem: number | null;
  alturaEmbalagem: number | null;
  comprimentoEmbalagem: number | null;
  quantidade: number;
  status: string;
  createdAt: string;
  produto: {
    id: string;
    sku: string;
    idCadastroOlist: string | null;
  } | null;
  tipoProduto: Pick<
    TipoProdutoOlist,
    | "id"
    | "nome"
    | "titulo"
    | "prefixoSku"
    | "sku"
    | "descricao"
    | "descricaoSeo"
    | "palavrasChave"
    | "detalhesPromptIa"
    | "slug"
    | "categoria"
    | "precoCusto"
    | "preco"
    | "pesoLiquido"
    | "pesoBruto"
    | "larguraEmbalagem"
    | "alturaEmbalagem"
    | "comprimentoEmbalagem"
  >;
  estampa: Pick<EstampaOlist, "id" | "nome" | "codigo" | "descricao" | "palavrasChave" | "extra"> | null;
  variante: Pick<
    VarianteOlist,
    "id" | "nome" | "codigo" | "descricao" | "palavrasChave" | "atributo" | "valor"
  > | null;
  tamanho: Pick<
    TamanhoOlist,
    | "id"
    | "titulo"
    | "sku"
    | "slug"
    | "precoCusto"
    | "preco"
    | "pesoLiquido"
    | "pesoBruto"
    | "larguraEmbalagem"
    | "alturaEmbalagem"
    | "comprimentoEmbalagem"
  > | null;
};

export type GeradorCsvOlistData = {
  tiposProduto: TipoProdutoOlist[];
  estampas: EstampaOlist[];
  variantes: VarianteOlist[];
  tamanhos: TamanhoOlist[];
  produtosFinais: ProdutoFinalOlist[];
};

type ApiResponse<T> = T | { error: string };

async function requestGeradorCsv<T extends object>(init?: RequestInit) {
  const response = await fetch("/api/gerador-csv-olist", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json()) as ApiResponse<T>;

  if (!response.ok) {
    throw new Error("error" in data ? data.error : "Erro desconhecido.");
  }

  return data as T;
}

export function carregarGeradorCsvOlist() {
  return requestGeradorCsv<GeradorCsvOlistData>();
}

export function salvarTipoProdutoOlist(payload: {
  id?: string | null;
  titulo: string;
  sku: string;
  descricao?: string | null;
  descricaoSeo?: string | null;
  palavrasChave?: string | null;
  detalhesPromptIa?: string | null;
  slug?: string | null;
  categoria?: string | null;
  precoCusto?: number | null;
  preco?: number | null;
  pesoLiquido?: number | null;
  pesoBruto?: number | null;
  larguraEmbalagem?: number | null;
  alturaEmbalagem?: number | null;
  comprimentoEmbalagem?: number | null;
}) {
  return requestGeradorCsv<{ tipoProduto: TipoProdutoOlist }>({
    method: "POST",
    body: JSON.stringify({ action: "salvar-tipo-produto", payload }),
  });
}

export function excluirTipoProdutoOlist(id: string) {
  return requestGeradorCsv<{ ok: true }>({
    method: "POST",
    body: JSON.stringify({ action: "excluir-tipo-produto", payload: { id } }),
  });
}

export function salvarEstampaOlist(payload: {
  id?: string | null;
  codigo: string;
  descricao?: string | null;
  palavrasChave?: string | null;
  extra?: string | null;
}) {
  return requestGeradorCsv<{ estampa: EstampaOlist }>({
    method: "POST",
    body: JSON.stringify({ action: "salvar-estampa", payload }),
  });
}

export function excluirEstampaOlist(id: string) {
  return requestGeradorCsv<{ ok: true }>({
    method: "POST",
    body: JSON.stringify({ action: "excluir-estampa", payload: { id } }),
  });
}

export function salvarVarianteOlist(payload: {
  id?: string | null;
  estampaId: string;
  tamanhoId: string;
  codigo: string;
  descricao?: string | null;
  palavrasChave?: string | null;
}) {
  return requestGeradorCsv<{ variante: VarianteOlist }>({
    method: "POST",
    body: JSON.stringify({ action: "salvar-variante", payload }),
  });
}

export function excluirVarianteOlist(id: string) {
  return requestGeradorCsv<{ ok: true }>({
    method: "POST",
    body: JSON.stringify({ action: "excluir-variante", payload: { id } }),
  });
}

export function salvarTamanhoOlist(payload: {
  id?: string | null;
  titulo: string;
  sku: string;
  slug?: string | null;
  precoCusto?: number | null;
  preco?: number | null;
  pesoLiquido?: number | null;
  pesoBruto?: number | null;
  larguraEmbalagem?: number | null;
  alturaEmbalagem?: number | null;
  comprimentoEmbalagem?: number | null;
}) {
  return requestGeradorCsv<{ tamanho: TamanhoOlist }>({
    method: "POST",
    body: JSON.stringify({ action: "salvar-tamanho", payload }),
  });
}

export function excluirTamanhoOlist(id: string) {
  return requestGeradorCsv<{ ok: true }>({
    method: "POST",
    body: JSON.stringify({ action: "excluir-tamanho", payload: { id } }),
  });
}

export function gerarProdutoFinalOlist(payload: {
  tipoProdutoId: string;
  estampaId?: string | null;
  varianteId?: string | null;
  tamanhoId?: string | null;
  titulo?: string | null;
  descricao?: string | null;
  preco?: number | null;
  quantidade?: number;
}) {
  return requestGeradorCsv<{ produtoFinal: ProdutoFinalOlist }>({
    method: "POST",
    body: JSON.stringify({ action: "gerar-produto-final", payload }),
  });
}

export function salvarProdutoFinalOlist(payload: {
  id: string;
  skuFinal: string;
  tituloFinal: string;
  categoria?: string | null;
  precoCusto?: number | null;
  preco?: number | null;
}) {
  return requestGeradorCsv<{ produtoFinal: ProdutoFinalOlist }>({
    method: "POST",
    body: JSON.stringify({ action: "salvar-produto-final", payload }),
  });
}

export function excluirProdutoFinalOlist(id: string) {
  return requestGeradorCsv<{ ok: true }>({
    method: "POST",
    body: JSON.stringify({ action: "excluir-produto-final", payload: { id } }),
  });
}

export function vincularProdutosFinaisOlist(ids: string[]) {
  return requestGeradorCsv<{
    vinculados: number;
    naoEncontrados: string[];
  }>({
    method: "POST",
    body: JSON.stringify({ action: "vincular-produtos-finais", payload: { ids } }),
  });
}

export function gerarMockupProdutoOlist(payload: {
  produtoId: string;
  mockupIndex: number;
  mode?: "preview" | "final";
  quality?: "low" | "medium" | "high";
  mockupUrlOverride?: string | null;
  forceRegenerate?: boolean;
}) {
  return requestGeradorCsv<{
    imagem: {
      dataUrl: string;
      base64: string;
      mimeType: string;
      mockupUrl: string;
      estampaUrl: string;
      uploadedUrl?: string;
      uploadedPath?: string;
      mode: "preview" | "final";
      quality: "low" | "medium" | "high";
      fromStorage: boolean;
      replacingExisting?: boolean;
      prompt: string;
    };
  }>({
    method: "POST",
    body: JSON.stringify({ action: "gerar-mockup-produto", payload }),
  });
}

export function uploadMockupProdutoOlist(payload: {
  produtoId: string;
  mockupIndex: number;
  base64: string;
  mimeType: string;
}) {
  return requestGeradorCsv<{
    upload: {
      uploadedUrl: string;
      uploadedPath: string;
    };
  }>({
    method: "POST",
    body: JSON.stringify({ action: "upload-mockup-produto", payload }),
  });
}

function csvValue(value: string | number | null | undefined) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function decimalPtBr(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  return String(value).replace(".", ",");
}

function joinClean(parts: Array<string | null | undefined>, separator = " ") {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(separator)
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/\s+-\s*$/g, "")
    .trim();
}

function normalizeComparableText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:cm|mm|m)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function joinCleanUnique(parts: Array<string | null | undefined>, separator = " ") {
  return parts.reduce<string[]>((acc, part) => {
    const value = part?.trim();
    if (!value) return acc;

    const normalizedValue = normalizeComparableText(value);
    const alreadyIncluded = acc.some((existing) => {
      const normalizedExisting = normalizeComparableText(existing);
      return normalizedExisting.includes(normalizedValue) || normalizedValue.includes(normalizedExisting);
    });

    return alreadyIncluded ? acc : [...acc, value];
  }, []).join(separator);
}

function slugCsv(parts: Array<string | null | undefined>) {
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

function cleanCodePart(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function truncate(value: string | null | undefined, length: number) {
  return value ? value.slice(0, length) : "";
}

function renderTemplateCsv(
  template: string | null | undefined,
  variables: Record<string, string | null | undefined>,
) {
  return joinClean([
    (template ?? "").replace(/\$\{([A-Z_]+)\}/g, (_, key: string) => variables[key] ?? ""),
  ]);
}

function hasTemplateVariable(value: string | null | undefined) {
  return Boolean(value?.match(/\$\{[A-Z_]+\}/));
}

function buildParentDescricaoCsv(produto: ProdutoFinalOlist, variables: Record<string, string | null | undefined>) {
  if (hasTemplateVariable(produto.tipoProduto.titulo)) {
    return renderTemplateCsv(produto.tipoProduto.titulo.replace(/\s*-\s*\$\{VARIANTE\}/g, " ${VARIANTE}"), {
      ...variables,
      ESTAMPA: produto.estampa?.codigo,
      VARIANTE: undefined,
    });
  }

  return joinCleanUnique([
    produto.tipoProduto.titulo,
    produto.tamanho?.titulo,
    produto.estampa?.codigo,
  ]);
}

function produtoCsvVariables(produto: ProdutoFinalOlist) {
  return {
    TAMANHO: produto.tamanho?.titulo,
    ESTAMPA: produto.estampa?.codigo,
    VARIANTE: produto.variante?.codigo,
    EXTRA: produto.estampa?.extra,
    PALAVRAS_CHAVE_ESTAMPA: produto.estampa?.palavrasChave,
    PALAVRAS_CHAVE_PRODUTO: produto.tipoProduto.palavrasChave,
    PALAVRAS_CHAVE_VARIANTE: produto.variante?.palavrasChave,
    DESCRICAO_ESTAMPA: produto.estampa?.descricao,
    DESCRICAO_VARIANTE: produto.variante?.descricao,
  };
}

type ProdutoOlistCsvOptions = {
  cacheKey?: number;
};

function withCacheBust(url: string, cacheKey?: number) {
  if (!url || !cacheKey) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${cacheKey}`;
}

function storageAiImageUrl(produto: ProdutoFinalOlist, index: number, options?: ProdutoOlistCsvOptions) {
  const tipoSku = cleanCodePart(produto.tipoProduto.sku);
  const estampa = cleanCodePart(produto.estampa?.codigo);
  const variante = cleanCodePart(produto.variante?.codigo);

  if (!tipoSku || !estampa || !variante) return "";

  return withCacheBust(
    `https://storage.googleapis.com/forro-de-mesa-retangular/${tipoSku}/${estampa}/${estampa}-${variante}-${index}.jpg`,
    options?.cacheKey,
  );
}

function storageVideoUrl(produto: ProdutoFinalOlist) {
  const tipoSku = produto.tipoProduto.sku;
  const estampa = produto.estampa?.codigo ?? "";

  return `https://storage.googleapis.com/forro-de-mesa-retangular/${tipoSku}/${estampa}/video.mp4`;
}

export const PRODUTOS_OLIST_CSV_HEADERS = [
    "ID",
    "Código (SKU)",
    "Descrição",
    "Unidade",
    "Classificação fiscal",
    "Origem",
    "Preço",
    "Valor IPI fixo",
    "Observações",
    "Situação",
    "Estoque",
    "Preço de custo",
    "Cód do Fornecedor",
    "Fornecedor",
    "Localização",
    "Estoque máximo",
    "Estoque mínimo",
    "Peso líquido (Kg)",
    "Peso bruto (Kg)",
    "GTIN/EAN",
    "GTIN/EAN tributável",
    "Descrição complementar",
    "CEST",
    "Código de Enquadramento IPI",
    "Formato embalagem",
    "Largura embalagem",
    "Altura embalagem",
    "Comprimento embalagem",
    "Diâmetro embalagem",
    "Tipo do produto",
    "URL imagem 1",
    "URL imagem 2",
    "URL imagem 3",
    "URL imagem 4",
    "URL imagem 5",
    "URL imagem 6",
    "Categoria",
    "Código do pai",
    "Variações",
    "Marca",
    "Garantia",
    "Sob encomenda",
    "Preço promocional",
    "URL imagem externa 1",
    "URL imagem externa 2",
    "URL imagem externa 3",
    "URL imagem externa 4",
    "URL imagem externa 5",
    "URL imagem externa 6",
    "Link do vídeo",
    "Título SEO",
    "Descrição SEO",
    "Palavras chave SEO",
    "Slug",
    "Dias para preparação",
    "Controlar lotes",
    "Unidade por caixa",
    "URL imagem externa 7",
    "URL imagem externa 8",
    "URL imagem externa 9",
    "URL imagem externa 10",
    "Markup",
    "Permitir inclusão nas vendas",
    "EX TIPI",
];

export function montarLinhaCsvProdutoOlist(
  produto: ProdutoFinalOlist,
  isParent = false,
  options?: ProdutoOlistCsvOptions,
) {
    const variables = produtoCsvVariables(produto);
    const parentSku = joinClean(
      [produto.tipoProduto.sku, produto.tamanho?.sku, produto.estampa?.codigo],
      "-",
    ).toUpperCase();
    const temVariacao = Boolean(produto.variante || produto.tamanho);
    const codigoPai = !isParent && temVariacao ? parentSku : "";
    const variacoes = !isParent && produto.variante ? `Cor:${produto.variante.codigo}` : "";
    const descricaoBase = isParent
      ? buildParentDescricaoCsv(produto, variables)
      : produto.tituloFinal || joinClean([
          produto.tipoProduto.titulo,
          produto.tamanho?.titulo,
          produto.estampa?.codigo,
          produto.variante?.codigo,
        ]);
    const descricao = hasTemplateVariable(descricaoBase)
      ? renderTemplateCsv(descricaoBase, variables)
      : descricaoBase;
    const descricaoComplementarBase = isParent
      ? joinCleanUnique([
          produto.tipoProduto.descricao,
          produto.tamanho?.titulo,
          produto.estampa?.descricao,
        ])
      : produto.descricaoFinal || joinClean([
          produto.tipoProduto.descricao,
          produto.tamanho?.titulo,
          produto.estampa?.descricao,
          produto.variante?.descricao,
        ]);
    const descricaoComplementar = hasTemplateVariable(descricaoComplementarBase)
      ? renderTemplateCsv(descricaoComplementarBase, variables)
      : descricaoComplementarBase;
    const tituloSeo = descricao;
    const descricaoSeoBase = produto.descricaoSeoFinal || joinClean([
      truncate(produto.tipoProduto.descricao, 150),
      truncate(produto.estampa?.descricao, 100),
    ]);
    const descricaoSeo = hasTemplateVariable(descricaoSeoBase)
      ? renderTemplateCsv(descricaoSeoBase, variables)
      : descricaoSeoBase;
    const palavrasSeoBase = isParent
      ? joinClean([
          produto.tipoProduto.palavrasChave,
          produto.estampa?.palavrasChave,
        ], ", ")
      : produto.palavrasChaveFinal || joinClean([
          produto.tipoProduto.palavrasChave,
          produto.estampa?.palavrasChave,
        ], ", ");
    const palavrasSeo = hasTemplateVariable(palavrasSeoBase)
      ? renderTemplateCsv(palavrasSeoBase, variables)
      : palavrasSeoBase;
    const slugBase = isParent
      ? slugCsv([
          produto.tipoProduto.titulo,
          produto.tamanho?.slug ?? produto.tamanho?.titulo,
          produto.estampa?.codigo,
        ])
      : produto.slugFinal || slugCsv([
          produto.tipoProduto.titulo,
          produto.tamanho?.slug ?? produto.tamanho?.titulo,
          produto.estampa?.codigo,
          produto.variante?.codigo,
        ]);
    const slug = slugCsv([
      hasTemplateVariable(slugBase) ? renderTemplateCsv(slugBase, variables) : slugBase,
    ]);

    return [
      "",
      isParent ? parentSku : produto.skuFinal,
      descricao,
      "un",
      "5407.52.10",
      "1 - Estrangeira - Importação direta, exceto a indicada no código 6",
      decimalPtBr(produto.preco ?? produto.tipoProduto.preco),
      0,
      "",
      "Ativo",
      1000,
      decimalPtBr(produto.precoCusto ?? produto.tipoProduto.precoCusto),
      "",
      "",
      "",
      0,
      0,
      decimalPtBr(produto.pesoLiquido ?? produto.tipoProduto.pesoLiquido),
      decimalPtBr(produto.pesoBruto ?? produto.tipoProduto.pesoBruto),
      "",
      "",
      descricaoComplementar,
      "",
      "",
      "Pacote / Caixa",
      produto.larguraEmbalagem ?? produto.tipoProduto.larguraEmbalagem ?? "",
      produto.alturaEmbalagem ?? produto.tipoProduto.alturaEmbalagem ?? "",
      produto.comprimentoEmbalagem ?? produto.tipoProduto.comprimentoEmbalagem ?? "",
      0,
      isParent || !temVariacao ? "V" : "K",
      storageAiImageUrl(produto, 0, options),
      storageAiImageUrl(produto, 1, options),
      storageAiImageUrl(produto, 2, options),
      storageAiImageUrl(produto, 3, options),
      storageAiImageUrl(produto, 4, options),
      "",
      produto.tipoProduto.categoria ?? produto.categoria ?? "",
      codigoPai,
      variacoes,
      "MeuryShop",
      "",
      "Não",
      0,
      "",
      "",
      "",
      "",
      "",
      "",
      storageVideoUrl(produto),
      tituloSeo,
      descricaoSeo,
      palavrasSeo,
      slug,
      2,
      "Não",
      "",
      "",
      "",
      "",
      "",
      0,
      "",
      "",
    ];
}

export function montarCamposCsvProdutoOlist(
  produto: ProdutoFinalOlist,
  isParent = false,
  options?: ProdutoOlistCsvOptions,
) {
  const row = montarLinhaCsvProdutoOlist(produto, isParent, options);
  return PRODUTOS_OLIST_CSV_HEADERS.map((header, index) => ({
    campo: header,
    valor: row[index] ?? "",
  }));
}

export function montarCsvProdutosOlist(produtos: ProdutoFinalOlist[], options?: ProdutoOlistCsvOptions) {
  const headers = PRODUTOS_OLIST_CSV_HEADERS;

  const rows: Array<Array<string | number | null | undefined>> = [];
  const parentRows = new Set<string>();

  for (const produto of produtos) {
    if (produto.variante || produto.tamanho) {
      const parentSku = joinClean(
        [produto.tipoProduto.sku, produto.tamanho?.sku, produto.estampa?.codigo],
        "-",
      ).toUpperCase();

      if (!parentRows.has(parentSku)) {
        rows.push(montarLinhaCsvProdutoOlist(produto, true, options));
        parentRows.add(parentSku);
      }
    }

    rows.push(montarLinhaCsvProdutoOlist(produto, false, options));
  }

  return [headers, ...rows]
    .map((row) => row.map((value) => csvValue(value)).join(","))
    .join("\r\n");
}

export function montarCsvProdutosFabricadosOlist(
  produtos: ProdutoFinalOlist[],
  input: {
    componenteId: string;
    quantidade: string | number;
  },
) {
  const headers = [
    "ID kit/fabricado",
    "SKU kit/fabricado",
    "Descrição kit/fabricado",
    "ID componente",
    "SKU componente",
    "Descrição componente",
    "Quantidade componente",
  ];
  const rows = produtos.map((produto) => [
    produto.produto?.idCadastroOlist ?? "",
    produto.skuFinal,
    "",
    input.componenteId,
    "",
    "",
    input.quantidade,
  ]);

  return [headers, ...rows]
    .map((row) => row.map((value) => csvValue(value)).join(","))
    .join("\r\n");
}
