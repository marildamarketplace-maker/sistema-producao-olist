"use client";

import type { ClipboardEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { buildProdutoMockupPrompt } from "@/lib/mockup-prompt";
import {
  EstampaOlist,
  GeradorCsvOlistData,
  ProdutoFornecedorOlist,
  ProdutoFinalOlist,
  ProdutoKitBaseOlist,
  TamanhoOlist,
  TipoProdutoOlist,
  VarianteOlist,
  carregarGeradorCsvOlist,
  excluirProdutoFinalOlist,
  gerarProdutosFinaisEmLoteOlist,
  gerarMockupProdutoOlist,
  montarCamposCsvProdutoOlist,
  montarCsvProdutosFabricadosOlist,
  montarCsvProdutosOlist,
  salvarProdutoFinalOlist,
  salvarProdutoKitFinalOlist,
  uploadEstampaTemporariaMockupOlist,
  uploadMockupProdutoOlist,
  vincularProdutosFinaisOlist,
} from "@/lib/gerador-csv-olist";

type Aba =
  | "estamparia"
  | "gerar"
  | "gerar-kit"
  | "produtos"
  | "produtos-vk";
type MockupQuality = "low" | "medium" | "high";

const ABAS: { id: Aba; label: string }[] = [
  { id: "estamparia", label: "Estamparia" },
  { id: "gerar", label: "Gerar Produto Final" },
  { id: "gerar-kit", label: "Gerar Produto Kit Final" },
  { id: "produtos-vk", label: "Produtos Criados (V/K)" },
];

const ABA_IDS = new Set<Aba>(ABAS.map((aba) => aba.id));

const MOCKUP_QUALITY_LABELS: Record<MockupQuality, string> = {
  low: "Baixa (mini)",
  medium: "Media (padrao)",
  high: "Alta (padrao)",
};

function withCacheBust(url: string, key?: number) {
  if (!key || url.startsWith("data:")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${key}`;
}

export const tipoInicial = {
  titulo: "",
  sku: "",
  descricao: "",
  descricaoSeo: "",
  palavrasChave: "",
  detalhesPromptIa: "",
  corteLaser: false,
  tecidoCorrido: false,
  slug: "",
  categoria: "",
  produtosFornecidos: [] as Array<{
    produtoFornecedorId: string;
    quantidadeUsada: string;
  }>,
};

export type TipoProdutoCsvImportado = {
  titulo: string; sku: string; corteLaser: boolean; tecidoCorrido: boolean; categoria: string;
  produtoFornecedorId: string; produtoFornecido: string; slug: string; descricao: string;
  descricaoSeo: string; palavrasChave: string; detalhesPromptIa: string;
};

export const estampaInicial = {
  codigo: "",
  descricao: "",
  palavrasChave: "",
  extra: "",
};

export const varianteInicial = {
  estampaId: "",
  tamanhoId: "",
  codigo: "",
  descricao: "",
  palavrasChave: "",
};

export const tamanhoInicial = {
  titulo: "",
  sku: "",
  slug: "",
  quantidadeProdutoFornecedor: "",
};

export type TamanhoCsvImportado = {
  titulo: string;
  sku: string;
  slug: string;
  quantidadeProdutoFornecedor: number;
};

type EstampaImportadaInput = {
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  extra: string | null;
};

export type VarianteImportadaInput = {
  codigo: string;
  estampaCodigo: string;
  tamanhoRef: string;
  descricao: string | null;
  palavrasChave: string | null;
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDecimal(value: number | null, digits: number) {
  if (value === null) return "-";

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatMoney(value: number | null) {
  return value === null ? "-" : currencyFormatter.format(value);
}

function formatNumberForInput(value: number | null, digits: number) {
  if (value === null) return "";
  return value.toFixed(digits).replace(".", ",");
}

function normalizeDecimalText(value: string, digits: number) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  if (!normalized) return "";

  const numberValue = Number(normalized);
  return Number.isNaN(numberValue) ? value : formatNumberForInput(numberValue, digits);
}

function parseDecimalText(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  if (!normalized) return null;

  const numberValue = Number(normalized);
  return Number.isNaN(numberValue) ? null : numberValue;
}

function parseFlexibleDecimalText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const numberValue = Number(normalized);

  return Number.isNaN(numberValue) ? null : numberValue;
}

function normalizeFlexibleDecimalText(value: string, digits: number) {
  const numberValue = parseFlexibleDecimalText(value);
  return numberValue === null ? value : formatNumberForInput(numberValue, digits);
}

function parsePercentText(value: string) {
  const numberValue = parseDecimalText(value);
  return numberValue === null ? null : numberValue / 100;
}

function cleanSkuPart(value: string) {
  return value
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

function removeTemplateVariables(value: string | null | undefined) {
  return (value ?? "").replace(/\$\{[^}]+\}/g, " ").replace(/\s+/g, " ").trim();
}

function buildSlugPart(value: string | null | undefined) {
  return removeTemplateVariables(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function buildSkuFromTitle(titulo: string) {
  return cleanSkuPart(removeTemplateVariables(titulo));
}

function buildSlugFromTitle(titulo: string) {
  return buildSlugPart(titulo);
}

function buildTipoProdutoMarkers(
  tipoProduto: Pick<TipoProdutoOlist, "corteLaser" | "tecidoCorrido">,
) {
  return [
    tipoProduto.corteLaser ? "C/LASER" : null,
    tipoProduto.tecidoCorrido ? "C/CORRIDO" : null,
  ].filter((marker): marker is string => Boolean(marker));
}

function buildProdutoSku(
  tipoProduto: Pick<TipoProdutoOlist, "sku" | "corteLaser" | "tecidoCorrido">,
  estampaCodigo: string,
  varianteCodigo: string | null | undefined,
  tamanhoSku: string | null | undefined,
) {
  const skuTipoProduto = tipoProduto.sku.trim();
  const usaPadraoMeury2 = skuTipoProduto.toUpperCase().startsWith("MEURY2-");

  if (usaPadraoMeury2) {
    return [
      `TP/${cleanSkuPart(skuTipoProduto.replace(/^MEURY2-+/i, ""))}`,
      ...buildTipoProdutoMarkers(tipoProduto),
      tamanhoSku ? `TA/${cleanSkuPart(tamanhoSku)}` : "",
      `EST/${cleanSkuPart(estampaCodigo)}`,
      cleanSkuPart(varianteCodigo ?? ""),
    ]
      .filter(Boolean)
      .join("-")
      .replace(/-+/g, "-");
  }

  return [
    cleanSkuPart(tipoProduto.sku),
    ...buildTipoProdutoMarkers(tipoProduto),
    cleanSkuPart(tamanhoSku ?? ""),
    cleanSkuPart(estampaCodigo),
    cleanSkuPart(varianteCodigo ?? ""),
  ]
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-");
}

function buildSkuFinal(
  tipoProduto: TipoProdutoOlist,
  estampa: EstampaOlist,
  variante: VarianteOlist | null,
  tamanho: TamanhoOlist | null = null,
) {
  return buildProdutoSku(
    tipoProduto,
    estampa.codigo,
    variante?.codigo,
    tamanho?.sku,
  );
}

function hasTemplateVariable(value: string | null | undefined) {
  return Boolean(value?.match(/\$\{[A-Z_]+\}/));
}

function renderTemplate(
  template: string | null | undefined,
  variables: Record<string, string | null | undefined>,
) {
  return (template ?? "")
    .replace(/\$\{([A-Z_]+)\}/g, (_, key: string) => variables[key] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProdutoVariables(
  tipoProduto: TipoProdutoOlist,
  estampa: EstampaOlist,
  variante: VarianteOlist | null,
  tamanho: TamanhoOlist | null = null,
) {
  return {
    TAMANHO: tamanho?.titulo ?? variante?.codigo,
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

function buildTituloFinal(
  tipoProduto: TipoProdutoOlist,
  estampa: EstampaOlist,
  variante: VarianteOlist | null,
  tamanho: TamanhoOlist | null = null,
) {
  if (hasTemplateVariable(tipoProduto.titulo)) {
    return renderTemplate(tipoProduto.titulo, buildProdutoVariables(tipoProduto, estampa, variante, tamanho));
  }

  return [tipoProduto.titulo, tamanho?.titulo, estampa.codigo, variante?.codigo]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatImportCsvField(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/;/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildEstampasImportCsv(estampas: EstampaOlist[]) {
  return [
    "Codigo;Descricao;Palavras-chave;Extra",
    ...estampas.map((estampa) =>
      [
        estampa.codigo,
        estampa.descricao,
        estampa.palavrasChave,
        estampa.extra,
      ].map(formatImportCsvField).join(";"),
    ),
  ].join("\n");
}

function buildVariantesImportCsv(variantes: VarianteOlist[]) {
  return [
    "Codigo;Estampa;Tamanho;Descricao;Palavras-chave",
    ...variantes.map((variante) =>
      [
        variante.codigo,
        variante.estampa?.codigo,
        variante.tamanho?.sku ?? variante.tamanho?.titulo,
        variante.descricao,
        variante.palavrasChave,
      ].map(formatImportCsvField).join(";"),
    ),
  ].join("\n");
}

export function parseEstampasImport(text: string): EstampaImportadaInput[] {
  const linhas = text
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const primeiraLinha = linhas[0]?.toLowerCase().replace(/\s+/g, "");
  const linhasSemCabecalho = primeiraLinha?.startsWith("codigo;descricao;palavras-chave;extra")
    ? linhas.slice(1)
    : linhas;

  const estampas = linhasSemCabecalho.map((linha, index) => {
    const [codigoRaw = "", descricaoRaw = "", palavrasChaveRaw = "", extraRaw = ""] = linha.split(";");
    const codigo = codigoRaw.trim().toUpperCase();

    if (!codigo) {
      throw new Error(`Linha ${index + 1}: informe o codigo da estampa.`);
    }

    return {
      codigo,
      descricao: descricaoRaw.trim() || null,
      palavrasChave: palavrasChaveRaw.trim() || null,
      extra: extraRaw.trim() || null,
    };
  });

  if (!estampas.length) {
    throw new Error("Informe ao menos uma linha para importar.");
  }

  return estampas;
}

export function parseVariantesImport(text: string): VarianteImportadaInput[] {
  const linhas = text
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const primeiraLinha = linhas[0]?.toLowerCase().replace(/\s+/g, "");
  const linhasSemCabecalho = primeiraLinha?.startsWith("codigo;estampa;tamanho;descricao;palavras-chave")
    ? linhas.slice(1)
    : linhas;

  const variantes = linhasSemCabecalho.map((linha, index) => {
    const [codigoRaw = "", estampaRaw = "", tamanhoRaw = "", descricaoRaw = "", palavrasChaveRaw = ""] =
      linha.split(";");
    const codigo = codigoRaw.trim().toUpperCase();
    const estampaCodigo = estampaRaw.trim().toUpperCase();
    const tamanhoRef = tamanhoRaw.trim();

    if (!codigo) {
      throw new Error(`Linha ${index + 1}: informe o codigo da variante.`);
    }
    if (!estampaCodigo) {
      throw new Error(`Linha ${index + 1}: informe a estampa da variante.`);
    }
    if (!tamanhoRef) {
      throw new Error(`Linha ${index + 1}: informe o tamanho da variante.`);
    }

    return {
      codigo,
      estampaCodigo,
      tamanhoRef,
      descricao: descricaoRaw.trim() || null,
      palavrasChave: palavrasChaveRaw.trim() || null,
    };
  });

  if (!variantes.length) {
    throw new Error("Informe ao menos uma linha para importar.");
  }

  return variantes;
}

export function GeradorCsvOlistClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [abaAtiva, setAbaAtiva] = useState<Aba>("estamparia");
  const [dados, setDados] = useState<GeradorCsvOlistData>({
    tiposProduto: [],
    produtosFornecedor: [],
    estampas: [],
    variantes: [],
    tamanhos: [],
    produtosFinais: [],
    produtos: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tiposAtivos = useMemo(
    () => dados.tiposProduto.filter((tipo) => tipo.ativo),
    [dados.tiposProduto],
  );
  const estampasAtivas = useMemo(
    () => dados.estampas.filter((estampa) => estampa.ativo),
    [dados.estampas],
  );
  const variantesAtivas = useMemo(
    () => dados.variantes.filter((variante) => variante.ativo),
    [dados.variantes],
  );
  const tamanhosAtivos = useMemo(
    () => dados.tamanhos.filter((tamanho) => tamanho.ativo),
    [dados.tamanhos],
  );

  async function carregar() {
    setLoading(true);
    setErrorMessage(null);

    try {
      const resposta = await carregarGeradorCsvOlist();
      setDados(resposta);
      return resposta;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar dados.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    const tab = searchParams.get("tab") as Aba | null;
    setAbaAtiva(tab && ABA_IDS.has(tab) ? tab : "estamparia");
  }, [searchParams]);

  function selecionarAba(aba: Aba) {
    setAbaAtiva(aba);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", aba);
    router.push(`${pathname}?${params.toString()}`);
  }

  function toNumberOrNull(value: string) {
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    if (!normalized) return null;
    const numberValue = Number(normalized);

    if (Number.isNaN(numberValue) || numberValue < 0) {
      throw new Error("Preencha precos e medidas com numeros validos maiores ou iguais a zero.");
    }

    return numberValue;
  }

  async function gerarProdutosFinaisEmLote(payload: {
    tipoProdutoId: string;
    estampaIds: string[];
    varianteIds?: string[];
    tamanhoId?: string;
    precoCusto?: string;
    preco?: string;
    pesoLiquido?: string;
    pesoBruto?: string;
    larguraEmbalagem?: string;
    alturaEmbalagem?: string;
    comprimentoEmbalagem?: string;
  }) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const tipoProduto = dados.tiposProduto.find((tipo) => tipo.id === payload.tipoProdutoId);
      if (!tipoProduto) {
        throw new Error("Selecione um tipo de produto.");
      }
      if (payload.estampaIds.length === 0) {
        throw new Error("Selecione ao menos uma estampa.");
      }
      if (!payload.tamanhoId) {
        throw new Error("Selecione um tamanho.");
      }
      const alturaEmbalagem = toNumberOrNull(payload.alturaEmbalagem ?? "");
      if (alturaEmbalagem === null || alturaEmbalagem < 1) {
        throw new Error("A altura da embalagem deve ser no minimo 1.");
      }

      const resposta = await gerarProdutosFinaisEmLoteOlist({
        tipoProdutoId: tipoProduto.id,
        estampaIds: payload.estampaIds,
        tamanhoId: payload.tamanhoId,
        precoCusto: toNumberOrNull(payload.precoCusto ?? ""),
        preco: toNumberOrNull(payload.preco ?? ""),
        pesoLiquido: toNumberOrNull(payload.pesoLiquido ?? ""),
        pesoBruto: toNumberOrNull(payload.pesoBruto ?? ""),
        larguraEmbalagem: toNumberOrNull(payload.larguraEmbalagem ?? ""),
        alturaEmbalagem,
        comprimentoEmbalagem: toNumberOrNull(payload.comprimentoEmbalagem ?? ""),
      });

      setMessage(
        `${resposta.criados} produto(s) criado(s) e ${resposta.sobrescritos} sobrescrito(s) com sucesso.`,
      );
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao gerar produtos.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function gerarProdutoKitFinal(payload: {
    tipoProdutoId: string;
    estampaId: string;
    skuFinal: string;
    tituloFinal: string;
    descricaoFinal: string;
    precoCusto: string;
    preco: string;
    pesoLiquido: string;
    pesoBruto: string;
    larguraEmbalagem: string;
    alturaEmbalagem: string;
    comprimentoEmbalagem: string;
    componentes: Array<{
      produtoId: string;
      quantidade: string;
    }>;
  }) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await salvarProdutoKitFinalOlist({
        tipoProdutoId: payload.tipoProdutoId,
        estampaId: payload.estampaId,
        skuFinal: payload.skuFinal,
        tituloFinal: payload.tituloFinal,
        descricaoFinal: payload.descricaoFinal || null,
        precoCusto: toNumberOrNull(payload.precoCusto),
        preco: toNumberOrNull(payload.preco),
        pesoLiquido: toNumberOrNull(payload.pesoLiquido),
        pesoBruto: toNumberOrNull(payload.pesoBruto),
        larguraEmbalagem: toNumberOrNull(payload.larguraEmbalagem),
        alturaEmbalagem: toNumberOrNull(payload.alturaEmbalagem),
        comprimentoEmbalagem: toNumberOrNull(payload.comprimentoEmbalagem),
        componentes: payload.componentes.map((item) => ({
          produtoId: item.produtoId,
          quantidade: parseFlexibleDecimalText(item.quantidade) ?? 0,
        })),
      });
      setMessage("Produto kit final criado em Produtos Criados.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao gerar produto kit final.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function salvarProdutoFinal(payload: {
    id: string;
    skuFinal: string;
    tituloFinal: string;
    categoria: string;
    precoCusto: string;
    preco: string;
  }) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await salvarProdutoFinalOlist({
        id: payload.id,
        skuFinal: payload.skuFinal,
        tituloFinal: payload.tituloFinal,
        categoria: payload.categoria || null,
        precoCusto: toNumberOrNull(payload.precoCusto),
        preco: toNumberOrNull(payload.preco),
      });
      setMessage("Produto final salvo com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar produto final.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function excluirProdutoFinal(id: string) {
    const confirmar = window.confirm("Excluir este produto final?");
    if (!confirmar) return;

    await excluirProdutoFinalSemConfirmar(id);
  }

  async function excluirProdutoFinalSemConfirmar(idOuIds: string | string[]) {
    const ids = Array.isArray(idOuIds) ? idOuIds : [idOuIds];
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const resposta = await excluirProdutoFinalOlist(ids);
      setMessage(`${resposta.excluidos} produto(s) final(is) excluido(s) com sucesso.`);
      await carregar();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao excluir produto final.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function vincularProdutosFinais(ids: string[]) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const resposta = await vincularProdutosFinaisOlist(ids);
      const semVinculo = resposta.naoEncontrados.length
        ? ` ${resposta.naoEncontrados.length} SKU(s) nao encontrado(s) em produtos.`
        : "";

      setMessage(`${resposta.vinculados} produto(s) vinculado(s) com sucesso.${semVinculo}`);
      const dadosAtualizados = await carregar();
      return (dadosAtualizados?.produtosFinais ?? dados.produtosFinais).filter((produto) =>
        ids.includes(produto.id),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao vincular produtos.");
      return [];
    } finally {
      setSaving(false);
    }
  }

  function baixarCsv(produtos?: ProdutoFinalOlist[]) {
    const produtosCsv = Array.isArray(produtos) ? produtos : dados.produtosFinais;
    const csv = montarCsvProdutosOlist(produtosCsv, { cacheKey: Date.now() });
    downloadCsv("produtos-olist.csv", csv);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Gerador CSV Olist"
        description="Cadastre bases de produtos, estampas e variantes para gerar produtos finais prontos para exportacao em CSV."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap gap-2">
          {ABAS.map((aba) => (
            <button
              key={aba.id}
              type="button"
              onClick={() => selecionarAba(aba.id)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                abaAtiva === aba.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {aba.label}
            </button>
          ))}
        </div>
      </section>

      {message && <p className="-mt-4 text-sm text-emerald-700">{message}</p>}
      {errorMessage && <p className="-mt-4 text-sm text-red-600">{errorMessage}</p>}

      {loading ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-600">Carregando gerador...</p>
        </section>
      ) : (
        <>
          {abaAtiva === "estamparia" && (
            <EstampariaTab estampas={dados.estampas} variantes={dados.variantes} />
          )}

          {abaAtiva === "gerar" && (
            <GerarProdutoTab
              tipos={tiposAtivos}
              estampas={estampasAtivas}
              variantes={variantesAtivas}
              tamanhos={tamanhosAtivos}
              produtos={dados.produtosFinais}
              saving={saving}
              onGenerate={gerarProdutosFinaisEmLote}
              onDownloadCsv={baixarCsv}
            />
          )}

          {abaAtiva === "gerar-kit" && (
            <GerarProdutoKitFinalTab
              tipos={tiposAtivos}
              estampas={estampasAtivas}
              produtos={dados.produtos}
              produtosFinais={dados.produtosFinais}
              saving={saving}
              onGenerate={gerarProdutoKitFinal}
            />
          )}

          {abaAtiva === "produtos" && (
            <ProdutosCriadosTab
              produtos={dados.produtosFinais}
              tipos={dados.tiposProduto}
              estampas={dados.estampas}
              variantes={dados.variantes}
              saving={saving}
              onSave={salvarProdutoFinal}
              onDelete={excluirProdutoFinal}
              onDeleteMany={excluirProdutoFinalSemConfirmar}
              onExportCsv={baixarCsv}
              onLinkProdutos={vincularProdutosFinais}
            />
          )}

          {abaAtiva === "produtos-vk" && (
            <ProdutosCriadosVkTab
              produtos={dados.produtosFinais}
              saving={saving}
              onDeleteMany={excluirProdutoFinalSemConfirmar}
            />
          )}
        </>
      )}
    </div>
  );
}

function EstampariaTab({
  estampas,
  variantes,
}: {
  estampas: EstampaOlist[];
  variantes: VarianteOlist[];
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const variantesPorEstampa = useMemo(() => {
    const mapa = new Map<string, VarianteOlist[]>();
    for (const variante of variantes) {
      if (!variante.estampaId) continue;
      const atuais = mapa.get(variante.estampaId) ?? [];
      atuais.push(variante);
      mapa.set(variante.estampaId, atuais);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));
    }
    return mapa;
  }, [variantes]);

  function alternar(estampaId: string) {
    setAbertas((atuais) => {
      const proximas = new Set(atuais);
      if (proximas.has(estampaId)) proximas.delete(estampaId);
      else proximas.add(estampaId);
      return proximas;
    });
  }

  const estampasOrdenadas = useMemo(
    () => [...estampas].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR")),
    [estampas],
  );

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Estamparia</h3>
        <p className="mt-1 text-sm text-slate-600">
          Clique em uma estampa para visualizar suas variantes.
        </p>
      </div>

      {estampasOrdenadas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Nenhuma estampa cadastrada.
        </div>
      ) : (
        <div className="space-y-3">
          {estampasOrdenadas.map((estampa) => {
            const aberta = abertas.has(estampa.id);
            const variantesDaEstampa = variantesPorEstampa.get(estampa.id) ?? [];
            return (
              <article key={estampa.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  aria-expanded={aberta}
                  onClick={() => alternar(estampa.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{estampa.codigo}</p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {estampa.descricao || estampa.nome || "Sem descrição"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {variantesDaEstampa.length} {variantesDaEstampa.length === 1 ? "variante" : "variantes"}
                    </span>
                    <span className={`text-lg text-slate-500 transition-transform ${aberta ? "rotate-180" : ""}`}>⌄</span>
                  </div>
                </button>

                {aberta && (
                  <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
                    {variantesDaEstampa.length === 0 ? (
                      <p className="text-sm text-slate-500">Esta estampa não possui variantes cadastradas.</p>
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                            <tr><th className="px-4 py-3">Código</th><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Tamanho</th><th className="px-4 py-3">Status</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {variantesDaEstampa.map((variante) => (
                              <tr key={variante.id}>
                                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{variante.codigo}</td>
                                <td className="min-w-56 px-4 py-3 text-slate-600">{variante.descricao || variante.nome || "—"}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{variante.tamanho?.titulo || variante.tamanho?.sku || "—"}</td>
                                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${variante.ativo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{variante.ativo ? "Ativa" : "Inativa"}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TiposProdutoTab({
  tipos,
  produtosFornecedor,
  form,
  setForm,
  editingId,
  setEditingId,
  saving,
  onSubmit,
  onEdit,
  onDuplicate,
  onDelete,
  onDeleteMany,
  onImport,
  canEdit = true,
}: {
  tipos: TipoProdutoOlist[];
  produtosFornecedor: ProdutoFornecedorOlist[];
  form: typeof tipoInicial;
  setForm: Dispatch<SetStateAction<typeof tipoInicial>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (tipo: TipoProdutoOlist) => void;
  onDuplicate: (tipo: TipoProdutoOlist) => void;
  onDelete: (id: string) => void | Promise<void>;
  onDeleteMany: (ids: string[]) => Promise<void>;
  onImport: (items: TipoProdutoCsvImportado[]) => Promise<void>;
  canEdit?: boolean;
}) {
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [importItems, setImportItems] = useState<TipoProdutoCsvImportado[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [pageSize, setPageSize] = useState<100 | 1000 | 99999>(100);
  const [page, setPage] = useState(1);
  type TipoProdutoTextField = Exclude<
    keyof typeof tipoInicial,
    "produtosFornecidos" | "corteLaser" | "tecidoCorrido"
  >;
  const textFields: {
    key: TipoProdutoTextField;
    label: string;
    required?: boolean;
    placeholder?: string;
    className?: string;
  }[] = [
    { key: "titulo", label: "Titulo", required: true, placeholder: "Ex.: Camiseta Basica", className: "md:col-span-2" },
    { key: "sku", label: "SKU", required: true, placeholder: "CAM-BASICA" },
    { key: "slug", label: "Slug", placeholder: "camiseta-basica" },
    { key: "categoria", label: "Categoria", placeholder: "Moda > Camisetas", className: "md:col-span-2" },
    { key: "palavrasChave", label: "Palavras-chave", placeholder: "camiseta, algodao, basica", className: "md:col-span-2" },
  ];
  const totalPages = Math.max(1, Math.ceil(tipos.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const tiposPaginados = tipos.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allSelected = tiposPaginados.length > 0 && tiposPaginados.every((tipo) => selectedIds.includes(tipo.id));

  useEffect(() => {
    setPage((pagina) => Math.min(pagina, totalPages));
  }, [totalPages]);

  function exportCsv() {
    const header = ["Titulo", "SKU", "Corte laser", "Tecido corrido", "Categoria", "Produto fornecido", "Produto fornecedor ID", "Slug", "Descricao", "Descricao SEO", "Palavras-chave", "Detalhes prompt IA"];
    const rows = tipos.map((tipo) => [tipo.titulo, tipo.sku, tipo.corteLaser ? "SIM" : "NAO", tipo.tecidoCorrido ? "SIM" : "NAO", tipo.categoria, tipo.produtosFornecidos[0]?.produtoFornecedor.nome, tipo.produtosFornecidos[0]?.produtoFornecedorId, tipo.slug, tipo.descricao, tipo.descricaoSeo, tipo.palavrasChave, tipo.detalhesPromptIa].map(formatImportCsvField).join(";"));
    downloadCsv("tipos-de-produto.csv", [header.join(";"), ...rows].join("\n"));
  }

  async function readImportFile(file: File | null) {
    setImportErrors([]); setImportItems([]); setImportFileName(file?.name ?? "");
    if (!file) return;
    setImportStep(2);
    const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) { setImportErrors(["O CSV deve conter cabeçalho e ao menos uma linha."]); return; }
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const headers = lines[0].split(";").map(normalize);
    const index = (name: string) => headers.indexOf(normalize(name));
    const missing = ["Titulo", "SKU", "Corte laser", "Tecido corrido", "Categoria", "Produto fornecido"].filter((name) => index(name) < 0);
    if (missing.length) { setImportErrors([`Colunas obrigatórias ausentes: ${missing.join(", ")}.`]); return; }
    const boolValue = (value: string) => ["sim", "s", "true", "1", "c/laser", "c/corrido"].includes(normalize(value));
    const suppliersById = new Map(produtosFornecedor.map((item) => [item.id, item]));
    const resolveSupplier = (id: string, label: string) => suppliersById.get(id.trim()) ?? produtosFornecedor.find((item) => normalize(`${item.nome} - ${item.fornecedorNome}`) === normalize(label)) ?? produtosFornecedor.find((item) => normalize(item.nome) === normalize(label));
    const errors: string[] = []; const seen = new Set<string>();
    const items = lines.slice(1).map((line, rowIndex) => {
      const cells = line.split(";").map((cell) => cell.trim());
      const get = (name: string) => index(name) >= 0 ? cells[index(name)] ?? "" : "";
      const titulo = get("Titulo"); const sku = get("SKU").toUpperCase();
      const supplier = resolveSupplier(get("Produto fornecedor ID"), get("Produto fornecido"));
      if (!titulo) errors.push(`Linha ${rowIndex + 2}: título obrigatório.`);
      if (!sku) errors.push(`Linha ${rowIndex + 2}: SKU obrigatório.`);
      if (sku && seen.has(sku)) errors.push(`Linha ${rowIndex + 2}: SKU ${sku} está duplicado no arquivo.`);
      seen.add(sku);
      if (!supplier) errors.push(`Linha ${rowIndex + 2}: produto fornecido não encontrado.`);
      return { titulo, sku, corteLaser: boolValue(get("Corte laser")), tecidoCorrido: boolValue(get("Tecido corrido")), categoria: get("Categoria"), produtoFornecedorId: supplier?.id ?? "", produtoFornecido: get("Produto fornecido"), slug: get("Slug"), descricao: get("Descricao"), descricaoSeo: get("Descricao SEO"), palavrasChave: get("Palavras-chave"), detalhesPromptIa: get("Detalhes prompt IA") };
    });
    setImportItems(items); setImportErrors(errors);
  }

  async function confirmImport() {
    if (importErrors.length || !importItems.length) return;
    await onImport(importItems); setImportOpen(false); setImportStep(1); setImportItems([]); setImportFileName("");
  }

  async function deleteSelected() {
    if (!selectedIds.length || !window.confirm(`Excluir ${selectedIds.length} tipo(s) de produto selecionado(s)?`)) return;
    await onDeleteMany(selectedIds); setSelectedIds([]);
  }
  return (
    <div className="space-y-8">
      {canEdit && <section className="rounded-lg border border-slate-200 bg-white p-6">
        <button type="button" onClick={() => setCadastroAberto((open) => !open)} className="flex w-full items-center justify-between text-left">
          <h3 className="text-lg font-semibold text-slate-900">{editingId ? "Editar tipo de produto" : "Cadastrar tipo de produto"}</h3>
          <span className={`text-xl text-slate-500 transition ${cadastroAberto ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {cadastroAberto && <form className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-4" onSubmit={onSubmit}>
          {textFields.map((field) => (
            <label key={field.key} className={`text-sm text-slate-700 ${field.className ?? ""}`}>
              {field.label}
              <input
                required={field.required}
                value={form[field.key]}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((prev) => {
                    if (field.key !== "titulo") {
                      return { ...prev, [field.key]: value };
                    }

                    return {
                      ...prev,
                      titulo: value,
                      sku: buildSkuFromTitle(value),
                      slug: buildSlugFromTitle(value),
                    };
                  });
                }}
                className={`mt-1 w-full rounded-md border border-slate-300 px-3 py-2 ${field.key === "sku" ? "uppercase" : ""}`}
                placeholder={field.placeholder}
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={form.corteLaser}
              onChange={(event) => setForm((prev) => ({ ...prev, corteLaser: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300"
            />
            Tem corte laser ({form.corteLaser ? "C/LASER" : "S/LASER"})
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={form.tecidoCorrido}
              onChange={(event) => setForm((prev) => ({ ...prev, tecidoCorrido: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300"
            />
            Tecido corrido ({form.tecidoCorrido ? "C/CORRIDO" : "S/CORRIDO"})
          </label>
          <label className="text-sm text-slate-700 md:col-span-4">
            Descricao
            <textarea
              value={form.descricao}
              onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700 md:col-span-4">
            Descricao SEO
            <textarea
              value={form.descricaoSeo}
              onChange={(event) => setForm((prev) => ({ ...prev, descricaoSeo: event.target.value }))}
              className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700 md:col-span-4">
            Detalhes especificos do tipo de produto para prompt IA
            <textarea
              value={form.detalhesPromptIa}
              onChange={(event) => setForm((prev) => ({ ...prev, detalhesPromptIa: event.target.value }))}
              className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Ex.: Produto em tecido fourway com leve elasticidade. A arte deve acompanhar o caimento natural do tecido."
            />
          </label>
          <label className="text-sm text-slate-700 md:col-span-4">
            Produto fornecido
            <select
              required
              value={form.produtosFornecidos[0]?.produtoFornecedorId ?? ""}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  produtosFornecidos: event.target.value
                    ? [{ produtoFornecedorId: event.target.value, quantidadeUsada: "1" }]
                    : [],
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Selecione o produto fornecido</option>
              {produtosFornecedor.map((produtoFornecedor) => (
                <option key={produtoFornecedor.id} value={produtoFornecedor.id}>
                  {produtoFornecedor.nome} - {produtoFornecedor.fornecedorNome}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 md:col-span-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : editingId ? "Salvar edicao" : "Cadastrar"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setForm(tipoInicial);
                  setEditingId(null);
                }}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>}
      </section>}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-lg font-semibold text-slate-900">Tipos cadastrados</h3>{selectedIds.length > 0 && <p className="text-sm text-slate-500">{selectedIds.length} selecionado(s)</p>}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportCsv} disabled={!tipos.length} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Exportar CSV</button>
            {canEdit && <button type="button" onClick={() => { setImportOpen(true); setImportStep(1); setImportErrors([]); setImportItems([]); }} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Importar CSV</button>}
            {canEdit && selectedIds.length > 0 && <button type="button" onClick={() => void deleteSelected()} disabled={saving} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Excluir selecionados</button>}
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="text-sm text-slate-700">Itens por página
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 100 | 1000 | 99999); setPage(1); }} className="ml-2 rounded-md border border-slate-300 bg-white px-3 py-2">
              <option value={100}>100</option><option value={1000}>1000</option><option value={99999}>99999</option>
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>{tipos.length.toLocaleString("pt-BR")} registro(s) · Página {currentPage} de {totalPages}</span>
            <button type="button" onClick={() => setPage((pagina) => Math.max(1, pagina - 1))} disabled={currentPage === 1} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Anterior</button>
            <button type="button" onClick={() => setPage((pagina) => Math.min(totalPages, pagina + 1))} disabled={currentPage === totalPages} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Próxima</button>
          </div>
        </div>
        <TableEmpty visible={tipos.length === 0} text="Nenhum tipo de produto cadastrado." />
        {tipos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  {canEdit && <th className="p-3"><input type="checkbox" checked={allSelected} onChange={() => { const idsPagina = tiposPaginados.map((tipo) => tipo.id); setSelectedIds((ids) => allSelected ? ids.filter((id) => !idsPagina.includes(id)) : Array.from(new Set([...ids, ...idsPagina]))); }} aria-label="Selecionar todos da página" /></th>}
                  <th className="p-3">Titulo</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Corte laser</th>
                  <th className="p-3">Tecido corrido</th>
                  <th className="p-3">Categoria</th>
                  <th className="p-3">Produto fornecido</th>
                  {canEdit && <th className="p-3">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {tiposPaginados.map((tipo) => (
                  <tr key={tipo.id} className="border-b border-slate-100">
                    {canEdit && <td className="p-3"><input type="checkbox" checked={selectedIds.includes(tipo.id)} onChange={() => setSelectedIds((ids) => ids.includes(tipo.id) ? ids.filter((id) => id !== tipo.id) : [...ids, tipo.id])} aria-label={`Selecionar ${tipo.titulo}`} /></td>}
                    <td className="p-3 font-medium text-slate-700">
                      <div>{tipo.titulo}</div>
                      <div className="mt-1 text-xs text-slate-500">{tipo.slug ?? "-"}</div>
                    </td>
                    <td className="p-3 text-slate-700">{tipo.sku}</td>
                    <td className="p-3 text-slate-700">{tipo.corteLaser ? "C/LASER" : "S/LASER"}</td>
                    <td className="p-3 text-slate-700">{tipo.tecidoCorrido ? "C/CORRIDO" : "S/CORRIDO"}</td>
                    <td className="p-3 text-slate-700">{tipo.categoria ?? "-"}</td>
                    <td className="p-3 text-slate-700">
                      {tipo.produtosFornecidos[0]?.produtoFornecedor.nome ?? "-"}
                    </td>
                    {canEdit && <td className="p-3">
                      <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setCadastroAberto(true); onEdit(tipo); }}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCadastroAberto(true); onDuplicate(tipo); }}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Duplicar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(tipo.id)}
                        disabled={saving}
                        className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Excluir
                      </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && importOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-semibold text-slate-900">Importar tipos de produto</h3><p className="text-sm text-slate-500">Etapa {importStep} de 2</p></div><button type="button" onClick={() => setImportOpen(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Fechar</button></div>
          {importStep === 1 ? <div className="space-y-4">
            <p className="text-sm text-slate-600">Selecione um CSV separado por ponto e vírgula. Você pode usar o arquivo exportado como modelo.</p>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void readImportFile(event.target.files?.[0] ?? null)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" />
          </div> : <div className="space-y-4">
            <div className={`rounded-md border p-3 text-sm ${importErrors.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {importErrors.length ? <><p className="font-semibold">Foram encontrados {importErrors.length} erro(s):</p><ul className="mt-2 list-disc pl-5">{importErrors.map((item) => <li key={item}>{item}</li>)}</ul></> : `${importItems.length} registro(s) validados e prontos para importar.`}
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Título</th><th className="p-3">SKU</th><th className="p-3">Corte laser</th><th className="p-3">Tecido corrido</th><th className="p-3">Categoria</th><th className="p-3">Produto fornecido</th></tr></thead><tbody>{importItems.map((item, index) => <tr key={`${item.sku}-${index}`} className="border-t border-slate-100"><td className="p-3">{item.titulo}</td><td className="p-3">{item.sku}</td><td className="p-3">{item.corteLaser ? "SIM" : "NÃO"}</td><td className="p-3">{item.tecidoCorrido ? "SIM" : "NÃO"}</td><td className="p-3">{item.categoria || "-"}</td><td className="p-3">{item.produtoFornecido}</td></tr>)}</tbody></table></div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setImportStep(1)} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Voltar</button><button type="button" onClick={() => void confirmImport()} disabled={saving || importErrors.length > 0 || importItems.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Importando..." : "Confirmar importação"}</button></div>
          </div>}
          {importFileName && <p className="mt-4 text-xs text-slate-500">Arquivo: {importFileName}</p>}
        </div>
      </div>}
    </div>
  );
}

export function TamanhosTab({
  tamanhos,
  form,
  setForm,
  editingId,
  setEditingId,
  busca,
  setBusca,
  saving,
  onSubmit,
  onEdit,
  onDuplicate,
  onDelete,
  onDeleteMany,
  onImport,
  canEdit = true,
}: {
  tamanhos: TamanhoOlist[];
  form: typeof tamanhoInicial;
  setForm: Dispatch<SetStateAction<typeof tamanhoInicial>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  busca: string;
  setBusca: Dispatch<SetStateAction<string>>;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (tamanho: TamanhoOlist) => void;
  onDuplicate: (tamanho: TamanhoOlist) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<void>;
  onImport: (items: TamanhoCsvImportado[]) => Promise<void>;
  canEdit?: boolean;
}) {
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [importItems, setImportItems] = useState<TamanhoCsvImportado[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<100 | 1000 | 99999>(100);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(tamanhos.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const tamanhosPaginados = tamanhos.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allSelected = tamanhosPaginados.length > 0 && tamanhosPaginados.every((item) => selectedIds.includes(item.id));

  useEffect(() => {
    setPage((pagina) => Math.min(pagina, totalPages));
  }, [totalPages]);

  async function lerArquivoImportacao(file: File | null) {
    setImportErrors([]); setImportItems([]); setImportFileName(file?.name ?? "");
    if (!file) return;
    setImportStep(2);
    const linhas = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((linha) => linha.trim());
    if (linhas.length < 2) { setImportErrors(["O CSV deve conter cabeçalho e ao menos uma linha."]); return; }
    const normalizar = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const cabecalhos = linhas[0].split(";").map(normalizar);
    const indice = (nome: string) => cabecalhos.indexOf(normalizar(nome));
    const ausentes = ["Titulo", "SKU", "Slug", "Quantidade usada"].filter((nome) => indice(nome) < 0);
    if (ausentes.length) { setImportErrors([`Colunas obrigatórias ausentes: ${ausentes.join(", ")}.`]); return; }
    const erros: string[] = []; const vistos = new Set<string>();
    const items = linhas.slice(1).map((linha, rowIndex) => {
      const cells = linha.split(";").map((cell) => cell.trim());
      const get = (nome: string) => cells[indice(nome)] ?? "";
      const titulo = get("Titulo"); const sku = get("SKU").toUpperCase(); const slug = get("Slug");
      const quantidadeTexto = get("Quantidade usada").replace(/\./g, "").replace(",", ".");
      const quantidade = Number(quantidadeTexto);
      if (!titulo) erros.push(`Linha ${rowIndex + 2}: título obrigatório.`);
      if (!sku) erros.push(`Linha ${rowIndex + 2}: SKU obrigatório.`);
      if (sku && vistos.has(sku)) erros.push(`Linha ${rowIndex + 2}: SKU ${sku} está duplicado no arquivo.`);
      vistos.add(sku);
      if (!quantidadeTexto || Number.isNaN(quantidade) || quantidade < 0) erros.push(`Linha ${rowIndex + 2}: quantidade usada inválida.`);
      return { titulo, sku, slug, quantidadeProdutoFornecedor: quantidade };
    });
    setImportItems(items); setImportErrors(erros);
  }

  async function confirmarImportacao() {
    if (importErrors.length || !importItems.length) return;
    await onImport(importItems); setImportOpen(false); setImportStep(1); setImportItems([]); setImportFileName("");
  }

  async function excluirSelecionados() {
    if (!selectedIds.length || !window.confirm(`Excluir ${selectedIds.length} tamanho(s) selecionado(s)?`)) return;
    await onDeleteMany(selectedIds);
    setSelectedIds([]);
  }

  function exportarTamanhosCsv() {
    const linhas = tamanhos.map((tamanho) =>
      [
        tamanho.titulo,
        tamanho.sku,
        tamanho.slug,
        tamanho.quantidadeProdutoFornecedor === null
          ? ""
          : String(tamanho.quantidadeProdutoFornecedor).replace(".", ","),
      ].map(formatImportCsvField).join(";"),
    );
    downloadCsv(
      "tamanhos.csv",
      ["Titulo;SKU;Slug;Quantidade usada", ...linhas].join("\n"),
    );
  }

  return (
    <div className="space-y-8">
      {canEdit && <section className="rounded-lg border border-slate-200 bg-white p-6">
        <button type="button" onClick={() => setCadastroAberto((open) => !open)} className="flex w-full items-center justify-between text-left">
          <h3 className="text-lg font-semibold text-slate-900">{editingId ? "Editar tamanho" : "Cadastrar tamanho"}</h3>
          <span className={`text-xl text-slate-500 transition ${cadastroAberto ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {cadastroAberto && <form className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-3" onSubmit={onSubmit}>
          <label className="text-sm text-slate-700">
            Titulo tamanho
            <input
              required
              value={form.titulo}
              onChange={(event) => setForm((prev) => ({ ...prev, titulo: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Ex.: Pequeno"
            />
          </label>
          <label className="text-sm text-slate-700">
            SKU
            <input
              required
              value={form.sku}
              onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value.toUpperCase() }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
              placeholder="Ex.: P"
            />
          </label>
          <label className="text-sm text-slate-700">
            Slug
            <input
              value={form.slug}
              onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="pequeno"
            />
          </label>
          <label className="text-sm text-slate-700">
            Quantidade usada
            <input
              required
              inputMode="decimal"
              value={form.quantidadeProdutoFornecedor}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  quantidadeProdutoFornecedor: event.target.value,
                }))
              }
              onBlur={() =>
                setForm((prev) => ({
                  ...prev,
                  quantidadeProdutoFornecedor: normalizeDecimalText(prev.quantidadeProdutoFornecedor, 4),
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Ex.: 1,4500"
            />
          </label>
          <div className="flex gap-2 md:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : editingId ? "Salvar edicao" : "Cadastrar"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setForm(tamanhoInicial);
                  setEditingId(null);
                }}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>}
      </section>}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Tamanhos cadastrados</h3>
          <div className="flex w-full flex-col gap-2 md:max-w-xl md:flex-row md:items-end md:justify-end">
            <label className="w-full text-sm text-slate-700 md:max-w-xs">
              Buscar
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Titulo, SKU ou slug"
              />
            </label>
            <button
              type="button"
              onClick={exportarTamanhosCsv}
              disabled={tamanhos.length === 0}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Exportar CSV
            </button>
            {canEdit && <button
              type="button"
              onClick={() => { setImportOpen(true); setImportStep(1); setImportErrors([]); setImportItems([]); setImportFileName(""); }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Importar CSV
            </button>}
          </div>
        </div>

        {canEdit && selectedIds.length > 0 && <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <span className="text-sm text-slate-600">{selectedIds.length} tamanho(s) selecionado(s)</span>
          <button type="button" onClick={() => void excluirSelecionados()} disabled={saving} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Excluir selecionados</button>
        </div>}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="text-sm text-slate-700">Itens por página
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 100 | 1000 | 99999); setPage(1); }} className="ml-2 rounded-md border border-slate-300 bg-white px-3 py-2">
              <option value={100}>100</option><option value={1000}>1000</option><option value={99999}>99999</option>
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>{tamanhos.length.toLocaleString("pt-BR")} registro(s) · Página {currentPage} de {totalPages}</span>
            <button type="button" onClick={() => setPage((pagina) => Math.max(1, pagina - 1))} disabled={currentPage === 1} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Anterior</button>
            <button type="button" onClick={() => setPage((pagina) => Math.min(totalPages, pagina + 1))} disabled={currentPage === totalPages} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Próxima</button>
          </div>
        </div>

        <TableEmpty visible={tamanhos.length === 0} text="Nenhum tamanho encontrado." />
        {tamanhos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  {canEdit && <th className="p-3"><input type="checkbox" checked={allSelected} onChange={() => { const idsPagina = tamanhosPaginados.map((item) => item.id); setSelectedIds((ids) => allSelected ? ids.filter((id) => !idsPagina.includes(id)) : Array.from(new Set([...ids, ...idsPagina]))); }} aria-label="Selecionar todos os tamanhos da página" /></th>}
                  <th className="p-3">Titulo</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Slug</th>
                  <th className="p-3">Quantidade usada</th>
                  {canEdit && <th className="p-3">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {tamanhosPaginados.map((tamanho) => (
                  <tr key={tamanho.id} className="border-b border-slate-100">
                    {canEdit && <td className="p-3"><input type="checkbox" checked={selectedIds.includes(tamanho.id)} onChange={() => setSelectedIds((ids) => ids.includes(tamanho.id) ? ids.filter((id) => id !== tamanho.id) : [...ids, tamanho.id])} aria-label={`Selecionar ${tamanho.titulo}`} /></td>}
                    <td className="p-3 font-medium text-slate-700">{tamanho.titulo}</td>
                    <td className="p-3 text-slate-700">{tamanho.sku}</td>
                    <td className="p-3 text-slate-700">{tamanho.slug ?? "-"}</td>
                    <td className="p-3 text-slate-700">
                      {formatDecimal(tamanho.quantidadeProdutoFornecedor, 4)}
                    </td>
                    {canEdit && <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setCadastroAberto(true); onEdit(tamanho); }}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCadastroAberto(true); onDuplicate(tamanho); }}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(tamanho.id)}
                          disabled={saving}
                          className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && importOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-semibold text-slate-900">Importar tamanhos</h3><p className="text-sm text-slate-500">Etapa {importStep} de 2</p></div><button type="button" onClick={() => setImportOpen(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Fechar</button></div>
          {importStep === 1 ? <div className="space-y-4">
            <p className="text-sm text-slate-600">Selecione um CSV separado por ponto e vírgula com as colunas Titulo, SKU, Slug e Quantidade usada.</p>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void lerArquivoImportacao(event.target.files?.[0] ?? null)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" />
          </div> : <div className="space-y-4">
            <div className={`rounded-md border p-3 text-sm ${importErrors.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {importErrors.length ? <><p className="font-semibold">Foram encontrados {importErrors.length} erro(s):</p><ul className="mt-2 list-disc pl-5">{importErrors.map((item) => <li key={item}>{item}</li>)}</ul></> : `${importItems.length} registro(s) validados e prontos para importar.`}
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Título</th><th className="p-3">SKU</th><th className="p-3">Slug</th><th className="p-3">Quantidade usada</th></tr></thead><tbody>{importItems.map((item, index) => <tr key={`${item.sku}-${index}`} className="border-t border-slate-100"><td className="p-3">{item.titulo}</td><td className="p-3">{item.sku}</td><td className="p-3">{item.slug || "-"}</td><td className="p-3">{formatDecimal(item.quantidadeProdutoFornecedor, 4)}</td></tr>)}</tbody></table></div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setImportStep(1)} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Voltar</button><button type="button" onClick={() => void confirmarImportacao()} disabled={saving || importErrors.length > 0 || importItems.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Importando..." : "Confirmar importação"}</button></div>
          </div>}
          {importFileName && <p className="mt-4 text-xs text-slate-500">Arquivo: {importFileName}</p>}
        </div>
      </div>}
    </div>
  );
}

export function EstampasTab({
  estampas,
  form,
  setForm,
  imagemFiles,
  setImagemFiles,
  imagemInputKey,
  resetImagemInput,
  editingId,
  setEditingId,
  busca,
  setBusca,
  saving,
  onSubmit,
  onImport,
  onVerifyImages,
  onEdit,
  onDuplicate,
  onDelete,
  onDeleteMany,
  canEdit = true,
}: {
  estampas: EstampaOlist[];
  form: typeof estampaInicial;
  setForm: Dispatch<SetStateAction<typeof estampaInicial>>;
  imagemFiles: [File | null, File | null];
  setImagemFiles: Dispatch<SetStateAction<[File | null, File | null]>>;
  imagemInputKey: number;
  resetImagemInput: () => void;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  busca: string;
  setBusca: Dispatch<SetStateAction<string>>;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onImport: (text: string) => Promise<void>;
  onVerifyImages: (ids: string[]) => Promise<void>;
  onEdit: (estampa: EstampaOlist) => void;
  onDuplicate: (estampa: EstampaOlist) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<void>;
  canEdit?: boolean;
}) {
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [importItems, setImportItems] = useState<EstampaImportadaInput[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<100 | 1000 | 99999>(100);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(estampas.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const estampasPaginadas = estampas.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const estampasIds = estampasPaginadas.map((estampa) => estampa.id);
  const todasSelecionadas =
    estampasIds.length > 0 && estampasIds.every((id) => selectedIds.includes(id));

  useEffect(() => {
    setPage((pagina) => Math.min(pagina, totalPages));
  }, [totalPages]);

  function toggleEstampa(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function toggleTodas() {
    setSelectedIds((prev) =>
      todasSelecionadas
        ? prev.filter((id) => !estampasIds.includes(id))
        : Array.from(new Set([...prev, ...estampasIds])),
    );
  }

  async function verificarSelecionadas() {
    await onVerifyImages(selectedIds);
    setSelectedIds([]);
  }

  async function excluirEstampasSelecionadas() {
    if (!selectedIds.length || !window.confirm(`Excluir ${selectedIds.length} estampa(s) selecionada(s)?`)) return;
    await onDeleteMany(selectedIds);
    setSelectedIds([]);
  }

  async function lerArquivoEstampas(file: File | null) {
    setImportErrors([]); setImportItems([]); setImportText(""); setImportFileName(file?.name ?? "");
    if (!file) return;
    setImportStep(2);
    try {
      const text = await file.text();
      const items = parseEstampasImport(text);
      const vistos = new Set<string>();
      const duplicados = items.map((item) => item.codigo).filter((codigo) => vistos.has(codigo) || !vistos.add(codigo));
      setImportText(text); setImportItems(items);
      if (duplicados.length) setImportErrors([`Códigos duplicados no arquivo: ${Array.from(new Set(duplicados)).join(", ")}.`]);
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Erro ao validar o CSV de estampas."]);
    }
  }

  async function confirmarImportacaoEstampas() {
    if (!importText || importErrors.length || !importItems.length) return;
    try {
      await onImport(importText);
      setImportText(""); setImportItems([]); setImportModalOpen(false); setImportStep(1); setImportFileName("");
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Erro ao importar estampas."]);
    }
  }

  return (
    <div className="space-y-8">
      {canEdit && <section className="rounded-lg border border-slate-200 bg-white p-6">
        <button type="button" onClick={() => setCadastroAberto((open) => !open)} className="flex w-full items-center justify-between text-left">
          <h3 className="text-lg font-semibold text-slate-900">{editingId ? "Editar estampa" : "Cadastrar estampa"}</h3>
          <span className={`text-xl text-slate-500 transition ${cadastroAberto ? "rotate-180" : ""}`}>⌄</span>
        </button>

        {cadastroAberto && <form className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="text-sm text-slate-700">
            Codigo da estampa
            <input
              required
              value={form.codigo}
              onChange={(event) => setForm((prev) => ({ ...prev, codigo: event.target.value.toUpperCase() }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
              placeholder="Ex.: FLR-001"
            />
          </label>

          <label className="text-sm text-slate-700">
            Palavras-chave
            <input
              value={form.palavrasChave}
              onChange={(event) => setForm((prev) => ({ ...prev, palavrasChave: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="floral, azul, primavera"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Extra
            <input
              value={form.extra}
              onChange={(event) => setForm((prev) => ({ ...prev, extra: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Informacao extra da estampa"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Descricao da estampa
            <textarea
              value={form.descricao}
              onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          {[0, 1].map((index) => (
            <label key={index} className="text-sm text-slate-700">
              {index === 0 ? "Imagem da estampa 1" : "Imagem da estampa 2"}
              <input
                key={`${imagemInputKey}-${index}`}
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setImagemFiles((prev) => {
                    const next: [File | null, File | null] = [...prev];
                    next[index] = event.target.files?.[0] ?? null;
                    return next;
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {imagemFiles[index]
                  ? `Arquivo selecionado: ${imagemFiles[index]?.name}`
                  : `Sera salva como ${form.codigo.trim().toUpperCase() || "{CODIGO}"}-${index}.jpg`}
              </span>
            </label>
          ))}

          <div className="flex gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : editingId ? "Salvar edicao" : "Cadastrar"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setForm(estampaInicial);
                  setImagemFiles([null, null]);
                  resetImagemInput();
                  setEditingId(null);
                }}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>}
      </section>}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Estampas cadastradas</h3>
            {selectedIds.length > 0 && (
              <p className="mt-1 text-sm text-slate-500">{selectedIds.length} selecionada(s)</p>
            )}
          </div>
          <div className="grid w-full grid-cols-1 gap-2 md:max-w-4xl md:grid-cols-3">
            <label className="w-full text-sm text-slate-700">
              Buscar por codigo
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Digite codigo, descricao ou extra"
              />
            </label>
            <button
              type="button"
              onClick={() => downloadCsv("estampas.csv", buildEstampasImportCsv(estampas))}
              disabled={estampas.length === 0}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:mb-0"
            >
              Exportar CSV
            </button>
            {canEdit && <button
              type="button"
              onClick={() => { setImportErrors([]); setImportItems([]); setImportFileName(""); setImportStep(1); setImportModalOpen(true); }}
              disabled={saving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Importar via CSV
            </button>}
          </div>
        </div>

        {canEdit && <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={verificarSelecionadas}
            disabled={saving || selectedIds.length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Verificar imagens no Storage
          </button>
          <button
            type="button"
            onClick={() => void excluirEstampasSelecionadas()}
            disabled={saving || selectedIds.length === 0}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Excluir selecionadas
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={saving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Limpar selecao
            </button>
          )}
        </div>}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="text-sm text-slate-700">Itens por página
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 100 | 1000 | 99999); setPage(1); }} className="ml-2 rounded-md border border-slate-300 bg-white px-3 py-2">
              <option value={100}>100</option><option value={1000}>1000</option><option value={99999}>99999</option>
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>{estampas.length.toLocaleString("pt-BR")} registro(s) · Página {currentPage} de {totalPages}</span>
            <button type="button" onClick={() => setPage((pagina) => Math.max(1, pagina - 1))} disabled={currentPage === 1} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Anterior</button>
            <button type="button" onClick={() => setPage((pagina) => Math.min(totalPages, pagina + 1))} disabled={currentPage === totalPages} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Próxima</button>
          </div>
        </div>

        <TableEmpty visible={estampas.length === 0} text="Nenhuma estampa encontrada." />
        {estampas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  {canEdit && <th className="p-3">
                    <input
                      type="checkbox"
                      checked={todasSelecionadas}
                      onChange={toggleTodas}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label="Selecionar todas as estampas"
                    />
                  </th>}
                  <th className="p-3">Codigo</th>
                  <th className="p-3">Descricao</th>
                  <th className="p-3">Imagens</th>
                  <th className="p-3">Palavras-chave</th>
                  <th className="p-3">Extra</th>
                  {canEdit && <th className="p-3">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {estampasPaginadas.map((estampa) => (
                  <tr key={estampa.id} className="border-b border-slate-100">
                    {canEdit && <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(estampa.id)}
                        onChange={() => toggleEstampa(estampa.id)}
                        className="h-4 w-4 rounded border-slate-300"
                        aria-label={`Selecionar estampa ${estampa.codigo}`}
                      />
                    </td>}
                    <td className="p-3 font-medium text-slate-700">{estampa.codigo}</td>
                    <td className="p-3 text-slate-700">{estampa.descricao ?? "-"}</td>
                    <td className="p-3 text-slate-700">
                      <div className="flex flex-col gap-1">
                        {estampa.imagemUrl ? (
                          <a
                            href={estampa.imagemUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-700 hover:underline"
                          >
                            Imagem 1
                          </a>
                        ) : null}
                        {estampa.imagemUrl2 ? (
                          <a
                            href={estampa.imagemUrl2}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-700 hover:underline"
                          >
                            Imagem 2
                          </a>
                        ) : null}
                        {!estampa.imagemUrl && !estampa.imagemUrl2 ? "-" : null}
                      </div>
                    </td>
                    <td className="p-3 text-slate-700">{estampa.palavrasChave ?? "-"}</td>
                    <td className="p-3 text-slate-700">{estampa.extra ?? "-"}</td>
                    {canEdit && <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setCadastroAberto(true); onEdit(estampa); }}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCadastroAberto(true); onDuplicate(estampa); }}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(estampa.id)}
                          disabled={saving}
                          className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h3 className="text-base font-semibold text-slate-900">Importar estampas via CSV</h3><p className="text-sm text-slate-500">Etapa {importStep} de 2</p></div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4 p-5">
              {importStep === 1 ? <>
                <p className="text-sm text-slate-600">Selecione um CSV com as colunas Codigo, Descricao, Palavras-chave e Extra. O arquivo exportado pode ser usado como modelo.</p>
                <input type="file" accept=".csv,text/csv" onChange={(event) => void lerArquivoEstampas(event.target.files?.[0] ?? null)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" />
              </> : <>
                <div className={`rounded-md border p-3 text-sm ${importErrors.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                  {importErrors.length ? <><p className="font-semibold">Foram encontrados {importErrors.length} erro(s):</p><ul className="mt-2 list-disc pl-5">{importErrors.map((item) => <li key={item}>{item}</li>)}</ul></> : `${importItems.length} registro(s) validados e prontos para importar.`}
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Código</th><th className="p-3">Descrição</th><th className="p-3">Palavras-chave</th><th className="p-3">Extra</th></tr></thead><tbody>{importItems.map((item, index) => <tr key={`${item.codigo}-${index}`} className="border-t border-slate-100"><td className="p-3">{item.codigo}</td><td className="p-3">{item.descricao || "-"}</td><td className="p-3">{item.palavrasChave || "-"}</td><td className="p-3">{item.extra || "-"}</td></tr>)}</tbody></table></div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setImportStep(1)} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Voltar</button><button type="button" onClick={() => void confirmarImportacaoEstampas()} disabled={saving || importErrors.length > 0 || importItems.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Importando..." : "Confirmar importação"}</button></div>
              </>}
              {importFileName && <p className="text-xs text-slate-500">Arquivo: {importFileName}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function VariantesTab({
  variantes,
  estampas,
  tamanhos,
  form,
  setForm,
  editingId,
  setEditingId,
  busca,
  setBusca,
  saving,
  onSubmit,
  onImport,
  onEdit,
  onDuplicate,
  onDelete,
  onDeleteMany,
  canEdit = true,
}: {
  variantes: VarianteOlist[];
  estampas: EstampaOlist[];
  tamanhos: TamanhoOlist[];
  form: typeof varianteInicial;
  setForm: Dispatch<SetStateAction<typeof varianteInicial>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  busca: string;
  setBusca: Dispatch<SetStateAction<string>>;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onImport: (text: string) => Promise<void>;
  onEdit: (variante: VarianteOlist) => void;
  onDuplicate: (variante: VarianteOlist) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<boolean>;
  canEdit?: boolean;
}) {
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [importItems, setImportItems] = useState<VarianteImportadaInput[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [tamanhoFiltroId, setTamanhoFiltroId] = useState("");
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<100 | 1000 | 99999>(100);
  const [page, setPage] = useState(1);
  const variantesExibidas = useMemo(
    () =>
      tamanhoFiltroId
        ? variantes.filter((variante) => variante.tamanho?.id === tamanhoFiltroId)
        : variantes,
    [tamanhoFiltroId, variantes],
  );
  const totalPages = Math.max(1, Math.ceil(variantesExibidas.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const variantesPaginadas = variantesExibidas.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const todasExibidasSelecionadas =
    variantesPaginadas.length > 0 &&
    variantesPaginadas.every((variante) => selecionadas.includes(variante.id));

  useEffect(() => {
    setPage((pagina) => Math.min(pagina, totalPages));
  }, [totalPages]);

  function toggleVariante(id: string) {
    setSelecionadas((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
  }

  function toggleTodasExibidas() {
    const idsExibidos = variantesPaginadas.map((variante) => variante.id);
    setSelecionadas((ids) =>
      todasExibidasSelecionadas
        ? ids.filter((id) => !idsExibidos.includes(id))
        : Array.from(new Set([...ids, ...idsExibidos])),
    );
  }

  async function excluirSelecionadas() {
    const excluiu = await onDeleteMany(selecionadas);
    if (excluiu) setSelecionadas([]);
  }

  async function lerArquivoVariantes(file: File | null) {
    setImportErrors([]); setImportItems([]); setImportText(""); setImportFileName(file?.name ?? "");
    if (!file) return;
    setImportStep(2);
    try {
      const text = await file.text();
      const items = parseVariantesImport(text);
      const estampasRef = new Set(estampas.map((item) => item.codigo.toUpperCase()));
      const tamanhosRef = new Set(tamanhos.flatMap((item) => [item.sku, item.titulo, item.slug ?? ""]).filter(Boolean).map((value) => value.toUpperCase()));
      const vistos = new Set<string>(); const errors: string[] = [];
      items.forEach((item, index) => {
        const key = `${item.estampaCodigo}:${item.codigo}`;
        if (vistos.has(key)) errors.push(`Linha ${index + 2}: variante ${item.codigo} duplicada para a estampa ${item.estampaCodigo}.`);
        vistos.add(key);
        if (!estampasRef.has(item.estampaCodigo.toUpperCase())) errors.push(`Linha ${index + 2}: estampa ${item.estampaCodigo} não encontrada.`);
        if (!tamanhosRef.has(item.tamanhoRef.toUpperCase())) errors.push(`Linha ${index + 2}: tamanho ${item.tamanhoRef} não encontrado.`);
      });
      setImportText(text); setImportItems(items); setImportErrors(errors);
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Erro ao validar o CSV de variantes."]);
    }
  }

  async function confirmarImportacaoVariantes() {
    if (!importText || importErrors.length || !importItems.length) return;
    try {
      await onImport(importText);
      setImportText(""); setImportItems([]); setImportModalOpen(false); setImportStep(1); setImportFileName("");
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Erro ao importar variantes."]);
    }
  }

  return (
    <div className="space-y-8">
      {canEdit && <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center">
          <button type="button" onClick={() => setCadastroAberto((open) => !open)} className="flex flex-1 items-center justify-between text-left">
            <h3 className="text-lg font-semibold text-slate-900">{editingId ? "Editar variante" : "Cadastrar variante"}</h3>
            <span className={`mr-3 text-xl text-slate-500 transition ${cadastroAberto ? "rotate-180" : ""}`}>⌄</span>
          </button>
        </div>

        {cadastroAberto && <form className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="text-sm text-slate-700">
            Estampa
            <select
              required
              value={form.estampaId}
              onChange={(event) => setForm((prev) => ({ ...prev, estampaId: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Selecione a estampa</option>
              {estampas.map((estampa) => (
                <option key={estampa.id} value={estampa.id}>
                  {estampa.codigo}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Codigo da variante
            <input
              required
              value={form.codigo}
              onChange={(event) => setForm((prev) => ({ ...prev, codigo: event.target.value.toUpperCase() }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
              placeholder="Ex.: TAM-P"
            />
          </label>

          <label className="text-sm text-slate-700">
            Tamanho
            <select
              required
              value={form.tamanhoId}
              onChange={(event) => setForm((prev) => ({ ...prev, tamanhoId: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Selecione o tamanho</option>
              {tamanhos.map((tamanho) => (
                <option key={tamanho.id} value={tamanho.id}>
                  {tamanho.titulo} ({tamanho.sku})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Palavras-chave
            <input
              value={form.palavrasChave}
              onChange={(event) => setForm((prev) => ({ ...prev, palavrasChave: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="tamanho, pequeno, p"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Descricao da variacao
            <textarea
              value={form.descricao}
              onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="flex gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : editingId ? "Salvar edicao" : "Cadastrar"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setForm(varianteInicial);
                  setEditingId(null);
                }}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>}
      </section>}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Variantes cadastradas</h3>
          <div className="grid w-full grid-cols-1 gap-2 md:max-w-3xl md:grid-cols-2">
            <label className="w-full text-sm text-slate-700">
              Buscar por codigo
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Codigo, estampa ou tamanho"
              />
            </label>
            <label className="w-full text-sm text-slate-700">
              Filtrar por tamanho
              <select
                value={tamanhoFiltroId}
                onChange={(event) => setTamanhoFiltroId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Todos os tamanhos</option>
                {tamanhos.map((tamanho) => (
                  <option key={tamanho.id} value={tamanho.id}>
                    {tamanho.titulo} ({tamanho.sku})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2 md:justify-end">
              <button
                type="button"
                onClick={() => downloadCsv("variantes.csv", buildVariantesImportCsv(variantesExibidas))}
                disabled={variantesExibidas.length === 0}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:mb-0"
              >
                Exportar CSV
              </button>
              {canEdit && <button
                type="button"
                onClick={() => { setImportErrors([]); setImportItems([]); setImportFileName(""); setImportStep(1); setImportModalOpen(true); }}
                disabled={saving}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Importar via CSV
              </button>}
            </div>
          </div>
        </div>

        {canEdit && selecionadas.length > 0 && <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <span className="text-sm text-slate-600">{selecionadas.length} variante(s) selecionada(s)</span>
          <button type="button" onClick={() => void excluirSelecionadas()} disabled={saving} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Excluir selecionadas</button>
        </div>}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="text-sm text-slate-700">Itens por página
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 100 | 1000 | 99999); setPage(1); }} className="ml-2 rounded-md border border-slate-300 bg-white px-3 py-2">
              <option value={100}>100</option><option value={1000}>1000</option><option value={99999}>99999</option>
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>{variantesExibidas.length.toLocaleString("pt-BR")} registro(s) · Página {currentPage} de {totalPages}</span>
            <button type="button" onClick={() => setPage((pagina) => Math.max(1, pagina - 1))} disabled={currentPage === 1} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Anterior</button>
            <button type="button" onClick={() => setPage((pagina) => Math.min(totalPages, pagina + 1))} disabled={currentPage === totalPages} className="rounded-md border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">Próxima</button>
          </div>
        </div>

        <TableEmpty visible={variantesExibidas.length === 0} text="Nenhuma variante encontrada." />
        {variantesExibidas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  {canEdit && <th className="p-3"><input type="checkbox" checked={todasExibidasSelecionadas} onChange={toggleTodasExibidas} aria-label="Selecionar todas as variantes exibidas" className="h-4 w-4 rounded border-slate-300" /></th>}
                  <th className="p-3">Codigo</th>
                  <th className="p-3">Estampa</th>
                  <th className="p-3">Tamanho</th>
                  <th className="p-3">Descricao</th>
                  <th className="p-3">Palavras-chave</th>
                  {canEdit && <th className="p-3">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {variantesPaginadas.map((variante) => (
                  <tr key={variante.id} className="border-b border-slate-100">
                    {canEdit && <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar variante ${variante.codigo}`}
                        checked={selecionadas.includes(variante.id)}
                        onChange={() => toggleVariante(variante.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>}
                    <td className="p-3 font-medium text-slate-700">{variante.codigo}</td>
                    <td className="p-3 text-slate-700">{variante.estampa?.codigo ?? "-"}</td>
                    <td className="p-3 text-slate-700">{variante.tamanho?.titulo ?? "-"}</td>
                    <td className="p-3 text-slate-700">{variante.descricao ?? "-"}</td>
                    <td className="p-3 text-slate-700">{variante.palavrasChave ?? "-"}</td>
                    {canEdit && <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setCadastroAberto(true); onEdit(variante); }}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCadastroAberto(true); onDuplicate(variante); }}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(variante.id)}
                          disabled={saving}
                          className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h3 className="text-base font-semibold text-slate-900">Importar variantes via CSV</h3><p className="text-sm text-slate-500">Etapa {importStep} de 2</p></div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4 p-5">
              {importStep === 1 ? <>
                <p className="text-sm text-slate-600">Selecione um CSV com as colunas Codigo, Estampa, Tamanho, Descricao e Palavras-chave. O arquivo exportado pode ser usado como modelo.</p>
                <input type="file" accept=".csv,text/csv" onChange={(event) => void lerArquivoVariantes(event.target.files?.[0] ?? null)} className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm" />
              </> : <>
                <div className={`rounded-md border p-3 text-sm ${importErrors.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                  {importErrors.length ? <><p className="font-semibold">Foram encontrados {importErrors.length} erro(s):</p><ul className="mt-2 list-disc pl-5">{importErrors.map((item) => <li key={item}>{item}</li>)}</ul></> : `${importItems.length} registro(s) validados e prontos para importar.`}
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Código</th><th className="p-3">Estampa</th><th className="p-3">Tamanho</th><th className="p-3">Descrição</th><th className="p-3">Palavras-chave</th></tr></thead><tbody>{importItems.map((item, index) => <tr key={`${item.estampaCodigo}-${item.codigo}-${index}`} className="border-t border-slate-100"><td className="p-3">{item.codigo}</td><td className="p-3">{item.estampaCodigo}</td><td className="p-3">{item.tamanhoRef}</td><td className="p-3">{item.descricao || "-"}</td><td className="p-3">{item.palavrasChave || "-"}</td></tr>)}</tbody></table></div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setImportStep(1)} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Voltar</button><button type="button" onClick={() => void confirmarImportacaoVariantes()} disabled={saving || importErrors.length > 0 || importItems.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Importando..." : "Confirmar importação"}</button></div>
              </>}
              {importFileName && <p className="text-xs text-slate-500">Arquivo: {importFileName}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type GrupoProdutoCriadoVk = {
  id: string;
  sku: string;
  titulo: string;
  categoria: string | null;
  tipoProduto: string;
  estampa: string | null;
  tamanho: string | null;
  createdAt: string;
  produtoBase: ProdutoFinalOlist;
  filhos: ProdutoFinalOlist[];
};

function agruparProdutosCriadosVk(produtos: ProdutoFinalOlist[]) {
  const grupos = new Map<string, GrupoProdutoCriadoVk>();

  for (const produto of produtos) {
    const possuiVariacao = Boolean(produto.variante || produto.tamanho);

    if (!possuiVariacao) {
      grupos.set(`produto:${produto.id}`, {
        id: `produto:${produto.id}`,
        sku: produto.skuFinal,
        titulo: produto.tituloFinal,
        categoria: produto.categoria,
        tipoProduto: produto.tipoProduto.titulo,
        estampa: produto.estampa?.codigo ?? null,
        tamanho: produto.tamanho?.titulo ?? null,
        createdAt: produto.createdAt,
        produtoBase: produto,
        filhos: [],
      });
      continue;
    }

    const skuPai = buildProdutoSku(
      produto.tipoProduto,
      produto.estampa?.codigo ?? "",
      null,
      produto.tamanho?.sku,
    ).toUpperCase();

    const grupoExistente = grupos.get(skuPai);
    if (grupoExistente) {
      grupoExistente.filhos.push(produto);
      continue;
    }

    const tituloPai = montarCamposCsvProdutoOlist(produto, true).find(
      (campo) => campo.campo === "Descrição",
    )?.valor;

    grupos.set(skuPai, {
      id: skuPai,
      sku: skuPai,
      titulo: String(tituloPai || produto.tituloFinal),
      categoria: produto.categoria,
      tipoProduto: produto.tipoProduto.titulo,
      estampa: produto.estampa?.codigo ?? null,
      tamanho: produto.tamanho?.titulo ?? null,
      createdAt: produto.createdAt,
      produtoBase: produto,
      filhos: [produto],
    });
  }

  return Array.from(grupos.values());
}

function ProdutosCriadosVkTab({
  produtos,
  saving,
  onDeleteMany,
}: {
  produtos: ProdutoFinalOlist[];
  saving: boolean;
  onDeleteMany: (ids: string[]) => Promise<boolean>;
}) {
  const [buscaSku, setBuscaSku] = useState("");
  const [buscaTitulo, setBuscaTitulo] = useState("");
  const [tipoProdutoId, setTipoProdutoId] = useState("");
  const [estampaId, setEstampaId] = useState("");
  const [varianteId, setVarianteId] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [gruposSelecionadosIds, setGruposSelecionadosIds] = useState<string[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const grupos = useMemo(() => agruparProdutosCriadosVk(produtos), [produtos]);
  const gruposSelecionados = useMemo(
    () => grupos.filter((grupo) => gruposSelecionadosIds.includes(grupo.id)),
    [grupos, gruposSelecionadosIds],
  );
  const tipos = useMemo(
    () =>
      Array.from(
        new Map(
          produtos.map((produto) => [produto.tipoProduto.id, produto.tipoProduto]),
        ).values(),
      ).sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR")),
    [produtos],
  );
  const estampas = useMemo(
    () => Array.from(
      new Map(
        produtos
          .filter((produto) => produto.estampa)
          .map((produto) => [produto.estampa!.id, produto.estampa!]),
      ).values(),
    ).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR")),
    [produtos],
  );
  const variantes = useMemo(
    () => Array.from(
      new Map(
        produtos
          .filter((produto) => produto.variante)
          .map((produto) => [produto.variante!.id, produto.variante!]),
      ).values(),
    ).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR")),
    [produtos],
  );
  const gruposFiltrados = useMemo(() => {
    const sku = buscaSku.trim().toLocaleLowerCase("pt-BR");
    const titulo = buscaTitulo.trim().toLocaleLowerCase("pt-BR");

    return grupos
      .filter((grupo) => {
        const produtosDoGrupo = grupo.filhos.length > 0 ? grupo.filhos : [grupo.produtoBase];
        const matchSku =
          !sku ||
          grupo.sku.toLocaleLowerCase("pt-BR").includes(sku) ||
          produtosDoGrupo.some((produto) => produto.skuFinal.toLocaleLowerCase("pt-BR").includes(sku));
        const matchTitulo =
          !titulo ||
          grupo.titulo.toLocaleLowerCase("pt-BR").includes(titulo) ||
          produtosDoGrupo.some((produto) =>
            produto.tituloFinal.toLocaleLowerCase("pt-BR").includes(titulo),
          );
        const matchTipo =
          !tipoProdutoId || grupo.produtoBase.tipoProduto.id === tipoProdutoId;
        const matchEstampa =
          !estampaId || grupo.produtoBase.estampa?.id === estampaId;
        const matchVariante =
          !varianteId ||
          produtosDoGrupo.some((produto) =>
            varianteId === "__sem_variante__"
              ? !produto.variante
              : produto.variante?.id === varianteId,
          );

        return matchSku && matchTitulo && matchTipo && matchEstampa && matchVariante;
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sortDirection === "asc" ? diff : -diff;
      });
  }, [
    buscaSku,
    buscaTitulo,
    estampaId,
    grupos,
    sortDirection,
    tipoProdutoId,
    varianteId,
  ]);
  const todosFiltradosSelecionados =
    gruposFiltrados.length > 0 &&
    gruposFiltrados.every((grupo) => gruposSelecionadosIds.includes(grupo.id));

  function toggleSelecionarTodos() {
    const idsFiltrados = gruposFiltrados.map((grupo) => grupo.id);

    setGruposSelecionadosIds((idsSelecionados) =>
      todosFiltradosSelecionados
        ? idsSelecionados.filter((id) => !idsFiltrados.includes(id))
        : Array.from(new Set([...idsSelecionados, ...idsFiltrados])),
    );
  }

  async function excluirSelecionados() {
    if (gruposSelecionados.length === 0) return;

    const produtosIds = gruposSelecionados.flatMap((grupo) =>
      grupo.filhos.length > 0
        ? grupo.filhos.map((filho) => filho.id)
        : [grupo.produtoBase.id],
    );
    const confirmar = window.confirm(
      `Excluir ${gruposSelecionados.length} produto(s) pai V e ${produtosIds.length} registro(s) vinculado(s)?`,
    );
    if (!confirmar) return;

    const excluiu = await onDeleteMany(produtosIds);
    if (excluiu) setGruposSelecionadosIds([]);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Produtos Criados (V/K)</h3>
            <p className="mt-1 text-sm text-slate-600">
              Consulte os produtos pais (V) e expanda cada item para visualizar seus filhos (K).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              disabled={gruposSelecionados.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar selecionados
            </button>
            <button
              type="button"
              onClick={excluirSelecionados}
              disabled={saving || gruposSelecionados.length === 0}
              className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Excluir selecionados
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm text-slate-700">
            Buscar por SKU
            <input
              value={buscaSku}
              onChange={(event) => setBuscaSku(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="SKU final"
            />
          </label>
          <label className="text-sm text-slate-700">
            Buscar por titulo
            <input
              value={buscaTitulo}
              onChange={(event) => setBuscaTitulo(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Titulo final"
            />
          </label>
          <label className="text-sm text-slate-700">
            Tipo de produto
            <select
              value={tipoProdutoId}
              onChange={(event) => setTipoProdutoId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Todos</option>
              {tipos.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.titulo}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Estampa
            <select
              value={estampaId}
              onChange={(event) => setEstampaId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Todas</option>
              {estampas.map((estampa) => (
                <option key={estampa.id} value={estampa.id}>
                  {estampa.codigo}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Variante
            <select
              value={varianteId}
              onChange={(event) => setVarianteId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Todas</option>
              <option value="__sem_variante__">Sem variante</option>
              {variantes.map((variante) => (
                <option key={variante.id} value={variante.id}>
                  {variante.codigo}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Ordenacao
            <select
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="desc">Mais recentes primeiro</option>
              <option value="asc">Mais antigos primeiro</option>
            </select>
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full bg-slate-900 px-3 py-1 text-white">
          {gruposFiltrados.length} produto(s) V
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          {gruposFiltrados.reduce((total, grupo) => total + grupo.filhos.length, 0)} produto(s) K
        </span>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
          {gruposSelecionados.length} V selecionado(s)
        </span>
        <button
          type="button"
          onClick={toggleSelecionarTodos}
          disabled={gruposFiltrados.length === 0}
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {todosFiltradosSelecionados ? "Desmarcar todos" : "Selecionar todos"}
        </button>
      </div>

      <TableEmpty
        visible={gruposFiltrados.length === 0}
        text="Nenhum produto criado encontrado."
      />

      {gruposFiltrados.length > 0 && (
        <div className="space-y-3">
          {gruposFiltrados.map((grupo) => (
            <details key={grupo.id} className="group rounded-lg border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none">
                <span
                  className="flex items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label={`Selecionar produto pai ${grupo.sku}`}
                    checked={gruposSelecionadosIds.includes(grupo.id)}
                    onChange={() =>
                      setGruposSelecionadosIds((ids) =>
                        ids.includes(grupo.id)
                          ? ids.filter((id) => id !== grupo.id)
                          : [...ids, grupo.id],
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  V
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{grupo.titulo}</span>
                  <span className="mt-1 block break-all text-xs text-slate-500">{grupo.sku}</span>
                </span>
                <span className="hidden text-right text-xs text-slate-500 sm:block">
                  {grupo.tipoProduto}
                  <span className="mt-1 block">
                    {grupo.filhos.length} filho(s)
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-lg text-slate-500 transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>

              <div className="border-t border-slate-200 bg-slate-50 p-4">
                {grupo.filhos.length === 0 ? (
                  <p className="text-sm text-slate-500">Este produto V nao possui produtos K.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                          <th className="p-3">Tipo</th>
                          <th className="p-3">SKU</th>
                          <th className="p-3">ID produto Olist</th>
                          <th className="p-3">Titulo</th>
                          <th className="p-3">Categoria</th>
                          <th className="p-3">Preco de custo</th>
                          <th className="p-3">Preco final</th>
                          <th className="p-3">Estampa</th>
                          <th className="p-3">Variante</th>
                          <th className="p-3">Tamanho</th>
                          <th className="p-3">Criado em</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupo.filhos.map((filho) => (
                          <tr key={filho.id} className="border-b border-slate-100 last:border-0">
                            <td className="p-3">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                                K
                              </span>
                            </td>
                            <td className="p-3 font-medium text-slate-700">{filho.skuFinal}</td>
                            <td className="p-3 text-slate-700">
                              {filho.produto?.idCadastroOlist ?? "-"}
                            </td>
                            <td className="p-3 text-slate-700">{filho.tituloFinal}</td>
                            <td className="p-3 text-slate-700">{filho.categoria ?? "-"}</td>
                            <td className="p-3 whitespace-nowrap text-slate-700">
                              {formatMoney(filho.precoCusto)}
                            </td>
                            <td className="p-3 whitespace-nowrap text-slate-700">
                              {formatMoney(filho.preco)}
                            </td>
                            <td className="p-3 text-slate-700">{filho.estampa?.codigo ?? "-"}</td>
                            <td className="p-3 text-slate-700">{filho.variante?.codigo ?? "-"}</td>
                            <td className="p-3 text-slate-700">{filho.tamanho?.titulo ?? "-"}</td>
                            <td className="p-3 whitespace-nowrap text-slate-700">
                              {new Date(filho.createdAt).toLocaleString("pt-BR")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {exportModalOpen && (
        <ExportarProdutosVkModal
          grupos={gruposSelecionados}
          onClose={() => setExportModalOpen(false)}
        />
      )}
    </section>
  );
}

function validarUrlHttp(value: string, campo: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${campo}: informe uma URL http ou https valida.`);
  }
}

function validarQuantidadeImagens(value: number, tipo: "V" | "K") {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`A quantidade de imagens de produtos ${tipo} deve ser um inteiro entre 1 e 6.`);
  }
}

function validarVariaveisPadrao(
  padrao: string,
  permitidas: Array<"ESTAMPA" | "VARIANTE" | "INDEX">,
  tipo: "V" | "K",
) {
  const variaveis = Array.from(padrao.matchAll(/\$\{([^}]+)\}/g), (match) => match[1]);
  const desconhecida = variaveis.find(
    (variavel) => !permitidas.some((permitida) => permitida === variavel),
  );

  if (desconhecida) {
    throw new Error(`Variavel \${${desconhecida}} nao permitida no padrao de produtos ${tipo}.`);
  }
  if (padrao.replace(/\$\{[^}]+\}/g, "").includes("${")) {
    throw new Error(`Existe uma variavel incompleta no padrao de produtos ${tipo}.`);
  }
}

function gerarUrlsExternasProduto(
  padrao: string,
  quantidade: number,
  produto: ProdutoFinalOlist,
  tipo: "V" | "K",
) {
  const estampa = produto.estampa?.codigo?.trim() ?? "";
  const variante = produto.variante?.codigo?.trim() ?? "";

  validarVariaveisPadrao(
    padrao,
    tipo === "V" ? ["ESTAMPA", "INDEX"] : ["ESTAMPA", "VARIANTE", "INDEX"],
    tipo,
  );

  return Array.from({ length: quantidade }, (_, imageIndex) => {
    const index = String(imageIndex + 1);
    const variaveis: Record<string, string> = { ESTAMPA: estampa, VARIANTE: variante, INDEX: index };
    const ausentes: string[] = [];
    const url = padrao.replace(/\$\{([^}]+)\}/g, (_, variavel: string) => {
      const valor = variaveis[variavel] ?? "";
      if (!valor) ausentes.push(variavel);
      return valor;
    });

    if (ausentes.length > 0) {
      throw new Error(
        `Produto ${produto.skuFinal}: nao foi possivel resolver ${ausentes
          .map((variavel) => `\${${variavel}}`)
          .join(", ")}.`,
      );
    }

    validarUrlHttp(url, `Produto ${produto.skuFinal}`);
    return url;
  });
}

function formatExportTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function ExportarProdutosVkModal({
  grupos,
  onClose,
}: {
  grupos: GrupoProdutoCriadoVk[];
  onClose: () => void;
}) {
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [padraoV, setPadraoV] = useState(
    "https://storage.googleapis.com/forro-de-mesa-retangular/LENCO-RELIGIOSO-FOURWAY/${ESTAMPA}/${ESTAMPA}-${INDEX}.jpg",
  );
  const [quantidadeV, setQuantidadeV] = useState(1);
  const [informativoUrl, setInformativoUrl] = useState(
    "https://storage.googleapis.com/forro-de-mesa-retangular/LENCO-RELIGIOSO-FOURWAY/INFORMATIVO.jpg",
  );
  const [padraoK, setPadraoK] = useState(
    "https://storage.googleapis.com/forro-de-mesa-retangular/LENCO-RELIGIOSO-FOURWAY/${ESTAMPA}/${ESTAMPA}-${VARIANTE}-${INDEX}.jpg",
  );
  const [quantidadeK, setQuantidadeK] = useState(1);
  const [componenteId, setComponenteId] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const filhos = useMemo(() => grupos.flatMap((grupo) => grupo.filhos), [grupos]);
  const produtosParaExportar = useMemo(
    () => grupos.flatMap((grupo) => grupo.filhos.length > 0 ? grupo.filhos : [grupo.produtoBase]),
    [grupos],
  );
  const produtosParaKit = useMemo(
    () =>
      grupos.flatMap((grupo) =>
        [...grupo.filhos].sort((a, b) =>
          a.skuFinal.localeCompare(b.skuFinal, "pt-BR", {
            sensitivity: "base",
            numeric: true,
          }),
        ),
      ),
    [grupos],
  );

  function validarEtapa(numero: 1 | 2 | 3) {
    if (grupos.length === 0) throw new Error("Selecione ao menos um produto pai V.");

    if (numero === 1) {
      if (!padraoV.trim()) throw new Error("Informe o padrao da URL das imagens dos produtos V.");
      validarQuantidadeImagens(quantidadeV, "V");
      if (!informativoUrl.trim()) throw new Error("Informe o link da imagem de informativo.");
      if (quantidadeV >= 6) {
        throw new Error(
          "Produtos V aceitam no maximo 5 imagens do padrao, pois o informativo ocupa a proxima posicao.",
        );
      }
      validarUrlHttp(informativoUrl.trim(), "Link da imagem de informativo");
      for (const grupo of grupos) {
        gerarUrlsExternasProduto(padraoV.trim(), quantidadeV, grupo.produtoBase, "V");
      }
    }

    if (numero === 2) {
      if (!padraoK.trim()) throw new Error("Informe o padrao da URL das imagens dos produtos K.");
      validarQuantidadeImagens(quantidadeK, "K");
      validarVariaveisPadrao(padraoK.trim(), ["ESTAMPA", "VARIANTE", "INDEX"], "K");
      for (const filho of filhos) {
        gerarUrlsExternasProduto(padraoK.trim(), quantidadeK, filho, "K");
      }
    }

    if (numero === 3 && !componenteId.trim()) {
      throw new Error("Informe o ID do componente utilizado na fabricacao.");
    }
  }

  function avancar() {
    setErro(null);
    try {
      validarEtapa(etapa);
      if (etapa < 3) setEtapa((etapa + 1) as 2 | 3);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Nao foi possivel avancar.");
    }
  }

  function gerarArquivos() {
    setErro(null);
    try {
      validarEtapa(1);
      validarEtapa(2);
      validarEtapa(3);

      const csvProdutos = montarCsvProdutosOlist(produtosParaExportar, {
        imageUrls: (produto, isParent) =>
          gerarUrlsExternasProduto(
            isParent ? padraoV.trim() : padraoK.trim(),
            isParent ? quantidadeV : quantidadeK,
            produto,
            isParent ? "V" : "K",
          ),
        informativoImageUrl: informativoUrl.trim(),
      });
      const csvKits = montarCsvProdutosFabricadosOlist(produtosParaKit, {
        componenteId: componenteId.trim(),
        quantidade: 1,
      });
      const timestamp = formatExportTimestamp(new Date());

      downloadCsv(`importar_produto_olist_${timestamp}.csv`, csvProdutos);
      downloadCsv(`importar_kit_olist_${timestamp}.csv`, csvKits);
      onClose();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro ao gerar os arquivos.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Exportar produtos selecionados</h3>
            <p className="mt-1 text-sm text-slate-600">Configure imagens e componente em 3 etapas.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>

        <div className="grid grid-cols-3 border-b border-slate-200 text-center text-xs font-medium">
          {["Imagens V", "Imagens K", "Componente e resumo"].map((titulo, index) => {
            const numero = index + 1;
            return (
              <div
                key={titulo}
                className={`px-2 py-3 ${etapa === numero ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-500"}`}
              >
                {numero}. {titulo}
              </div>
            );
          })}
        </div>

        <div className="overflow-y-auto p-5">
          {etapa === 1 && (
            <div className="space-y-5">
              <div>
                <h4 className="font-semibold text-slate-900">Imagens do produto pai (V)</h4>
                <p className="mt-1 text-sm text-slate-600">
                  Variaveis disponiveis: <code>{"${ESTAMPA}"}</code> e <code>{"${INDEX}"}</code> (inicia em 1).
                </p>
              </div>
              <label className="block text-sm text-slate-700">
                Padrao da URL da imagem
                <textarea
                  required
                  value={padraoV}
                  onChange={(event) => setPadraoV(event.target.value)}
                  className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  placeholder="https://storage.googleapis.com/bucket/produto/${ESTAMPA}/${ESTAMPA}-${INDEX}.jpg"
                />
              </label>
              <label className="block text-sm text-slate-700">
                Quantidade de imagens
                <input
                  required
                  type="number"
                  min={1}
                  max={6}
                  step={1}
                  value={quantidadeV}
                  onChange={(event) => setQuantidadeV(Number(event.target.value))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-700">
                Link da imagem de informativo
                <input
                  required
                  type="url"
                  value={informativoUrl}
                  onChange={(event) => setInformativoUrl(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder="https://storage.googleapis.com/bucket/informativo.jpg"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Sera preenchido na primeira coluna URL imagem livre apos as imagens V.
                </span>
              </label>
            </div>
          )}

          {etapa === 2 && (
            <div className="space-y-5">
              <div>
                <h4 className="font-semibold text-slate-900">Imagens dos produtos filhos (K)</h4>
                <p className="mt-1 text-sm text-slate-600">
                  Variaveis disponiveis: <code>{"${ESTAMPA}"}</code>, <code>{"${VARIANTE}"}</code> e <code>{"${INDEX}"}</code> (inicia em 1).
                </p>
              </div>
              <label className="block text-sm text-slate-700">
                Padrao da URL da imagem
                <textarea
                  required
                  value={padraoK}
                  onChange={(event) => setPadraoK(event.target.value)}
                  className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  placeholder="https://storage.googleapis.com/bucket/produto/${ESTAMPA}/${ESTAMPA}-${VARIANTE}-${INDEX}.jpg"
                />
              </label>
              <label className="block text-sm text-slate-700">
                Quantidade de imagens
                <input
                  required
                  type="number"
                  min={1}
                  max={6}
                  step={1}
                  value={quantidadeK}
                  onChange={(event) => setQuantidadeK(Number(event.target.value))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
          )}

          {etapa === 3 && (
            <div className="space-y-5">
              <div>
                <h4 className="font-semibold text-slate-900">Componente utilizado na fabricacao</h4>
                <p className="mt-1 text-sm text-slate-600">
                  O componente sera relacionado a todos os produtos exportados no arquivo de kits.
                </p>
              </div>
              <label className="block text-sm text-slate-700">
                ID do componente
                <input
                  required
                  value={componenteId}
                  onChange={(event) => setComponenteId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder="Ex.: 345775052"
                />
              </label>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h5 className="font-semibold text-slate-900">Resumo da exportacao</h5>
                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-slate-500">Produtos pai V</dt><dd className="font-medium text-slate-900">{grupos.length}</dd></div>
                  <div><dt className="text-slate-500">Produtos filhos K</dt><dd className="font-medium text-slate-900">{filhos.length}</dd></div>
                  <div><dt className="text-slate-500">Imagens por produto V</dt><dd className="font-medium text-slate-900">{quantidadeV}</dd></div>
                  <div><dt className="text-slate-500">Imagens por produto K</dt><dd className="font-medium text-slate-900">{quantidadeK}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-slate-500">ID do componente</dt><dd className="break-all font-medium text-slate-900">{componenteId.trim() || "-"}</dd></div>
                </dl>
              </div>
            </div>
          )}

          {erro && (
            <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-5">
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setEtapa((etapa - 1) as 1 | 2);
            }}
            disabled={etapa === 1}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Voltar
          </button>
          {etapa < 3 ? (
            <button
              type="button"
              onClick={avancar}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Avancar
            </button>
          ) : (
            <button
              type="button"
              onClick={gerarArquivos}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Gerar e baixar arquivos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProdutosCriadosTab({
  produtos,
  tipos,
  estampas,
  variantes,
  saving,
  onSave,
  onDelete,
  onDeleteMany,
  onExportCsv,
  onLinkProdutos,
}: {
  produtos: ProdutoFinalOlist[];
  tipos: TipoProdutoOlist[];
  estampas: EstampaOlist[];
  variantes: VarianteOlist[];
  saving: boolean;
  onSave: (payload: {
    id: string;
    skuFinal: string;
    tituloFinal: string;
    categoria: string;
    precoCusto: string;
    preco: string;
  }) => Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onDeleteMany: (ids: string[]) => Promise<boolean>;
  onExportCsv: (produtos: ProdutoFinalOlist[]) => void;
  onLinkProdutos: (ids: string[]) => Promise<ProdutoFinalOlist[]>;
}) {
  const [buscaSku, setBuscaSku] = useState("");
  const [buscaTitulo, setBuscaTitulo] = useState("");
  const [tipoProdutoId, setTipoProdutoId] = useState("");
  const [estampaId, setEstampaId] = useState("");
  const [varianteId, setVarianteId] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pagina, setPagina] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [produtoEditando, setProdutoEditando] = useState<ProdutoFinalOlist | null>(null);
  const [produtoVisualizando, setProdutoVisualizando] = useState<ProdutoFinalOlist | null>(null);
  const [fabricadoModalOpen, setFabricadoModalOpen] = useState(false);
  const [fabricadoComponenteId, setFabricadoComponenteId] = useState("");
  const [fabricadoQuantidade, setFabricadoQuantidade] = useState("1");
  const [fabricadoErro, setFabricadoErro] = useState<string | null>(null);
  const [fabricadoExportando, setFabricadoExportando] = useState(false);
  const [mockupGerando, setMockupGerando] = useState<number | null>(null);
  const [mockupGerado, setMockupGerado] = useState<{
    dataUrl: string;
    base64: string;
    mockupIndex: number;
    mockupUrl: string;
    estampaUrl: string;
    mode: "preview" | "final";
    quality: MockupQuality;
    fromStorage: boolean;
    replacingExisting?: boolean;
    cacheKey?: number;
    uploadedUrl?: string;
    uploadedPath?: string;
    prompt: string;
  } | null>(null);
  const [mockupUploading, setMockupUploading] = useState(false);
  const [mockupErro, setMockupErro] = useState<string | null>(null);
  const [mockupErroIndex, setMockupErroIndex] = useState<number | null>(null);
  const [mockupUrlsSubstitutas, setMockupUrlsSubstitutas] = useState<Record<number, string>>({});
  const [mockupEstampaUrlSubstituta, setMockupEstampaUrlSubstituta] = useState("");
  const [mockupEstampaNomeArquivo, setMockupEstampaNomeArquivo] = useState<string | null>(null);
  const [mockupEstampaUploading, setMockupEstampaUploading] = useState(false);
  const [mockupPrompt, setMockupPrompt] = useState("");
  const [mockupQuality, setMockupQuality] = useState<MockupQuality>("medium");
  const [csvImageCacheKey, setCsvImageCacheKey] = useState(() => Date.now());
  const [editForm, setEditForm] = useState({
    skuFinal: "",
    tituloFinal: "",
    categoria: "",
    precoCusto: "",
    preco: "",
  });
  const produtosFiltrados = useMemo(() => {
    const sku = buscaSku.trim().toLowerCase();
    const titulo = buscaTitulo.trim().toLowerCase();

    return produtos
      .filter((produto) => {
        const matchSku = !sku || produto.sku.toLowerCase().includes(sku);
        const matchTitulo = !titulo || produto.titulo.toLowerCase().includes(titulo);
        const matchTipo = !tipoProdutoId || produto.tipoProduto.id === tipoProdutoId;
        const matchEstampa = !estampaId || produto.estampa?.id === estampaId;
        const matchVariante =
          !varianteId ||
          (varianteId === "__sem_variante__" ? !produto.variante : produto.variante?.id === varianteId);

        return matchSku && matchTitulo && matchTipo && matchEstampa && matchVariante;
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sortDirection === "asc" ? diff : -diff;
      });
  }, [buscaSku, buscaTitulo, estampaId, produtos, sortDirection, tipoProdutoId, varianteId]);

  const totalPaginas = Math.max(1, Math.ceil(produtosFiltrados.length / pageSize));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const produtosPaginados = produtosFiltrados.slice((paginaAtual - 1) * pageSize, paginaAtual * pageSize);
  const produtosSelecionados = produtos.filter((produto) => selecionados.includes(produto.id));
  const todosDaPaginaSelecionados =
    produtosPaginados.length > 0 && produtosPaginados.every((produto) => selecionados.includes(produto.id));

  function alterarFiltro(callback: () => void) {
    callback();
    setPagina(1);
  }

  function toggleProduto(id: string) {
    setSelecionados((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function togglePagina() {
    const idsPagina = produtosPaginados.map((produto) => produto.id);
    setSelecionados((prev) =>
      todosDaPaginaSelecionados
        ? prev.filter((id) => !idsPagina.includes(id))
        : Array.from(new Set([...prev, ...idsPagina])),
    );
  }

  function abrirEdicao(produto: ProdutoFinalOlist) {
    setProdutoEditando(produto);
    setEditForm({
      skuFinal: produto.skuFinal,
      tituloFinal: produto.tituloFinal,
      categoria: produto.categoria ?? "",
      precoCusto: formatNumberForInput(produto.precoCusto, 2),
      preco: formatNumberForInput(produto.preco, 2),
    });
  }

  function abrirVisualizacao(produto: ProdutoFinalOlist) {
    const defaultPrompt = buildProdutoMockupPrompt({
      nomeProduto: produto.tituloFinal,
      sku: produto.skuFinal,
      tamanho: produto.tamanho?.titulo ?? "",
      descricaoEstampa: produto.estampa?.descricao ?? "",
      descricaoVariante: produto.variante?.descricao ?? "",
      detalhesPromptIa: produto.tipoProduto.detalhesPromptIa ?? "",
    });

    setProdutoVisualizando(produto);
    setMockupGerado(null);
    setMockupErro(null);
    setMockupErroIndex(null);
    setMockupGerando(null);
    setMockupUploading(false);
    setMockupUrlsSubstitutas({});
    setMockupEstampaUrlSubstituta("");
    setMockupEstampaNomeArquivo(null);
    setMockupEstampaUploading(false);
    setMockupPrompt(defaultPrompt);
    setCsvImageCacheKey(Date.now());
  }

  async function colarEstampaMockup(event: ClipboardEvent<HTMLDivElement>) {
    const produto = produtoVisualizando;
    if (!produto) return;

    const file =
      Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/")) ??
      Array.from(event.clipboardData.items)
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();

    if (!file) {
      setMockupErro("Nenhuma imagem encontrada no clipboard.");
      return;
    }

    event.preventDefault();
    setMockupEstampaUploading(true);
    setMockupErro(null);
    setMockupErroIndex(null);

    try {
      const resposta = await uploadEstampaTemporariaMockupOlist({
        produtoId: produto.id,
        file,
      });
      setMockupEstampaUrlSubstituta(resposta.upload.uploadedUrl);
      setMockupEstampaNomeArquivo(file.name || "imagem colada");
    } catch (error) {
      setMockupErro(error instanceof Error ? error.message : "Erro ao colar imagem da estampa.");
    } finally {
      setMockupEstampaUploading(false);
    }
  }

  async function gerarMockup(
    produto: ProdutoFinalOlist,
    mockupIndex: number,
    forceRegenerate = false,
  ) {
    setMockupGerando(mockupIndex);
    setMockupErro(null);
    setMockupErroIndex(null);

    try {
      const mockupUrlOverride = mockupUrlsSubstitutas[mockupIndex]?.trim() || null;
      const estampaUrlOverride = mockupEstampaUrlSubstituta.trim() || null;
      const promptOverride = mockupPrompt.trim() || null;
      const resposta = await gerarMockupProdutoOlist({
        produtoId: produto.id,
        mockupIndex,
        mode: mockupQuality === "high" ? "final" : "preview",
        quality: mockupQuality,
        mockupUrlOverride,
        estampaUrlOverride,
        promptOverride,
        forceRegenerate,
      });
      setMockupGerado({ ...resposta.imagem, mockupIndex, cacheKey: Date.now() });
    } catch (error) {
      setMockupErro(error instanceof Error ? error.message : "Erro ao gerar mockup.");
      setMockupErroIndex(mockupIndex);
    } finally {
      setMockupGerando(null);
    }
  }

  function baixarMockup() {
    if (!mockupGerado || !produtoVisualizando) return;

    const link = document.createElement("a");
    link.href = mockupGerado.dataUrl;
    link.download = `${produtoVisualizando.skuFinal}-mockup-${mockupGerado.mockupIndex}.jpg`;
    link.click();
  }

  async function uploadMockup(produto: ProdutoFinalOlist) {
    if (!mockupGerado) return;
    if (!mockupGerado.base64) {
      setMockupErro("Esta imagem ja esta no Storage.");
      return;
    }

    setMockupUploading(true);
    setMockupErro(null);

    try {
      const resposta = await uploadMockupProdutoOlist({
        produtoId: produto.id,
        mockupIndex: mockupGerado.mockupIndex,
        base64: mockupGerado.base64,
        mimeType: "image/jpeg",
      });
      setMockupGerado((prev) =>
        prev
          ? {
              ...prev,
              uploadedUrl: resposta.upload.uploadedUrl,
              uploadedPath: resposta.upload.uploadedPath,
              cacheKey: Date.now(),
            }
          : prev,
      );
      setCsvImageCacheKey(Date.now());
    } catch (error) {
      setMockupErro(error instanceof Error ? error.message : "Erro ao enviar mockup para o Storage.");
    } finally {
      setMockupUploading(false);
    }
  }

  async function salvarEdicao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!produtoEditando) return;

    await onSave({
      id: produtoEditando.id,
      ...editForm,
    });
    setProdutoEditando(null);
  }

  async function excluirSelecionados() {
    if (produtosSelecionados.length === 0) return;

    const confirmar = window.confirm(`Excluir ${produtosSelecionados.length} produto(s) selecionado(s)?`);
    if (!confirmar) return;

    const excluiu = await onDeleteMany(produtosSelecionados.map((produto) => produto.id));
    if (excluiu) setSelecionados([]);
  }

  async function vincularSelecionados() {
    if (produtosSelecionados.length === 0) return;

    await onLinkProdutos(produtosSelecionados.map((produto) => produto.id));
  }

  function abrirModalFabricado() {
    setFabricadoErro(null);
    setFabricadoModalOpen(true);
  }

  async function exportarFabricado(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFabricadoErro(null);

    const componenteId = fabricadoComponenteId.trim();
    const quantidadeNumber = parseFlexibleDecimalText(fabricadoQuantidade.trim() || "1");

    if (!componenteId) {
      setFabricadoErro("Informe o ID componente.");
      return;
    }
    if (quantidadeNumber === null || quantidadeNumber <= 0) {
      setFabricadoErro("Informe uma quantidade decimal valida.");
      return;
    }

    setFabricadoExportando(true);
    let produtosParaExportar: ProdutoFinalOlist[] = [];

    try {
      produtosParaExportar = produtosSelecionados.some((produto) => !produto.produto?.idCadastroOlist)
        ? await onLinkProdutos(produtosSelecionados.map((produto) => produto.id))
        : produtosSelecionados;
    } finally {
      setFabricadoExportando(false);
    }

    if (produtosParaExportar.length === 0) {
      setFabricadoErro("Nao foi possivel atualizar os produtos selecionados para exportar.");
      return;
    }

    const semProdutoVinculado = produtosParaExportar.filter((produto) => !produto.produto?.idCadastroOlist);

    if (semProdutoVinculado.length > 0) {
      const skus = semProdutoVinculado.map((produto) => produto.skuFinal).join(", ");
      setFabricadoErro(`Estes SKUs ainda precisam ter ID produto Olist vinculado: ${skus}.`);
      return;
    }

    const csv = montarCsvProdutosFabricadosOlist(produtosParaExportar, {
      componenteId,
      quantidade: formatNumberForInput(quantidadeNumber, 4),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "produtos-fabricados-olist.csv";
    link.click();
    URL.revokeObjectURL(url);
    setFabricadoModalOpen(false);
  }

  const mockupErroUrl = mockupErro?.match(/URL:\s*(\S+)/)?.[1] ?? null;
  const mockupErroTipo = mockupErro?.match(/Tipo:\s*(\S+)/)?.[1] ?? null;

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Produtos Criados</h3>
            <p className="mt-1 text-sm text-slate-600">
              Consulte, filtre, edite e exporte os produtos finais gerados.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={excluirSelecionados}
              disabled={saving || produtosSelecionados.length === 0}
              className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Excluir selecionados
            </button>
            <button
              type="button"
              onClick={() => onExportCsv(produtosSelecionados)}
              disabled={produtosSelecionados.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Exportar selecionados CSV
            </button>
            <button
              type="button"
              onClick={abrirModalFabricado}
              disabled={produtosSelecionados.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Exportar CSV Fabricado
            </button>
            <button
              type="button"
              onClick={vincularSelecionados}
              disabled={saving || produtosSelecionados.length === 0}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Salvar vinculo produto
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Buscar por SKU
            <input
              value={buscaSku}
              onChange={(event) => alterarFiltro(() => setBuscaSku(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="SKU final"
            />
          </label>
          <label className="text-sm text-slate-700">
            Buscar por titulo
            <input
              value={buscaTitulo}
              onChange={(event) => alterarFiltro(() => setBuscaTitulo(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Titulo final"
            />
          </label>
          <label className="text-sm text-slate-700">
            Ordenacao
            <select
              value={sortDirection}
              onChange={(event) => alterarFiltro(() => setSortDirection(event.target.value as "asc" | "desc"))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="desc">Mais recentes primeiro</option>
              <option value="asc">Mais antigos primeiro</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Tipo de produto
            <select
              value={tipoProdutoId}
              onChange={(event) => alterarFiltro(() => setTipoProdutoId(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Todos</option>
              {tipos.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>{tipo.titulo}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Estampa
            <select
              value={estampaId}
              onChange={(event) => alterarFiltro(() => setEstampaId(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Todas</option>
              {estampas.map((estampa) => (
                <option key={estampa.id} value={estampa.id}>{estampa.codigo}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Variante
            <select
              value={varianteId}
              onChange={(event) => alterarFiltro(() => setVarianteId(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Todas</option>
              <option value="__sem_variante__">Sem variante</option>
              {variantes.map((variante) => (
                <option key={variante.id} value={variante.id}>{variante.codigo}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">
            Listagem ({produtosFiltrados.length})
          </h3>
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <label className="text-sm text-slate-700">
              Exibir
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPagina(1);
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                {[5, 10, 50, 100, 1000, 2000].map((size) => (
                  <option key={size} value={size}>
                    {size} itens
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-2 text-sm text-slate-600">{selecionados.length} selecionado(s)</p>
          </div>
        </div>

        <TableEmpty visible={produtosFiltrados.length === 0} text="Nenhum produto criado encontrado." />
        {produtosFiltrados.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="p-3">
                      <input type="checkbox" checked={todosDaPaginaSelecionados} onChange={togglePagina} />
                    </th>
                    <th className="p-3">SKU final</th>
                    <th className="p-3">ID produto Olist</th>
                    <th className="p-3">Titulo final</th>
                    <th className="p-3">Categoria</th>
                    <th className="p-3">Preco de custo</th>
                    <th className="p-3">Preco</th>
                    <th className="p-3">Estampa</th>
                    <th className="p-3">Variante</th>
                    <th className="p-3">Tamanho</th>
                    <th className="p-3">Data de criacao</th>
                    <th className="p-3">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosPaginados.map((produto) => (
                    <tr key={produto.id} className="border-b border-slate-100">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selecionados.includes(produto.id)}
                          onChange={() => toggleProduto(produto.id)}
                        />
                      </td>
                      <td className="p-3 font-medium text-slate-700">{produto.skuFinal}</td>
                      <td className="p-3 text-slate-700">{produto.produto?.idCadastroOlist ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.tituloFinal}</td>
                      <td className="p-3 text-slate-700">{produto.categoria ?? "-"}</td>
                      <td className="p-3 text-slate-700">{formatMoney(produto.precoCusto)}</td>
                      <td className="p-3 text-slate-700">{formatMoney(produto.preco)}</td>
                      <td className="p-3 text-slate-700">{produto.estampa?.codigo ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.variante?.codigo ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.tamanho?.titulo ?? "-"}</td>
                      <td className="p-3 text-slate-700">{new Date(produto.createdAt).toLocaleString("pt-BR")}</td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => abrirVisualizacao(produto)}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Visualizar
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirEdicao(produto)}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(produto.id)}
                            disabled={saving}
                            className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPagina((prev) => Math.max(1, prev - 1))}
                disabled={paginaAtual === 1}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
              >
                Anterior
              </button>
              <p className="text-sm text-slate-600">
                Pagina {paginaAtual} de {totalPaginas}
              </p>
              <button
                type="button"
                onClick={() => setPagina((prev) => Math.min(totalPaginas, prev + 1))}
                disabled={paginaAtual === totalPaginas}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
              >
                Proxima
              </button>
            </div>
          </>
        )}
      </section>

      {fabricadoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Exportar como fabricado</h3>
                <a
                  href="https://erp.olist.com/importador_fabricados_kits"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm text-blue-700 hover:underline"
                >
                  Abrir importador de fabricados/kits
                </a>
              </div>
              <button
                type="button"
                onClick={() => setFabricadoModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={exportarFabricado}>
              <label className="block text-sm text-slate-700">
                ID componente
                <input
                  required
                  value={fabricadoComponenteId}
                  onChange={(event) => setFabricadoComponenteId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder="Ex.: 345775052"
                />
              </label>
              <label className="block text-sm text-slate-700">
                Quantidade componente
                <input
                  required
                  inputMode="decimal"
                  value={fabricadoQuantidade}
                  onChange={(event) => setFabricadoQuantidade(event.target.value)}
                  onBlur={() => setFabricadoQuantidade((prev) => normalizeFlexibleDecimalText(prev, 4))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder="1"
                />
              </label>

              {fabricadoErro && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {fabricadoErro}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFabricadoModalOpen(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={fabricadoExportando}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  {fabricadoExportando ? "Exportando..." : "Exportar CSV"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {produtoEditando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Editar produto final</h3>
              <button
                type="button"
                onClick={() => setProdutoEditando(null)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <form className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2" onSubmit={salvarEdicao}>
              <label className="text-sm text-slate-700">
                SKU final
                <input
                  required
                  value={editForm.skuFinal}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, skuFinal: event.target.value.toUpperCase() }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700">
                Categoria
                <input
                  value={editForm.categoria}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, categoria: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700 md:col-span-2">
                Titulo final
                <input
                  required
                  value={editForm.tituloFinal}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, tituloFinal: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700">
                Preco de custo
                <input
                  inputMode="decimal"
                  value={editForm.precoCusto}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, precoCusto: event.target.value }))}
                  onBlur={() => setEditForm((prev) => ({ ...prev, precoCusto: normalizeDecimalText(prev.precoCusto, 2) }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700">
                Preco
                <input
                  inputMode="decimal"
                  value={editForm.preco}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, preco: event.target.value }))}
                  onBlur={() => setEditForm((prev) => ({ ...prev, preco: normalizeDecimalText(prev.preco, 2) }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="flex justify-end gap-2 md:col-span-2">
                <button
                  type="button"
                  onClick={() => setProdutoEditando(null)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {produtoVisualizando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Visualizar produto CSV</h3>
                <p className="mt-1 text-sm text-slate-600">{produtoVisualizando.skuFinal}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProdutoVisualizando(null);
                  setMockupGerado(null);
                  setMockupErro(null);
                  setMockupErroIndex(null);
                  setMockupGerando(null);
                  setMockupUploading(false);
                  setMockupUrlsSubstitutas({});
                  setMockupEstampaUrlSubstituta("");
                  setMockupEstampaNomeArquivo(null);
                  setMockupEstampaUploading(false);
                  setMockupPrompt("");
                }}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="mb-5 space-y-4 rounded-md border border-slate-200 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Mockups OpenAI</h4>
                    <p className="mt-1 text-xs text-slate-600">
                      Selecione o nivel de geracao e escolha o mockup.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Nivel de geracao
                      <select
                        value={mockupQuality}
                        onChange={(event) => setMockupQuality(event.target.value as MockupQuality)}
                        disabled={mockupGerando !== null}
                        className="mt-1 h-9 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:opacity-50"
                      >
                        <option value="low">Baixa (mini)</option>
                        <option value="medium">Media (padrao)</option>
                        <option value="high">Alta (padrao)</option>
                      </select>
                    </label>
                    {[1, 2, 3, 4, 5].map((index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => gerarMockup(produtoVisualizando, index)}
                        disabled={mockupGerando !== null}
                        className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {mockupGerando === index ? "Gerando..." : `Gerar mockup ${index}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div
                    role="button"
                    tabIndex={0}
                    onPaste={colarEstampaMockup}
                    className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-700 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  >
                    <p className="font-medium text-slate-900">Colar imagem da estampa para aplicar no mockup</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Clique aqui e use Ctrl+V ou Cmd+V com a imagem copiada.
                    </p>
                    {mockupEstampaUploading && (
                      <p className="mt-2 text-xs font-medium text-slate-700">Enviando imagem colada...</p>
                    )}
                    {mockupEstampaUrlSubstituta && (
                      <p className="mt-2 break-all text-xs text-blue-700">
                        {mockupEstampaNomeArquivo ? `${mockupEstampaNomeArquivo}: ` : ""}
                        {mockupEstampaUrlSubstituta}
                      </p>
                    )}
                  </div>
                  {mockupEstampaUrlSubstituta && (
                    <button
                      type="button"
                      onClick={() => {
                        setMockupEstampaUrlSubstituta("");
                        setMockupEstampaNomeArquivo(null);
                      }}
                      disabled={mockupGerando !== null || mockupEstampaUploading}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Usar estampa salva no cadastro
                    </button>
                  )}
                </div>

                <label className="block text-xs font-medium text-slate-700">
                  Prompt da geracao
                  <textarea
                    value={mockupPrompt}
                    onChange={(event) => setMockupPrompt(event.target.value)}
                    disabled={mockupGerando !== null}
                    className="mt-1 min-h-72 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:opacity-50"
                  />
                </label>

                {mockupErro && (
                  <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {mockupErro}
                  </p>
                )}

                {mockupErroUrl && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-semibold text-red-800">
                      Imagem nao encontrada{mockupErroTipo ? ` (${mockupErroTipo})` : ""}
                    </p>
                    <a
                      href={mockupErroUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-all text-xs text-blue-700 hover:underline"
                    >
                      {mockupErroUrl}
                    </a>
                    <img
                      src={mockupErroUrl}
                      alt="Imagem que nao foi encontrada no Storage"
                      className="mt-3 h-40 w-40 rounded-md border border-red-200 bg-white object-contain"
                    />
                  </div>
                )}

                {mockupErro?.includes("Nao foi possivel baixar imagem por URL") && mockupErroIndex && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <label className="block text-xs font-medium text-amber-900">
                      URL substituta do mockup {mockupErroIndex}
                      <input
                        type="url"
                        value={mockupUrlsSubstitutas[mockupErroIndex] ?? ""}
                        onChange={(event) =>
                          setMockupUrlsSubstitutas((prev) => ({
                            ...prev,
                            [mockupErroIndex]: event.target.value,
                          }))
                        }
                        placeholder="https://..."
                        className="mt-2 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => gerarMockup(produtoVisualizando, mockupErroIndex)}
                        disabled={mockupGerando !== null || !mockupUrlsSubstitutas[mockupErroIndex]?.trim()}
                        className="rounded-md bg-amber-700 px-3 py-2 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        Tentar preview novamente
                      </button>
                      <span className="text-xs text-amber-900">
                        Essa URL substitui o mockup faltante enviado para a IA.
                      </span>
                    </div>
                  </div>
                )}

                {mockupGerado && (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
                    <img
                      src={withCacheBust(mockupGerado.dataUrl, mockupGerado.cacheKey)}
                      alt={`Mockup gerado para ${produtoVisualizando.skuFinal}`}
                      className="w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
                    />
                    <div className="space-y-2 text-xs text-slate-600">
                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            gerarMockup(produtoVisualizando, mockupGerado.mockupIndex, mockupGerado.fromStorage)
                          }
                          disabled={mockupGerando !== null}
                          className="rounded-md border border-emerald-300 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {mockupGerando === mockupGerado.mockupIndex
                            ? "Gerando..."
                            : mockupGerado.fromStorage
                              ? "Gerar nova imagem"
                              : "Gerar novamente"}
                        </button>
                        <button
                          type="button"
                          onClick={baixarMockup}
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => uploadMockup(produtoVisualizando)}
                          disabled={mockupUploading || !mockupGerado.base64}
                          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          {mockupUploading
                            ? "Enviando..."
                            : !mockupGerado.base64
                              ? "Gere nova imagem para substituir"
                              : mockupGerado.uploadedUrl || mockupGerado.replacingExisting
                              ? "Substituir no Storage"
                              : "Upload no Storage"}
                        </button>
                      </div>
                      <p>
                        <span className="font-semibold text-slate-800">Geracao:</span>{" "}
                        {mockupGerado.fromStorage
                          ? "Arquivo existente no Storage"
                          : MOCKUP_QUALITY_LABELS[mockupGerado.quality]}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Mockup:</span>{" "}
                        <span className="break-all">{mockupGerado.mockupUrl}</span>
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">Estampa:</span>{" "}
                        <span className="break-all">{mockupGerado.estampaUrl}</span>
                      </p>
                      {mockupGerado.uploadedUrl && (
                        <p>
                          <span className="font-semibold text-slate-800">Upload:</span>{" "}
                          <a
                            href={withCacheBust(mockupGerado.uploadedUrl, mockupGerado.cacheKey)}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-blue-700 hover:underline"
                          >
                            {withCacheBust(mockupGerado.uploadedUrl, mockupGerado.cacheKey)}
                          </a>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="w-72 p-3">Campo</th>
                      <th className="p-3">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {montarCamposCsvProdutoOlist(produtoVisualizando, false, { cacheKey: csvImageCacheKey }).map((item) => (
                      <tr key={item.campo} className="border-b border-slate-100 align-top">
                        <td className="p-3 font-medium text-slate-700">{item.campo}</td>
                        <td className="max-w-3xl whitespace-pre-wrap break-words p-3 text-slate-700">
                          {item.valor === "" || item.valor === null || item.valor === undefined ? (
                            "-"
                          ) : item.campo === "Descrição complementar" ? (
                            <div
                              className="prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{ __html: String(item.valor) }}
                            />
                          ) : item.campo.match(/^URL imagem [1-5]$/) ? (
                            <div className="flex items-center gap-3">
                              <img
                                src={String(item.valor)}
                                alt={item.campo}
                                className="h-14 w-14 rounded-md border border-slate-200 object-cover"
                              />
                              <a
                                href={String(item.valor)}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-blue-700 hover:underline"
                              >
                                {String(item.valor)}
                              </a>
                            </div>
                          ) : (
                            String(item.valor)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GerarProdutoKitFinalTab({
  tipos,
  estampas,
  produtos,
  produtosFinais,
  saving,
  onGenerate,
}: {
  tipos: TipoProdutoOlist[];
  estampas: EstampaOlist[];
  produtos: ProdutoKitBaseOlist[];
  produtosFinais: ProdutoFinalOlist[];
  saving: boolean;
  onGenerate: (payload: {
    tipoProdutoId: string;
    estampaId: string;
    skuFinal: string;
    tituloFinal: string;
    descricaoFinal: string;
    precoCusto: string;
    preco: string;
    pesoLiquido: string;
    pesoBruto: string;
    larguraEmbalagem: string;
    alturaEmbalagem: string;
    comprimentoEmbalagem: string;
    componentes: Array<{
      produtoId: string;
      quantidade: string;
    }>;
  }) => Promise<void>;
}) {
  const [tipoProdutoId, setTipoProdutoId] = useState("");
  const [estampaId, setEstampaId] = useState("");
  const [skuFinal, setSkuFinal] = useState("");
  const [tituloFinal, setTituloFinal] = useState("");
  const [descricaoFinal, setDescricaoFinal] = useState("");
  const [buscaProduto, setBuscaProduto] = useState("");
  const [componentes, setComponentes] = useState<Array<{ produtoId: string; quantidade: string }>>([]);
  const [precificacaoForm, setPrecificacaoForm] = useState({
    taxaMktFixa: "6,75",
    impostoPercent: "4,00",
    taxaMktPercent: "15,00",
    campanhasPercent: "15,00",
    margemDesejadaPercent: "10,00",
  });
  const [geracaoForm, setGeracaoForm] = useState({
    preco: "",
    pesoLiquido: "",
    pesoBruto: "",
    larguraEmbalagem: "",
    alturaEmbalagem: "",
    comprimentoEmbalagem: "",
  });
  const produtosPorId = useMemo(() => new Map(produtos.map((produto) => [produto.id, produto])), [produtos]);
  const tipoSelecionado = tipos.find((tipo) => tipo.id === tipoProdutoId) ?? null;
  const produtosFiltrados = useMemo(() => {
    const busca = buscaProduto.trim().toLowerCase();
    const selecionados = new Set(componentes.map((item) => item.produtoId));

    return produtos
      .filter((produto) => !selecionados.has(produto.id))
      .filter((produto) => {
        if (!busca) return true;
        return [produto.sku, produto.produtoOlist?.tituloFinal, produto.produtoFornecido?.produtoFornecedor.nome].some(
          (value) => value?.toLowerCase().includes(busca),
        );
      })
      .slice(0, 25);
  }, [buscaProduto, componentes, produtos]);
  const componentesDetalhados = useMemo(() => {
    return componentes
      .map((item) => {
        const produto = produtosPorId.get(item.produtoId);
        const quantidade = parseFlexibleDecimalText(item.quantidade);
        if (!produto || quantidade === null || quantidade <= 0) return null;

        const custoUnitario =
          produto.produtoOlist?.precoCusto ??
          (produto.produtoFornecido
            ? produto.produtoFornecido.produtoFornecedor.precoUnitarioMetro * produto.produtoFornecido.quantidadeUsada
            : null);
        const pesoLiquidoUnitario =
          produto.produtoOlist?.pesoLiquido ??
          (produto.produtoFornecido?.produtoFornecedor.pesoLiquidoMetro !== null &&
          produto.produtoFornecido?.produtoFornecedor.pesoLiquidoMetro !== undefined
            ? produto.produtoFornecido.produtoFornecedor.pesoLiquidoMetro * produto.produtoFornecido.quantidadeUsada
            : null);
        const pesoBrutoUnitario =
          produto.produtoOlist?.pesoBruto ??
          (produto.produtoFornecido?.produtoFornecedor.pesoBrutoMetro !== null &&
          produto.produtoFornecido?.produtoFornecedor.pesoBrutoMetro !== undefined
            ? produto.produtoFornecido.produtoFornecedor.pesoBrutoMetro * produto.produtoFornecido.quantidadeUsada
            : null);
        const larguraEmbalagemUnitario =
          produto.produtoOlist?.larguraEmbalagem ??
          (produto.produtoFornecido?.produtoFornecedor.larguraEmbalagemMetro !== null &&
          produto.produtoFornecido?.produtoFornecedor.larguraEmbalagemMetro !== undefined
            ? produto.produtoFornecido.produtoFornecedor.larguraEmbalagemMetro * produto.produtoFornecido.quantidadeUsada
            : null);
        const alturaEmbalagemUnitario =
          produto.produtoOlist?.alturaEmbalagem ??
          (produto.produtoFornecido?.produtoFornecedor.alturaEmbalagemMetro !== null &&
          produto.produtoFornecido?.produtoFornecedor.alturaEmbalagemMetro !== undefined
            ? produto.produtoFornecido.produtoFornecedor.alturaEmbalagemMetro * produto.produtoFornecido.quantidadeUsada
            : null);
        const comprimentoEmbalagemUnitario =
          produto.produtoOlist?.comprimentoEmbalagem ??
          (produto.produtoFornecido?.produtoFornecedor.comprimentoEmbalagemMetro !== null &&
          produto.produtoFornecido?.produtoFornecedor.comprimentoEmbalagemMetro !== undefined
            ? produto.produtoFornecido.produtoFornecedor.comprimentoEmbalagemMetro * produto.produtoFornecido.quantidadeUsada
            : null);

        return {
          ...item,
          produto,
          quantidade,
          custoUnitario,
          custoTotal: custoUnitario === null ? null : custoUnitario * quantidade,
          pesoLiquidoTotal: pesoLiquidoUnitario === null ? null : pesoLiquidoUnitario * quantidade,
          pesoBrutoTotal: pesoBrutoUnitario === null ? null : pesoBrutoUnitario * quantidade,
          larguraEmbalagemTotal: larguraEmbalagemUnitario,
          alturaEmbalagemTotal: alturaEmbalagemUnitario === null ? null : alturaEmbalagemUnitario * quantidade,
          comprimentoEmbalagemTotal:
            comprimentoEmbalagemUnitario,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [componentes, produtosPorId]);
  const custoTotal = componentesDetalhados.reduce(
    (total, item) => total + (item.custoTotal ?? 0),
    0,
  );
  const custoCalculado = componentesDetalhados.some((item) => item.custoTotal !== null) ? custoTotal : null;
  const pesoLiquidoCalculado = componentesDetalhados.some((item) => item.pesoLiquidoTotal !== null)
    ? componentesDetalhados.reduce((total, item) => total + (item.pesoLiquidoTotal ?? 0), 0)
    : null;
  const pesoBrutoCalculado = componentesDetalhados.some((item) => item.pesoBrutoTotal !== null)
    ? componentesDetalhados.reduce((total, item) => total + (item.pesoBrutoTotal ?? 0), 0)
    : null;
  const larguraCalculada = componentesDetalhados.some((item) => item.larguraEmbalagemTotal !== null)
    ? componentesDetalhados.reduce((total, item) => total + (item.larguraEmbalagemTotal ?? 0), 0)
    : null;
  const alturaCalculada = componentesDetalhados.some((item) => item.alturaEmbalagemTotal !== null)
    ? componentesDetalhados.reduce((total, item) => total + (item.alturaEmbalagemTotal ?? 0), 0)
    : null;
  const comprimentoCalculado = componentesDetalhados.some((item) => item.comprimentoEmbalagemTotal !== null)
    ? componentesDetalhados.reduce((total, item) => total + (item.comprimentoEmbalagemTotal ?? 0), 0)
    : null;
  const precificacao = useMemo(() => {
    const custo = custoCalculado;
    const taxaMktFixa = parseDecimalText(precificacaoForm.taxaMktFixa);
    const imposto = parsePercentText(precificacaoForm.impostoPercent);
    const taxaMkt = parsePercentText(precificacaoForm.taxaMktPercent);
    const campanhas = parsePercentText(precificacaoForm.campanhasPercent);
    const margemDesejada = parsePercentText(precificacaoForm.margemDesejadaPercent);

    if (
      custo === null ||
      taxaMktFixa === null ||
      imposto === null ||
      taxaMkt === null ||
      campanhas === null ||
      margemDesejada === null
    ) {
      return {
        precoMinimo: null,
        precoSugerido: null,
        lucroPrevisto: null,
        margemPrevista: null,
        impostoValor: null,
        taxaMktValor: null,
        campanhasValor: null,
        denominadorMinimo: null,
        denominadorSugerido: null,
      };
    }

    const denominadorMinimo = 1 - imposto - taxaMkt;
    const denominadorSugerido = 1 - imposto - taxaMkt - campanhas - margemDesejada;
    const precoMinimo = denominadorMinimo > 0 ? (custo + taxaMktFixa) / denominadorMinimo : null;
    const precoSugerido = denominadorSugerido > 0 ? (custo + taxaMktFixa) / denominadorSugerido : null;
    const lucroPrevisto =
      precoSugerido === null
        ? null
        : precoSugerido - custo - taxaMktFixa - precoSugerido * (imposto + taxaMkt + campanhas);

    return {
      precoMinimo,
      precoSugerido,
      lucroPrevisto,
      margemPrevista: precoSugerido && lucroPrevisto !== null ? lucroPrevisto / precoSugerido : null,
      impostoValor: precoSugerido === null ? null : precoSugerido * imposto,
      taxaMktValor: precoSugerido === null ? null : precoSugerido * taxaMkt,
      campanhasValor: precoSugerido === null ? null : precoSugerido * campanhas,
      denominadorMinimo,
      denominadorSugerido,
    };
  }, [custoCalculado, precificacaoForm]);
  const skuKitCalculado = buildKitSku(componentesDetalhados.map((item) => item.produto));
  const skuDuplicado = produtosFinais.some((produto) => produto.skuFinal === skuKitCalculado);

  useEffect(() => {
    const primeiroComVinculo = componentes
      .map((item) => produtosPorId.get(item.produtoId)?.produtoOlist)
      .find(Boolean);

    if (!tipoProdutoId && primeiroComVinculo?.tipoProdutoId) {
      setTipoProdutoId(primeiroComVinculo.tipoProdutoId);
    }
    if (!estampaId && primeiroComVinculo?.estampaId) {
      setEstampaId(primeiroComVinculo.estampaId);
    }
  }, [componentes, estampaId, produtosPorId, tipoProdutoId]);

  useEffect(() => {
    const valoresCalculados = {
      preco: formatNumberForInput(precificacao.precoSugerido, 2),
      pesoLiquido: formatNumberForInput(pesoLiquidoCalculado, 3),
      pesoBruto: formatNumberForInput(pesoBrutoCalculado, 3),
      larguraEmbalagem: formatNumberForInput(larguraCalculada, 2),
      alturaEmbalagem: formatNumberForInput(alturaCalculada, 2),
      comprimentoEmbalagem: formatNumberForInput(comprimentoCalculado, 2),
    };

    setGeracaoForm((prev) =>
      Object.entries(valoresCalculados).every(([key, value]) => prev[key as keyof typeof geracaoForm] === value)
        ? prev
        : { ...prev, ...valoresCalculados },
    );
  }, [alturaCalculada, comprimentoCalculado, larguraCalculada, pesoBrutoCalculado, pesoLiquidoCalculado, precificacao.precoSugerido]);

  useEffect(() => {
    setSkuFinal(skuKitCalculado);
  }, [skuKitCalculado]);

  useEffect(() => {
    if (tituloFinal || componentesDetalhados.length === 0) return;

    setTituloFinal(`Kit ${componentesDetalhados.map((item) => item.produto.sku).join(" + ")}`);
  }, [componentesDetalhados, tituloFinal]);

  function adicionarProduto(produtoId: string) {
    setComponentes((prev) => [...prev, { produtoId, quantidade: "1" }]);
    setBuscaProduto("");
  }

  function removerProduto(produtoId: string) {
    setComponentes((prev) => prev.filter((item) => item.produtoId !== produtoId));
  }

  async function confirmarGeracao() {
    await onGenerate({
      tipoProdutoId,
      estampaId,
      skuFinal: skuKitCalculado,
      tituloFinal,
      descricaoFinal:
        descricaoFinal ||
        `Kit composto por: ${componentesDetalhados
          .map((item) => `${formatDecimal(item.quantidade, 4)} x ${item.produto.sku}`)
          .join("; ")}.`,
      precoCusto: formatNumberForInput(custoCalculado, 2),
      ...geracaoForm,
      componentes,
    });
    setSkuFinal("");
    setTituloFinal("");
    setDescricaoFinal("");
    setComponentes([]);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Gerar Produto Kit Final</h3>
          <p className="mt-1 text-sm text-slate-600">
            Monte um kit com produtos cadastrados, calcule custo e preco, e crie o item em Produtos Criados.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Tipo de Produto
              <select
                value={tipoProdutoId}
                onChange={(event) => setTipoProdutoId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Selecione um tipo</option>
                {tipos.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.titulo}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Estampa base
              <select
                value={estampaId}
                onChange={(event) => setEstampaId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Selecione uma estampa</option>
                {estampas.map((estampa) => (
                  <option key={estampa.id} value={estampa.id}>
                    {estampa.codigo}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              SKU final
              <input
                value={skuFinal}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                placeholder="KIT__SKU1__SKU2"
              />
            </label>
            <label className="text-sm text-slate-700">
              Titulo final
              <input
                value={tituloFinal}
                onChange={(event) => setTituloFinal(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Kit com produtos selecionados"
              />
            </label>
            <label className="text-sm text-slate-700 md:col-span-2">
              Descricao final
              <textarea
                value={descricaoFinal}
                onChange={(event) => setDescricaoFinal(event.target.value)}
                className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Descricao opcional. Se ficar vazio, o sistema lista os componentes do kit."
              />
            </label>
          </div>

          <div>
            <label className="text-sm text-slate-700">
              Buscar produto
              <input
                value={buscaProduto}
                onChange={(event) => setBuscaProduto(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="SKU, titulo vinculado ou produto fornecido"
              />
            </label>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-200">
              {produtosFiltrados.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-600">Nenhum produto disponivel.</p>
              ) : (
                produtosFiltrados.map((produto) => (
                  <button
                    key={produto.id}
                    type="button"
                    onClick={() => adicionarProduto(produto.id)}
                    className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-800">{produto.sku}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {produto.produtoOlist ? "com produto_olist" : "sem produto_olist"}
                    </span>
                    {produto.produtoFornecido && (
                      <span className="block text-xs text-slate-500">
                        {produto.produtoFornecido.produtoFornecedor.nome} - qtd {formatDecimal(produto.produtoFornecido.quantidadeUsada, 4)}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Produtos do kit</h4>
            {componentes.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Selecione produtos para compor o kit.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="p-3">SKU</th>
                      <th className="p-3">Qtd.</th>
                      <th className="p-3">Custo un.</th>
                      <th className="p-3">Custo total</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {componentes.map((item) => {
                      const detalhe = componentesDetalhados.find((detalhado) => detalhado.produtoId === item.produtoId);
                      const produto = produtosPorId.get(item.produtoId);

                      return (
                        <tr key={item.produtoId} className="border-b border-slate-100">
                          <td className="p-3 font-medium text-slate-700">{produto?.sku ?? "-"}</td>
                          <td className="p-3">
                            <input
                              inputMode="decimal"
                              value={item.quantidade}
                              onChange={(event) =>
                                setComponentes((prev) =>
                                  prev.map((componente) =>
                                    componente.produtoId === item.produtoId
                                      ? { ...componente, quantidade: event.target.value }
                                      : componente,
                                  ),
                                )
                              }
                              onBlur={() =>
                                setComponentes((prev) =>
                                  prev.map((componente) =>
                                    componente.produtoId === item.produtoId
                                      ? { ...componente, quantidade: normalizeFlexibleDecimalText(componente.quantidade, 4) }
                                      : componente,
                                  ),
                                )
                              }
                              className="w-24 rounded-md border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="p-3 text-slate-700">{formatMoney(detalhe?.custoUnitario ?? null)}</td>
                          <td className="p-3 text-slate-700">{formatMoney(detalhe?.custoTotal ?? null)}</td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => removerProduto(item.produtoId)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Valores do produto final</h4>
            <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-white p-4 text-sm">
              <div>
                <span className="block text-slate-500">Produto fornecido</span>
                <strong className="text-slate-900">
                  {tipoSelecionado?.produtosFornecidos[0]?.produtoFornecedor
                    ? `${tipoSelecionado.produtosFornecidos[0].produtoFornecedor.nome} - ${tipoSelecionado.produtosFornecidos[0].produtoFornecedor.fornecedorNome}`
                    : "Selecione um tipo com produto fornecido"}
                </strong>
              </div>
              <div>
                <span className="block text-slate-500">Produtos selecionados</span>
                <strong className="text-slate-900">{componentesDetalhados.length}</strong>
              </div>
              <div>
                <span className="block text-slate-500">Preco de custo calculado</span>
                <strong className="text-slate-900">{formatMoney(custoCalculado)}</strong>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { key: "taxaMktFixa", label: "Taxa MKT R$", digits: 2, placeholder: "6,75" },
                { key: "impostoPercent", label: "Imposto %", digits: 2, placeholder: "4,00", valorConvertido: precificacao.impostoValor },
                { key: "taxaMktPercent", label: "Taxa MKT %", digits: 2, placeholder: "15,00", valorConvertido: precificacao.taxaMktValor },
                { key: "campanhasPercent", label: "Campanhas %", digits: 2, placeholder: "15,00", valorConvertido: precificacao.campanhasValor },
                { key: "margemDesejadaPercent", label: "Margem desejada %", digits: 2, placeholder: "10,00" },
              ].map((field) => (
                <label key={field.key} className="text-sm text-slate-700">
                  <span className="flex items-baseline justify-between gap-2">
                    <span>{field.label}</span>
                    {"valorConvertido" in field && (
                      <span className="text-[10px] text-slate-500">{formatMoney(field.valorConvertido ?? null)}</span>
                    )}
                  </span>
                  <input
                    inputMode="decimal"
                    value={precificacaoForm[field.key as keyof typeof precificacaoForm]}
                    onChange={(event) =>
                      setPrecificacaoForm((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                    onBlur={() =>
                      setPrecificacaoForm((prev) => ({
                        ...prev,
                        [field.key]: normalizeDecimalText(prev[field.key as keyof typeof precificacaoForm], field.digits),
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                    placeholder={field.placeholder}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-sm">
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="block text-slate-500">Preco min.</span>
                <strong className="text-slate-900">{formatMoney(precificacao.precoMinimo)}</strong>
                <span className="mt-1 block text-xs text-slate-500">=(custo + taxa fixa) / (1 - imposto - taxa mkt)</span>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="block text-slate-500">Preco sug.</span>
                <strong className="text-slate-900">{formatMoney(precificacao.precoSugerido)}</strong>
                <span className="mt-1 block text-xs text-slate-500">
                  =(custo + taxa fixa) / (1 - imposto - taxa mkt - campanhas - margem)
                </span>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <span className="block text-slate-500">Lucro previsto</span>
                <strong className="text-slate-900">{formatMoney(precificacao.lucroPrevisto)}</strong>
                <span className="mt-1 block text-xs text-slate-500">
                  Margem prevista: {formatDecimal(
                    precificacao.margemPrevista === null ? null : precificacao.margemPrevista * 100,
                    2,
                  )}%
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            {[
              { key: "pesoLiquido", label: "Peso liquido", digits: 3, placeholder: "0,000" },
              { key: "pesoBruto", label: "Peso bruto", digits: 3, placeholder: "0,000" },
              { key: "larguraEmbalagem", label: "Largura da embalagem", digits: 2, placeholder: "0,00" },
              { key: "alturaEmbalagem", label: "Altura da embalagem", digits: 2, placeholder: "0,00" },
              { key: "comprimentoEmbalagem", label: "Comprimento da embalagem", digits: 2, placeholder: "0,00" },
            ].map((field) => (
              <label key={field.key} className="text-sm text-slate-700">
                {field.label}
                <input
                  inputMode="decimal"
                  value={geracaoForm[field.key as keyof typeof geracaoForm]}
                  onChange={(event) => setGeracaoForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  onBlur={() =>
                    setGeracaoForm((prev) => ({
                      ...prev,
                      [field.key]: normalizeDecimalText(prev[field.key as keyof typeof geracaoForm], field.digits),
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                  placeholder={field.placeholder}
                />
              </label>
            ))}
            <label className="text-sm text-slate-700">
              Preco aplicado
              <input
                inputMode="decimal"
                value={geracaoForm.preco}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                placeholder="0,00"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">Todos os valores desta secao serao aplicados no produto kit gerado.</p>
          {skuDuplicado && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Ja existe um produto criado com este SKU; ao confirmar, ele sera sobrescrito.
            </p>
          )}
          <button
            type="button"
            onClick={confirmarGeracao}
            disabled={
              saving ||
              !tipoProdutoId ||
              !estampaId ||
              !skuKitCalculado ||
              !tituloFinal.trim() ||
              componentesDetalhados.length === 0 ||
              custoCalculado === null ||
              !geracaoForm.preco
            }
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Gerando..." : "Criar em Produtos Criados"}
          </button>
        </div>
      </section>
    </div>
  );
}

function GerarProdutoTab({
  tipos,
  estampas,
  variantes,
  tamanhos,
  produtos,
  saving,
  onGenerate,
  onDownloadCsv,
}: {
  tipos: TipoProdutoOlist[];
  estampas: EstampaOlist[];
  variantes: VarianteOlist[];
  tamanhos: TamanhoOlist[];
  produtos: ProdutoFinalOlist[];
  saving: boolean;
  onGenerate: (payload: {
    tipoProdutoId: string;
    estampaIds: string[];
    varianteIds?: string[];
    tamanhoId?: string;
    precoCusto?: string;
    preco?: string;
    pesoLiquido?: string;
    pesoBruto?: string;
    larguraEmbalagem?: string;
    alturaEmbalagem?: string;
    comprimentoEmbalagem?: string;
  }) => Promise<void>;
  onDownloadCsv: () => void;
}) {
  const [modalAberto, setModalAberto] = useState(true);
  const [tipoProdutoId, setTipoProdutoId] = useState("");
  const [produtoSkuBusca, setProdutoSkuBusca] = useState("");
  const [produtoPageSize, setProdutoPageSize] = useState(10);
  const [produtoPagina, setProdutoPagina] = useState(1);
  const [estampaBusca, setEstampaBusca] = useState("");
  const [estampaIds, setEstampaIds] = useState<string[]>([]);
  const [tamanhoId, setTamanhoId] = useState("");
  const [precificacaoForm, setPrecificacaoForm] = useState({
    taxaMktFixa: "6,75",
    impostoPercent: "4,00",
    taxaMktPercent: "15,00",
    campanhasPercent: "15,00",
    margemDesejadaPercent: "10,00",
  });
  const [geracaoForm, setGeracaoForm] = useState({
    preco: "",
    pesoLiquido: "",
    pesoBruto: "",
    larguraEmbalagem: "",
    alturaEmbalagem: "",
    comprimentoEmbalagem: "",
  });
  const totalCombinacoes = estampaIds.reduce((total, estampaId) => {
    return total + variantes.filter(
      (variante) => variante.estampaId === estampaId && variante.tamanhoId === tamanhoId,
    ).length;
  }, 0);
  const valoresGeracaoPreenchidos = Object.values(geracaoForm).every((value) => value.trim());
  const tipoSelecionado = tipos.find((tipo) => tipo.id === tipoProdutoId) ?? null;
  const tamanhoSelecionadoGeracao = tamanhos.find((tamanho) => tamanho.id === tamanhoId) ?? null;
  const produtoFornecedorTipo = tipoSelecionado?.produtosFornecidos[0]?.produtoFornecedor ?? null;
  const custoProdutoFornecido =
    produtoFornecedorTipo && tamanhoSelecionadoGeracao?.quantidadeProdutoFornecedor
      ? produtoFornecedorTipo.precoUnitarioMetro * tamanhoSelecionadoGeracao.quantidadeProdutoFornecedor
      : null;
  const valoresProdutoFornecidoCalculados = useMemo(() => {
    const quantidade = tamanhoSelecionadoGeracao?.quantidadeProdutoFornecedor ?? null;
    const calcularPorMetro = (valorPorMetro: number | null) =>
      produtoFornecedorTipo && quantidade && valorPorMetro !== null ? valorPorMetro * quantidade : null;

    return {
      pesoLiquido: calcularPorMetro(produtoFornecedorTipo?.pesoLiquidoMetro ?? null),
      pesoBruto: calcularPorMetro(produtoFornecedorTipo?.pesoBrutoMetro ?? null),
      larguraEmbalagem: produtoFornecedorTipo?.larguraEmbalagemMetro ?? null,
      alturaEmbalagem: calcularPorMetro(produtoFornecedorTipo?.alturaEmbalagemMetro ?? null),
      comprimentoEmbalagem: produtoFornecedorTipo?.comprimentoEmbalagemMetro ?? null,
    };
  }, [produtoFornecedorTipo, tamanhoSelecionadoGeracao?.quantidadeProdutoFornecedor]);
  const precificacao = useMemo(() => {
    const custo = custoProdutoFornecido;
    const taxaMktFixa = parseDecimalText(precificacaoForm.taxaMktFixa);
    const imposto = parsePercentText(precificacaoForm.impostoPercent);
    const taxaMkt = parsePercentText(precificacaoForm.taxaMktPercent);
    const campanhas = parsePercentText(precificacaoForm.campanhasPercent);
    const margemDesejada = parsePercentText(precificacaoForm.margemDesejadaPercent);

    if (
      custo === null ||
      taxaMktFixa === null ||
      imposto === null ||
      taxaMkt === null ||
      campanhas === null ||
      margemDesejada === null
    ) {
      return {
        precoMinimo: null,
        precoSugerido: null,
        lucroPrevisto: null,
        margemPrevista: null,
        impostoValor: null,
        taxaMktValor: null,
        campanhasValor: null,
        denominadorMinimo: null,
        denominadorSugerido: null,
      };
    }

    const denominadorMinimo = 1 - imposto - taxaMkt;
    const denominadorSugerido = 1 - imposto - taxaMkt - campanhas - margemDesejada;
    const precoMinimo = denominadorMinimo > 0 ? (custo + taxaMktFixa) / denominadorMinimo : null;
    const precoSugerido = denominadorSugerido > 0 ? (custo + taxaMktFixa) / denominadorSugerido : null;
    const lucroPrevisto =
      precoSugerido === null
        ? null
        : precoSugerido - custo - taxaMktFixa - precoSugerido * (imposto + taxaMkt + campanhas);

    return {
      precoMinimo,
      precoSugerido,
      lucroPrevisto,
      margemPrevista: precoSugerido && lucroPrevisto !== null ? lucroPrevisto / precoSugerido : null,
      impostoValor: precoSugerido === null ? null : precoSugerido * imposto,
      taxaMktValor: precoSugerido === null ? null : precoSugerido * taxaMkt,
      campanhasValor: precoSugerido === null ? null : precoSugerido * campanhas,
      denominadorMinimo,
      denominadorSugerido,
    };
  }, [custoProdutoFornecido, precificacaoForm]);
  const precoSugeridoTexto = formatNumberForInput(precificacao.precoSugerido, 2);
  const skusExistentes = useMemo(() => new Set(produtos.map((produto) => produto.sku)), [produtos]);
  const produtosFiltrados = useMemo(() => {
    const busca = produtoSkuBusca.trim().toLowerCase();
    if (!busca) return produtos;

    return produtos.filter((produto) => produto.sku.toLowerCase().includes(busca));
  }, [produtoSkuBusca, produtos]);
  const totalPaginasProdutos = Math.max(1, Math.ceil(produtosFiltrados.length / produtoPageSize));
  const produtoPaginaAtual = Math.min(produtoPagina, totalPaginasProdutos);
  const produtosPaginados = produtosFiltrados.slice(
    (produtoPaginaAtual - 1) * produtoPageSize,
    produtoPaginaAtual * produtoPageSize,
  );
  const previewProdutos = useMemo(() => {
    if (!tipoSelecionado || estampaIds.length === 0) return [];

    return estampaIds.flatMap((estampaId) => {
      const estampa = estampas.find((item) => item.id === estampaId);
      if (!estampa) return [];

      const variantesParaGerar = variantes.filter(
        (variante) => variante.estampaId === estampa.id && variante.tamanhoId === tamanhoId,
      );

      return variantesParaGerar.flatMap((variante) =>
        [tamanhos.find((tamanho) => tamanho.id === variante.tamanhoId) ?? null]
          .filter((tamanho): tamanho is TamanhoOlist => Boolean(tamanho))
          .map((tamanho) => {
          const sku = buildSkuFinal(tipoSelecionado, estampa, variante, tamanho);

          return {
            sku,
            titulo: buildTituloFinal(tipoSelecionado, estampa, variante, tamanho),
            tamanho: tamanho?.titulo ?? "-",
            estampa: estampa.codigo,
            variante: variante?.codigo ?? "-",
            duplicado: skusExistentes.has(sku),
          };
        }),
      );
    });
  }, [estampaIds, estampas, skusExistentes, tamanhoId, tamanhos, tipoSelecionado, variantes]);
  const estampasFiltradas = useMemo(() => {
    const busca = estampaBusca.trim().toLowerCase();

    return estampas.filter((estampa) => {
      const temVarianteNoTamanho =
        !tamanhoId ||
        variantes.some((variante) => variante.estampaId === estampa.id && variante.tamanhoId === tamanhoId);

      if (!temVarianteNoTamanho) return false;
      if (!busca) return true;

      return [estampa.codigo, estampa.descricao, estampa.palavrasChave, estampa.extra].some((value) =>
        value?.toLowerCase().includes(busca),
      );
    });
  }, [estampaBusca, estampas, tamanhoId, variantes]);
  const todasEstampasFiltradasSelecionadas =
    estampasFiltradas.length > 0 && estampasFiltradas.every((estampa) => estampaIds.includes(estampa.id));

  useEffect(() => {
    setProdutoPagina(1);
  }, [produtoPageSize, produtoSkuBusca]);

  useEffect(() => {
    if (!tamanhoId) return;

    const estampasComVarianteNoTamanho = new Set(
      variantes
        .filter((variante) => variante.tamanhoId === tamanhoId)
        .map((variante) => variante.estampaId)
        .filter((estampaId): estampaId is string => Boolean(estampaId)),
    );

    setEstampaIds((selecionados) =>
      selecionados.every((id) => estampasComVarianteNoTamanho.has(id))
        ? selecionados
        : selecionados.filter((id) => estampasComVarianteNoTamanho.has(id)),
    );
  }, [tamanhoId, variantes]);

  useEffect(() => {
    const valoresCalculados = {
      preco: precoSugeridoTexto,
      pesoLiquido: formatNumberForInput(valoresProdutoFornecidoCalculados.pesoLiquido, 3),
      pesoBruto: formatNumberForInput(valoresProdutoFornecidoCalculados.pesoBruto, 3),
      larguraEmbalagem: formatNumberForInput(valoresProdutoFornecidoCalculados.larguraEmbalagem, 2),
      alturaEmbalagem: formatNumberForInput(
        valoresProdutoFornecidoCalculados.alturaEmbalagem === null
          ? null
          : Math.max(1, valoresProdutoFornecidoCalculados.alturaEmbalagem),
        2,
      ),
      comprimentoEmbalagem: formatNumberForInput(valoresProdutoFornecidoCalculados.comprimentoEmbalagem, 2),
    };

    setGeracaoForm((prev) =>
      Object.entries(valoresCalculados).every(([key, value]) => prev[key as keyof typeof geracaoForm] === value)
        ? prev
        : { ...prev, ...valoresCalculados },
    );
  }, [precoSugeridoTexto, valoresProdutoFornecidoCalculados]);

  function toggleSelecionado(id: string, selecionados: string[], setSelecionados: Dispatch<SetStateAction<string[]>>) {
    setSelecionados(
      selecionados.includes(id)
        ? selecionados.filter((item) => item !== id)
        : [...selecionados, id],
    );
  }

  function toggleEstampasFiltradas() {
    const idsFiltrados = estampasFiltradas.map((estampa) => estampa.id);

    setEstampaIds((selecionados) =>
      todasEstampasFiltradasSelecionadas
        ? selecionados.filter((id) => !idsFiltrados.includes(id))
        : Array.from(new Set([...selecionados, ...idsFiltrados])),
    );
  }

  async function confirmarGeracao() {
    await onGenerate({
      tipoProdutoId,
      estampaIds,
      tamanhoId,
      ...geracaoForm,
      precoCusto: formatNumberForInput(custoProdutoFornecido, 2),
    });
    setTipoProdutoId("");
    setEstampaBusca("");
    setEstampaIds([]);
    setTamanhoId("");
    setPrecificacaoForm({
      taxaMktFixa: "6,75",
      impostoPercent: "4,00",
      taxaMktPercent: "15,00",
      campanhasPercent: "15,00",
      margemDesejadaPercent: "10,00",
    });
    setGeracaoForm({
      preco: "",
      pesoLiquido: "",
      pesoBruto: "",
      larguraEmbalagem: "",
      alturaEmbalagem: "",
      comprimentoEmbalagem: "",
    });
  }

  return (
    <div className="space-y-8">
      <section className="hidden rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Produtos finais</h3>
            <p className="mt-1 text-sm text-slate-600">
              Gere combinacoes de tipo de produto, estampas e variantes para exportacao.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setModalAberto(true)}
              disabled={saving || tipos.length === 0 || estampas.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Gerar Produto Final
            </button>
            <button
              type="button"
              onClick={onDownloadCsv}
              disabled={produtos.length === 0}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              Baixar CSV
            </button>
          </div>
        </div>
      </section>

      <section className="hidden rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Produtos finais</h3>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-end">
            <label className="w-full text-sm text-slate-700 md:w-56">
              Filtrar por SKU
              <input
                value={produtoSkuBusca}
                onChange={(event) => setProdutoSkuBusca(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Digite parte do SKU"
              />
            </label>
            <label className="w-full text-sm text-slate-700 md:w-36">
              Exibir
              <select
                value={produtoPageSize}
                onChange={(event) => setProdutoPageSize(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                {[5, 10, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} itens
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <TableEmpty visible={produtos.length === 0} text="Nenhum produto final gerado." />
        {produtos.length > 0 && produtosFiltrados.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            Nenhum produto final encontrado para este SKU.
          </p>
        )}
        {produtosFiltrados.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
              <span>
                Exibindo {(produtoPaginaAtual - 1) * produtoPageSize + 1}-
                {Math.min(produtoPaginaAtual * produtoPageSize, produtosFiltrados.length)} de{" "}
                {produtosFiltrados.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProdutoPagina((pagina) => Math.max(1, pagina - 1))}
                  disabled={produtoPaginaAtual === 1}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="px-2 py-1 text-sm text-slate-600">
                  {produtoPaginaAtual} / {totalPaginasProdutos}
                </span>
                <button
                  type="button"
                  onClick={() => setProdutoPagina((pagina) => Math.min(totalPaginasProdutos, pagina + 1))}
                  disabled={produtoPaginaAtual === totalPaginasProdutos}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
                >
                  Proxima
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="p-3">SKU</th>
                    <th className="p-3">Titulo</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Tamanho</th>
                    <th className="p-3">Estampa</th>
                    <th className="p-3">Variante</th>
                    <th className="p-3">Preco</th>
                    <th className="p-3">Qtd.</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosPaginados.map((produto) => (
                    <tr key={produto.id} className="border-b border-slate-100">
                      <td className="p-3 font-medium text-slate-700">{produto.sku}</td>
                      <td className="p-3 text-slate-700">{produto.titulo}</td>
                      <td className="p-3 text-slate-700">{produto.tipoProduto.nome}</td>
                      <td className="p-3 text-slate-700">{produto.tamanho?.titulo ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.estampa?.nome ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.variante?.nome ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.preco ?? "-"}</td>
                      <td className="p-3 text-slate-700">{produto.quantidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {modalAberto && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex w-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Gerar Produto Final</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Serão geradas apenas as variantes vinculadas as estampas e tamanhos selecionados.
                </p>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <label className="block text-sm text-slate-700">
                Tipo de Produto
                <select
                  required
                  value={tipoProdutoId}
                  onChange={(event) => setTipoProdutoId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  <option value="">Selecione um tipo</option>
                  {tipos.map((tipo) => (
                    <option key={tipo.id} value={tipo.id}>
                      {tipo.titulo}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-1 gap-5">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">Tamanhos</h4>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
                    {tamanhos.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-600">Nenhum tamanho cadastrado.</p>
                    ) : (
                      tamanhos.map((tamanho) => (
                        <label
                          key={tamanho.id}
                          className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-2 text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
                        >
                          <input
                            type="radio"
                            name="tamanho-geracao"
                            checked={tamanhoId === tamanho.id}
                            onChange={() => setTamanhoId(tamanho.id)}
                            className="mt-1"
                          />
                          <span>
                            <span className="font-medium">{tamanho.titulo}</span>
                            <span className="ml-2 text-xs text-slate-500">{tamanho.sku}</span>
                            {tamanho.slug && <span className="block text-xs text-slate-500">{tamanho.slug}</span>}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">
                    Valores do produto final
                  </h4>
                  <div className="mb-3 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-white p-4 text-sm md:grid-cols-3">
                    <div>
                      <span className="block text-slate-500">Produto fornecido</span>
                      <strong className="text-slate-900">
                        {produtoFornecedorTipo
                          ? `${produtoFornecedorTipo.nome} - ${produtoFornecedorTipo.fornecedorNome}`
                          : "Selecione um tipo com produto fornecido"}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">Quantidade do tamanho</span>
                      <strong className="text-slate-900">
                        {formatDecimal(tamanhoSelecionadoGeracao?.quantidadeProdutoFornecedor ?? null, 4)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">Preco de custo calculado</span>
                      <strong className="text-slate-900">{formatMoney(custoProdutoFornecido)}</strong>
                    </div>
                  </div>
                  <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                      {[
                        { key: "taxaMktFixa", label: "Taxa MKT R$", digits: 2, placeholder: "6,75" },
                        {
                          key: "impostoPercent",
                          label: "Imposto %",
                          digits: 2,
                          placeholder: "4,00",
                          valorConvertido: precificacao.impostoValor,
                        },
                        {
                          key: "taxaMktPercent",
                          label: "Taxa MKT %",
                          digits: 2,
                          placeholder: "15,00",
                          valorConvertido: precificacao.taxaMktValor,
                        },
                        {
                          key: "campanhasPercent",
                          label: "Campanhas %",
                          digits: 2,
                          placeholder: "15,00",
                          valorConvertido: precificacao.campanhasValor,
                        },
                        { key: "margemDesejadaPercent", label: "Margem desejada %", digits: 2, placeholder: "10,00" },
                      ].map((field) => (
                        <label key={field.key} className="text-sm text-slate-700">
                          <span className="flex items-baseline justify-between gap-2">
                            <span>{field.label}</span>
                            {"valorConvertido" in field && (
                              <span className="text-[10px] font-normal text-slate-500">
                                {formatMoney(field.valorConvertido ?? null)}
                              </span>
                            )}
                          </span>
                          <input
                            inputMode="decimal"
                            value={precificacaoForm[field.key as keyof typeof precificacaoForm]}
                            onChange={(event) =>
                              setPrecificacaoForm((prev) => ({
                                ...prev,
                                [field.key]: event.target.value,
                              }))
                            }
                            onBlur={() =>
                              setPrecificacaoForm((prev) => ({
                                ...prev,
                                [field.key]: normalizeDecimalText(
                                  prev[field.key as keyof typeof precificacaoForm],
                                  field.digits,
                                ),
                              }))
                            }
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                            placeholder={field.placeholder}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <span className="block text-slate-500">Preco min.</span>
                        <strong className="text-slate-900">{formatMoney(precificacao.precoMinimo)}</strong>
                        <span className="mt-1 block text-xs text-slate-500">=(custo + taxa fixa) / (1 - imposto - taxa mkt)</span>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <span className="block text-slate-500">Preco sug.</span>
                        <strong className="text-slate-900">{formatMoney(precificacao.precoSugerido)}</strong>
                        <span className="mt-1 block text-xs text-slate-500">
                          =(custo + taxa fixa) / (1 - imposto - taxa mkt - campanhas - margem)
                        </span>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <span className="block text-slate-500">Lucro previsto</span>
                        <strong className="text-slate-900">{formatMoney(precificacao.lucroPrevisto)}</strong>
                        <span className="mt-1 block text-xs text-slate-500">
                          Margem prevista: {formatDecimal(
                            precificacao.margemPrevista === null ? null : precificacao.margemPrevista * 100,
                            2,
                          )}%
                        </span>
                      </div>
                    </div>
                    {(precificacao.denominadorMinimo !== null && precificacao.denominadorMinimo <= 0) ||
                    (precificacao.denominadorSugerido !== null && precificacao.denominadorSugerido <= 0) ? (
                      <p className="mt-3 text-xs text-red-600">
                        Revise os percentuais: a soma das taxas nao pode deixar o denominador menor ou igual a zero.
                      </p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                    {[
                      { key: "pesoLiquido", label: "Peso liquido", digits: 3, placeholder: "0,000" },
                      { key: "pesoBruto", label: "Peso bruto", digits: 3, placeholder: "0,000" },
                      { key: "larguraEmbalagem", label: "Largura da embalagem", digits: 2, placeholder: "0,00" },
                      { key: "alturaEmbalagem", label: "Altura da embalagem", digits: 2, placeholder: "1,00" },
                      { key: "comprimentoEmbalagem", label: "Comprimento da embalagem", digits: 2, placeholder: "0,00" },
                    ].map((field) => (
                      <label key={field.key} className="text-sm text-slate-700">
                        {field.label}
                        <input
                          inputMode="decimal"
                          value={geracaoForm[field.key as keyof typeof geracaoForm]}
                          onChange={(event) =>
                            setGeracaoForm((prev) => ({
                              ...prev,
                              [field.key]: event.target.value,
                            }))
                          }
                          onBlur={() =>
                            setGeracaoForm((prev) => ({
                              ...prev,
                              [field.key]: field.key === "alturaEmbalagem"
                                ? formatNumberForInput(
                                    Math.max(
                                      1,
                                      parseDecimalText(prev.alturaEmbalagem) ?? 1,
                                    ),
                                    field.digits,
                                  )
                                : normalizeDecimalText(
                                    prev[field.key as keyof typeof geracaoForm],
                                    field.digits,
                                  ),
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                          placeholder={field.placeholder}
                        />
                      </label>
                    ))}
                    <label className="text-sm text-slate-700">
                      Preco aplicado
                      <input
                        inputMode="decimal"
                        value={geracaoForm.preco}
                        readOnly
                        className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                        placeholder="0,00"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Todos os valores desta secao serao aplicados em cada produto gerado.
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Estampas</h4>
                    <div className="flex w-full flex-col gap-2 md:max-w-sm">
                      <label className="text-xs font-medium text-slate-700">
                        Filtrar estampas
                        <input
                          value={estampaBusca}
                          onChange={(event) => setEstampaBusca(event.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          placeholder="Codigo, descricao, palavra-chave ou extra"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={todasEstampasFiltradasSelecionadas}
                          onChange={toggleEstampasFiltradas}
                          disabled={estampasFiltradas.length === 0}
                        />
                        Marcar estampas filtradas
                      </label>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                    {estampasFiltradas.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-600">Nenhuma estampa encontrada.</p>
                    ) : (
                      estampasFiltradas.map((estampa) => (
                        <label
                          key={estampa.id}
                          className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-2 text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={estampaIds.includes(estampa.id)}
                            onChange={() => toggleSelecionado(estampa.id, estampaIds, setEstampaIds)}
                            className="mt-1"
                          />
                          <span>
                            <span className="font-medium">{estampa.codigo}</span>
                            <span className="ml-2 text-xs text-slate-500">
                              {variantes.filter(
                                (variante) => variante.estampaId === estampa.id && variante.tamanhoId === tamanhoId,
                              ).length} variante(s)
                            </span>
                            {estampa.descricao && (
                              <span className="block text-xs text-slate-500">{estampa.descricao}</span>
                            )}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {estampaIds.length} selecionada(s) de {estampas.length}
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-600">
                Produtos a gerar: <strong>{totalCombinacoes}</strong>
              </p>

              {previewProdutos.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">Previa dos produtos</h4>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                          <th className="p-3">SKU final</th>
                          <th className="p-3">Titulo final</th>
                          <th className="p-3">Tamanho</th>
                          <th className="p-3">Estampa</th>
                          <th className="p-3">Variante</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewProdutos.map((produto) => (
                          <tr key={`${produto.sku}-${produto.titulo}`} className="border-b border-slate-100">
                            <td className="p-3 font-medium text-slate-700">{produto.sku}</td>
                            <td className="p-3 text-slate-700">{produto.titulo}</td>
                            <td className="p-3 text-slate-700">{produto.tamanho}</td>
                            <td className="p-3 text-slate-700">{produto.estampa}</td>
                            <td className="p-3 text-slate-700">{produto.variante}</td>
                            <td className={`p-3 ${produto.duplicado ? "text-amber-700" : "text-emerald-700"}`}>
                              {produto.duplicado ? "Sobrescrever" : "Pronto"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 p-5">
              <button
                type="button"
                onClick={confirmarGeracao}
                disabled={
                  saving ||
                  !tipoProdutoId ||
                  estampaIds.length === 0 ||
                  !tamanhoId ||
                  !produtoFornecedorTipo ||
                  custoProdutoFornecido === null ||
                  !valoresGeracaoPreenchidos ||
                  previewProdutos.length === 0
                }
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Gerando..." : "Confirmar geracao"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function TableEmpty({ visible, text }: { visible: boolean; text: string }) {
  if (!visible) return null;
  return <p className="text-sm text-slate-600">{text}</p>;
}
