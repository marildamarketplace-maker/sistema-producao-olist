"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  EstampaOlist,
  GeradorCsvOlistData,
  ProdutoFornecedorOlist,
  ProdutoFinalOlist,
  TamanhoOlist,
  TipoProdutoOlist,
  VarianteOlist,
  carregarGeradorCsvOlist,
  excluirEstampaOlist,
  excluirProdutoFinalOlist,
  excluirTamanhoOlist,
  excluirTipoProdutoOlist,
  excluirVarianteOlist,
  gerarProdutoFinalOlist,
  gerarMockupProdutoOlist,
  montarCamposCsvProdutoOlist,
  montarCsvProdutosFabricadosOlist,
  montarCsvProdutosOlist,
  salvarEstampaOlist,
  salvarProdutoFinalOlist,
  salvarTamanhoOlist,
  salvarTipoProdutoOlist,
  salvarVarianteOlist,
  uploadImagemEstampaOlist,
  uploadMockupProdutoOlist,
  verificarImagensEstampasOlist,
  vincularProdutosFinaisOlist,
} from "@/lib/gerador-csv-olist";

type Aba = "tipos" | "tamanhos" | "estampas" | "variantes" | "gerar" | "produtos";
type MockupQuality = "low" | "medium" | "high";

const ABAS: { id: Aba; label: string }[] = [
  { id: "tipos", label: "Tipos de Produto" },
  { id: "tamanhos", label: "Tamanho" },
  { id: "estampas", label: "Estampas" },
  { id: "variantes", label: "Variantes" },
  { id: "gerar", label: "Gerar Produto Final" },
  { id: "produtos", label: "Produtos Criados" },
];

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

const tipoInicial = {
  titulo: "",
  sku: "",
  descricao: "",
  descricaoSeo: "",
  palavrasChave: "",
  detalhesPromptIa: "",
  slug: "",
  categoria: "",
  produtosFornecidos: [] as Array<{
    produtoFornecedorId: string;
    quantidadeUsada: string;
  }>,
};

const estampaInicial = {
  codigo: "",
  descricao: "",
  palavrasChave: "",
  extra: "",
};

const varianteInicial = {
  estampaId: "",
  tamanhoId: "",
  codigo: "",
  descricao: "",
  palavrasChave: "",
};

const tamanhoInicial = {
  titulo: "",
  sku: "",
  slug: "",
  quantidadeProdutoFornecedor: "",
};

type EstampaImportadaInput = {
  codigo: string;
  descricao: string | null;
  palavrasChave: string | null;
  extra: string | null;
};

type VarianteImportadaInput = {
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

function buildSkuFinal(
  tipoProduto: TipoProdutoOlist,
  estampa: EstampaOlist,
  variante: VarianteOlist | null,
  tamanho: TamanhoOlist | null = null,
) {
  return [tipoProduto.sku, tamanho?.sku, estampa.codigo, variante?.codigo]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(cleanSkuPart)
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

function withCopySuffix(value: string | null | undefined, suffix = "-COPIA") {
  const base = value?.trim();
  return base ? `${base}${suffix}` : "";
}

function withSlugCopySuffix(value: string | null | undefined) {
  return withCopySuffix(value, "-copia");
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
    "codigo;descricao;palavras-chave;extra",
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
    "codigo;estampa;tamanho;descricao;palavras-chave",
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

function parseEstampasImport(text: string): EstampaImportadaInput[] {
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

function parseVariantesImport(text: string): VarianteImportadaInput[] {
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
  const [abaAtiva, setAbaAtiva] = useState<Aba>("tipos");
  const [dados, setDados] = useState<GeradorCsvOlistData>({
    tiposProduto: [],
    produtosFornecedor: [],
    estampas: [],
    variantes: [],
    tamanhos: [],
    produtosFinais: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tipoForm, setTipoForm] = useState(tipoInicial);
  const [tipoEditId, setTipoEditId] = useState<string | null>(null);
  const [estampaForm, setEstampaForm] = useState(estampaInicial);
  const [estampaEditId, setEstampaEditId] = useState<string | null>(null);
  const [estampaImagemFiles, setEstampaImagemFiles] = useState<[File | null, File | null]>([null, null]);
  const [estampaImagemInputKey, setEstampaImagemInputKey] = useState(0);
  const [estampaBusca, setEstampaBusca] = useState("");
  const [varianteForm, setVarianteForm] = useState(varianteInicial);
  const [varianteEditId, setVarianteEditId] = useState<string | null>(null);
  const [varianteBusca, setVarianteBusca] = useState("");
  const [tamanhoForm, setTamanhoForm] = useState(tamanhoInicial);
  const [tamanhoEditId, setTamanhoEditId] = useState<string | null>(null);
  const [tamanhoBusca, setTamanhoBusca] = useState("");

  const tiposAtivos = useMemo(
    () => dados.tiposProduto.filter((tipo) => tipo.ativo),
    [dados.tiposProduto],
  );
  const estampasAtivas = useMemo(
    () => dados.estampas.filter((estampa) => estampa.ativo),
    [dados.estampas],
  );
  const estampasFiltradas = useMemo(() => {
    const busca = estampaBusca.trim().toLowerCase();
    if (!busca) return dados.estampas;

    return dados.estampas.filter((estampa) =>
      [estampa.codigo, estampa.descricao, estampa.palavrasChave, estampa.extra].some((value) =>
        value?.toLowerCase().includes(busca),
      ),
    );
  }, [dados.estampas, estampaBusca]);
  const variantesAtivas = useMemo(
    () => dados.variantes.filter((variante) => variante.ativo),
    [dados.variantes],
  );
  const tamanhosAtivos = useMemo(
    () => dados.tamanhos.filter((tamanho) => tamanho.ativo),
    [dados.tamanhos],
  );
  const tamanhosFiltrados = useMemo(() => {
    const busca = tamanhoBusca.trim().toLowerCase();
    if (!busca) return dados.tamanhos;

    return dados.tamanhos.filter((tamanho) =>
      [tamanho.titulo, tamanho.sku, tamanho.slug].some((value) => value?.toLowerCase().includes(busca)),
    );
  }, [dados.tamanhos, tamanhoBusca]);
  const variantesFiltradas = useMemo(() => {
    const busca = varianteBusca.trim().toLowerCase();
    if (!busca) return dados.variantes;

    return dados.variantes.filter((variante) =>
      [variante.codigo, variante.estampa?.codigo, variante.tamanho?.titulo, variante.tamanho?.sku]
        .some((value) => value?.toLowerCase().includes(busca)),
    );
  }, [dados.variantes, varianteBusca]);

  async function carregar() {
    setLoading(true);
    setErrorMessage(null);

    try {
      const resposta = await carregarGeradorCsvOlist();
      setDados(resposta);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  function toNumberOrNull(value: string) {
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    if (!normalized) return null;
    const numberValue = Number(normalized);

    if (Number.isNaN(numberValue) || numberValue < 0) {
      throw new Error("Preencha precos e medidas com numeros validos maiores ou iguais a zero.");
    }

    return numberValue;
  }

  async function salvarTipo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const titulo = tipoForm.titulo.trim();
      const sku = buildSkuFromTitle(tipoForm.sku || titulo);
      const slug = buildSlugPart(tipoForm.slug || titulo);

      if (!titulo || !sku) {
        throw new Error("Preencha o Titulo para gerar SKU e slug.");
      }
      if (!tipoForm.produtosFornecidos[0]?.produtoFornecedorId) {
        throw new Error("Selecione o produto fornecido do tipo de produto.");
      }

      await salvarTipoProdutoOlist({
        id: tipoEditId,
        titulo,
        sku,
        descricao: tipoForm.descricao || null,
        descricaoSeo: tipoForm.descricaoSeo || null,
        palavrasChave: tipoForm.palavrasChave || null,
        detalhesPromptIa: tipoForm.detalhesPromptIa || null,
        slug: slug || null,
        categoria: tipoForm.categoria || null,
        produtosFornecidos: tipoForm.produtosFornecidos.slice(0, 1).map((item) => ({
          produtoFornecedorId: item.produtoFornecedorId,
          quantidadeUsada: 1,
        })),
      });
      setTipoForm(tipoInicial);
      setTipoEditId(null);
      setMessage("Tipo de produto salvo com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar tipo.");
    } finally {
      setSaving(false);
    }
  }

  async function salvarEstampa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const codigo = estampaForm.codigo.trim().toUpperCase();
      if (!codigo) {
        throw new Error("Preencha o codigo da estampa.");
      }

      const codigoDuplicado = dados.estampas.some(
        (estampa) => estampa.codigo.toUpperCase() === codigo && estampa.id !== estampaEditId,
      );
      if (codigoDuplicado) {
        throw new Error("Ja existe uma estampa cadastrada com este codigo.");
      }

      const resposta = await salvarEstampaOlist({
        id: estampaEditId,
        codigo,
        descricao: estampaForm.descricao || null,
        palavrasChave: estampaForm.palavrasChave || null,
        extra: estampaForm.extra || null,
      });
      const imagensSelecionadas = estampaImagemFiles.filter((file): file is File => Boolean(file));
      for (const [index, file] of estampaImagemFiles.entries()) {
        if (file) {
          await uploadImagemEstampaOlist({
            id: resposta.estampa.id,
            codigo: resposta.estampa.codigo,
            file,
            index: index as 0 | 1,
          });
        }
      }
      setEstampaForm(estampaInicial);
      setEstampaEditId(null);
      setEstampaImagemFiles([null, null]);
      setEstampaImagemInputKey((key) => key + 1);
      setMessage(
        imagensSelecionadas.length
          ? `Estampa e ${imagensSelecionadas.length} imagem(ns) salvas com sucesso.`
          : "Estampa salva com sucesso.",
      );
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar estampa.");
    } finally {
      setSaving(false);
    }
  }

  async function importarEstampas(text: string) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const estampas = parseEstampasImport(text);
      const codigosImportados = new Set<string>();
      const codigosDuplicadosNoArquivo = estampas
        .map((estampa) => estampa.codigo)
        .filter((codigo) => {
          if (codigosImportados.has(codigo)) return true;
          codigosImportados.add(codigo);
          return false;
        });

      if (codigosDuplicadosNoArquivo.length) {
        throw new Error(`Codigos duplicados no arquivo: ${Array.from(new Set(codigosDuplicadosNoArquivo)).join(", ")}.`);
      }

      const estampasPorCodigo = new Map(dados.estampas.map((estampa) => [estampa.codigo.toUpperCase(), estampa]));
      const totalAtualizadas = estampas.filter((estampa) => estampasPorCodigo.has(estampa.codigo)).length;
      const totalCriadas = estampas.length - totalAtualizadas;

      await Promise.all(
        estampas.map((estampa) =>
          salvarEstampaOlist({
            id: estampasPorCodigo.get(estampa.codigo)?.id ?? null,
            ...estampa,
          }),
        ),
      );
      setMessage(`${totalCriadas} estampa(s) criada(s) e ${totalAtualizadas} substituida(s) com sucesso.`);
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao importar estampas.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function verificarImagensEstampas(ids: string[]) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const resultado = await verificarImagensEstampasOlist(ids);
      setMessage(
        `Verificacao concluida: ${resultado.totalVerificadas} estampa(s), ` +
          `${resultado.imagem0Encontradas} imagem(ns) 0 e ${resultado.imagem1Encontradas} imagem(ns) 1 encontradas. ` +
          `${resultado.estampasAtualizadas} estampa(s) atualizada(s).`,
      );
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao verificar imagens das estampas.");
    } finally {
      setSaving(false);
    }
  }

  async function salvarVariante(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const codigo = varianteForm.codigo.trim().toUpperCase();
      const estampaId = varianteForm.estampaId;
      const tamanhoId = varianteForm.tamanhoId;
      if (!estampaId) {
        throw new Error("Selecione a estampa da variante.");
      }
      if (!tamanhoId) {
        throw new Error("Selecione o tamanho da variante.");
      }
      if (!codigo) {
        throw new Error("Preencha o codigo da variante.");
      }

      const codigoDuplicado = dados.variantes.some(
        (variante) =>
          variante.estampaId === estampaId &&
          variante.codigo.toUpperCase() === codigo &&
          variante.id !== varianteEditId,
      );
      if (codigoDuplicado) {
        throw new Error("Ja existe uma variante cadastrada com este codigo para esta estampa.");
      }

      await salvarVarianteOlist({
        id: varianteEditId,
        estampaId,
        tamanhoId,
        codigo,
        descricao: varianteForm.descricao || null,
        palavrasChave: varianteForm.palavrasChave || null,
      });
      setVarianteForm(varianteInicial);
      setVarianteEditId(null);
      setMessage("Variante salva com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar variante.");
    } finally {
      setSaving(false);
    }
  }

  async function importarVariantes(text: string) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const variantes = parseVariantesImport(text);
      const estampasPorCodigo = new Map(dados.estampas.map((estampa) => [estampa.codigo.toUpperCase(), estampa]));
      const tamanhosPorRef = new Map<string, TamanhoOlist>();

      dados.tamanhos.forEach((tamanho) => {
        tamanhosPorRef.set(tamanho.sku.toUpperCase(), tamanho);
        tamanhosPorRef.set(tamanho.titulo.toUpperCase(), tamanho);
        if (tamanho.slug) {
          tamanhosPorRef.set(tamanho.slug.toUpperCase(), tamanho);
        }
      });

      const variantesResolvidas = variantes.map((variante, index) => {
        const estampa = estampasPorCodigo.get(variante.estampaCodigo);
        const tamanho = tamanhosPorRef.get(variante.tamanhoRef.toUpperCase());

        if (!estampa) {
          throw new Error(`Linha ${index + 1}: estampa nao encontrada (${variante.estampaCodigo}).`);
        }
        if (!tamanho) {
          throw new Error(`Linha ${index + 1}: tamanho nao encontrado (${variante.tamanhoRef}).`);
        }

        return {
          codigo: variante.codigo,
          estampaId: estampa.id,
          tamanhoId: tamanho.id,
          descricao: variante.descricao,
          palavrasChave: variante.palavrasChave,
        };
      });

      const chavesImportadas = new Set<string>();
      const chavesDuplicadasNoArquivo = variantesResolvidas
        .map((variante) => `${variante.estampaId}:${variante.codigo}`)
        .filter((chave) => {
          if (chavesImportadas.has(chave)) return true;
          chavesImportadas.add(chave);
          return false;
        });

      if (chavesDuplicadasNoArquivo.length) {
        throw new Error("Existem variantes duplicadas no arquivo para a mesma estampa e codigo.");
      }

      const variantesPorChave = new Map(
        dados.variantes.map((variante) => [`${variante.estampaId}:${variante.codigo.toUpperCase()}`, variante]),
      );
      const totalAtualizadas = variantesResolvidas.filter((variante) =>
        variantesPorChave.has(`${variante.estampaId}:${variante.codigo}`),
      ).length;
      const totalCriadas = variantesResolvidas.length - totalAtualizadas;

      await Promise.all(
        variantesResolvidas.map((variante) =>
          salvarVarianteOlist({
            id: variantesPorChave.get(`${variante.estampaId}:${variante.codigo}`)?.id ?? null,
            ...variante,
          }),
        ),
      );
      setMessage(`${totalCriadas} variante(s) criada(s) e ${totalAtualizadas} substituida(s) com sucesso.`);
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao importar variantes.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function salvarTamanho(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const titulo = tamanhoForm.titulo.trim();
      const sku = tamanhoForm.sku.trim().toUpperCase();
      if (!titulo || !sku) {
        throw new Error("Preencha os campos obrigatorios: Titulo e SKU.");
      }

      const skuDuplicado = dados.tamanhos.some(
        (tamanho) => tamanho.sku.toUpperCase() === sku && tamanho.id !== tamanhoEditId,
      );
      if (skuDuplicado) {
        throw new Error("Ja existe um tamanho cadastrado com este SKU.");
      }
      if (!tamanhoForm.quantidadeProdutoFornecedor) {
        throw new Error("Informe a quantidade usada do produto fornecido.");
      }

      await salvarTamanhoOlist({
        id: tamanhoEditId,
        titulo,
        sku,
        slug: tamanhoForm.slug || null,
        quantidadeProdutoFornecedor: toNumberOrNull(tamanhoForm.quantidadeProdutoFornecedor) ?? 0,
      });
      setTamanhoForm(tamanhoInicial);
      setTamanhoEditId(null);
      setMessage("Tamanho salvo com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar tamanho.");
    } finally {
      setSaving(false);
    }
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

      const tamanhoId = payload.tamanhoId;
      const skusNovos = new Set<string>();
      const combinacoes = [];

      for (const estampaId of payload.estampaIds) {
        const estampa = dados.estampas.find((item) => item.id === estampaId);
        if (!estampa) continue;

        const variantesParaGerar = dados.variantes.filter(
          (item) => item.estampaId === estampa.id && item.tamanhoId === tamanhoId,
        );

        for (const variante of variantesParaGerar) {
          const tamanho = dados.tamanhos.find((item) => item.id === variante.tamanhoId) ?? null;
          if (!tamanho) continue;
          const skuFinal = buildSkuFinal(tipoProduto, estampa, variante, tamanho);

          if (skusNovos.has(skuFinal)) {
            throw new Error(`A selecao atual gera SKU duplicado: ${skuFinal}.`);
          }

          skusNovos.add(skuFinal);
          combinacoes.push({ estampa, variante, tamanho });
        }
      }

      if (combinacoes.length === 0) {
        throw new Error("Nenhuma variante encontrada para as estampas e tamanhos selecionados.");
      }

      let totalGerado = 0;
      let totalSobrescrito = 0;

      for (const combinacao of combinacoes) {
        const skuFinal = buildSkuFinal(tipoProduto, combinacao.estampa, combinacao.variante, combinacao.tamanho);
        const jaExiste = dados.produtosFinais.some((produto) => produto.sku === skuFinal);

        await gerarProdutoFinalOlist({
          tipoProdutoId: tipoProduto.id,
          estampaId: combinacao.estampa.id,
          varianteId: combinacao.variante?.id ?? null,
          tamanhoId: combinacao.tamanho?.id ?? null,
          precoCusto: toNumberOrNull(payload.precoCusto ?? ""),
          preco: toNumberOrNull(payload.preco ?? ""),
          pesoLiquido: toNumberOrNull(payload.pesoLiquido ?? ""),
          pesoBruto: toNumberOrNull(payload.pesoBruto ?? ""),
          larguraEmbalagem: toNumberOrNull(payload.larguraEmbalagem ?? ""),
          alturaEmbalagem: toNumberOrNull(payload.alturaEmbalagem ?? ""),
          comprimentoEmbalagem: toNumberOrNull(payload.comprimentoEmbalagem ?? ""),
        });

        if (jaExiste) {
          totalSobrescrito += 1;
        } else {
          totalGerado += 1;
        }
      }

      setMessage(`${totalGerado} produto(s) criado(s) e ${totalSobrescrito} sobrescrito(s) com sucesso.`);
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao gerar produtos.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  function editarTipo(tipo: TipoProdutoOlist) {
    setTipoEditId(tipo.id);
    setTipoForm({
      titulo: tipo.titulo,
      sku: tipo.sku,
      descricao: tipo.descricao ?? "",
      descricaoSeo: tipo.descricaoSeo ?? "",
      palavrasChave: tipo.palavrasChave ?? "",
      detalhesPromptIa: tipo.detalhesPromptIa ?? "",
      slug: tipo.slug ?? "",
      categoria: tipo.categoria ?? "",
      produtosFornecidos: tipo.produtosFornecidos.map((item) => ({
        produtoFornecedorId: item.produtoFornecedorId,
        quantidadeUsada: formatNumberForInput(item.quantidadeUsada, 4),
      })),
    });
  }

  function duplicarTipo(tipo: TipoProdutoOlist) {
    setTipoEditId(null);
    setTipoForm({
      titulo: `${tipo.titulo} Copia`,
      sku: withCopySuffix(tipo.sku),
      descricao: tipo.descricao ?? "",
      descricaoSeo: tipo.descricaoSeo ?? "",
      palavrasChave: tipo.palavrasChave ?? "",
      detalhesPromptIa: tipo.detalhesPromptIa ?? "",
      slug: withSlugCopySuffix(tipo.slug),
      categoria: tipo.categoria ?? "",
      produtosFornecidos: tipo.produtosFornecidos.map((item) => ({
        produtoFornecedorId: item.produtoFornecedorId,
        quantidadeUsada: formatNumberForInput(item.quantidadeUsada, 4),
      })),
    });
  }

  async function excluirTipo(id: string) {
    const confirmar = window.confirm("Excluir este tipo de produto?");
    if (!confirmar) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await excluirTipoProdutoOlist(id);
      if (tipoEditId === id) {
        setTipoForm(tipoInicial);
        setTipoEditId(null);
      }
      setMessage("Tipo de produto excluido com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao excluir tipo.");
    } finally {
      setSaving(false);
    }
  }

  function editarEstampa(estampa: EstampaOlist) {
    setEstampaEditId(estampa.id);
    setEstampaForm({
      codigo: estampa.codigo,
      descricao: estampa.descricao ?? "",
      palavrasChave: estampa.palavrasChave ?? "",
      extra: estampa.extra ?? "",
    });
    setEstampaImagemFiles([null, null]);
    setEstampaImagemInputKey((key) => key + 1);
  }

  function duplicarEstampa(estampa: EstampaOlist) {
    setEstampaEditId(null);
    setEstampaForm({
      codigo: withCopySuffix(estampa.codigo),
      descricao: estampa.descricao ?? "",
      palavrasChave: estampa.palavrasChave ?? "",
      extra: estampa.extra ?? "",
    });
    setEstampaImagemFiles([null, null]);
    setEstampaImagemInputKey((key) => key + 1);
  }

  async function excluirEstampa(id: string) {
    const confirmar = window.confirm("Excluir esta estampa?");
    if (!confirmar) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await excluirEstampaOlist(id);
      if (estampaEditId === id) {
        setEstampaForm(estampaInicial);
        setEstampaEditId(null);
        setEstampaImagemFiles([null, null]);
        setEstampaImagemInputKey((key) => key + 1);
      }
      setMessage("Estampa excluida com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao excluir estampa.");
    } finally {
      setSaving(false);
    }
  }

  function editarVariante(variante: VarianteOlist) {
    setVarianteEditId(variante.id);
    setVarianteForm({
      estampaId: variante.estampaId ?? "",
      tamanhoId: variante.tamanhoId ?? "",
      codigo: variante.codigo,
      descricao: variante.descricao ?? "",
      palavrasChave: variante.palavrasChave ?? "",
    });
  }

  function duplicarVariante(variante: VarianteOlist) {
    setVarianteEditId(null);
    setVarianteForm({
      estampaId: variante.estampaId ?? "",
      tamanhoId: variante.tamanhoId ?? "",
      codigo: withCopySuffix(variante.codigo),
      descricao: variante.descricao ?? "",
      palavrasChave: variante.palavrasChave ?? "",
    });
  }

  function editarTamanho(tamanho: TamanhoOlist) {
    setTamanhoEditId(tamanho.id);
    setTamanhoForm({
      titulo: tamanho.titulo,
      sku: tamanho.sku,
      slug: tamanho.slug ?? "",
      quantidadeProdutoFornecedor: formatNumberForInput(tamanho.quantidadeProdutoFornecedor, 4),
    });
  }

  function duplicarTamanho(tamanho: TamanhoOlist) {
    setTamanhoEditId(null);
    setTamanhoForm({
      titulo: `${tamanho.titulo} Copia`,
      sku: withCopySuffix(tamanho.sku),
      slug: withSlugCopySuffix(tamanho.slug),
      quantidadeProdutoFornecedor: formatNumberForInput(tamanho.quantidadeProdutoFornecedor, 4),
    });
  }

  async function excluirTamanho(id: string) {
    const confirmar = window.confirm("Excluir este tamanho?");
    if (!confirmar) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await excluirTamanhoOlist(id);
      if (tamanhoEditId === id) {
        setTamanhoForm(tamanhoInicial);
        setTamanhoEditId(null);
      }
      setMessage("Tamanho excluido com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao excluir tamanho.");
    } finally {
      setSaving(false);
    }
  }

  async function excluirVariante(id: string) {
    const confirmar = window.confirm("Excluir esta variante?");
    if (!confirmar) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await excluirVarianteOlist(id);
      if (varianteEditId === id) {
        setVarianteForm(varianteInicial);
        setVarianteEditId(null);
      }
      setMessage("Variante excluida com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao excluir variante.");
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

  async function excluirProdutoFinalSemConfirmar(id: string) {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await excluirProdutoFinalOlist(id);
      setMessage("Produto final excluido com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao excluir produto final.");
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
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao vincular produtos.");
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
              onClick={() => setAbaAtiva(aba.id)}
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
          {abaAtiva === "tipos" && (
            <TiposProdutoTab
              tipos={dados.tiposProduto}
              produtosFornecedor={dados.produtosFornecedor}
              form={tipoForm}
              setForm={setTipoForm}
              editingId={tipoEditId}
              setEditingId={setTipoEditId}
              saving={saving}
              onSubmit={salvarTipo}
              onEdit={editarTipo}
              onDuplicate={duplicarTipo}
              onDelete={excluirTipo}
            />
          )}

          {abaAtiva === "tamanhos" && (
            <TamanhosTab
              tamanhos={tamanhosFiltrados}
              form={tamanhoForm}
              setForm={setTamanhoForm}
              editingId={tamanhoEditId}
              setEditingId={setTamanhoEditId}
              busca={tamanhoBusca}
              setBusca={setTamanhoBusca}
              saving={saving}
              onSubmit={salvarTamanho}
              onEdit={editarTamanho}
              onDuplicate={duplicarTamanho}
              onDelete={excluirTamanho}
            />
          )}

          {abaAtiva === "estampas" && (
            <EstampasTab
              estampas={estampasFiltradas}
              form={estampaForm}
              setForm={setEstampaForm}
              imagemFiles={estampaImagemFiles}
              setImagemFiles={setEstampaImagemFiles}
              imagemInputKey={estampaImagemInputKey}
              resetImagemInput={() => setEstampaImagemInputKey((key) => key + 1)}
              editingId={estampaEditId}
              setEditingId={setEstampaEditId}
              busca={estampaBusca}
              setBusca={setEstampaBusca}
              saving={saving}
              onSubmit={salvarEstampa}
              onImport={importarEstampas}
              onVerifyImages={verificarImagensEstampas}
              onEdit={editarEstampa}
              onDuplicate={duplicarEstampa}
              onDelete={excluirEstampa}
            />
          )}

          {abaAtiva === "variantes" && (
            <VariantesTab
              variantes={variantesFiltradas}
              estampas={estampasAtivas}
              tamanhos={tamanhosAtivos}
              form={varianteForm}
              setForm={setVarianteForm}
              editingId={varianteEditId}
              setEditingId={setVarianteEditId}
              busca={varianteBusca}
              setBusca={setVarianteBusca}
              saving={saving}
              onSubmit={salvarVariante}
              onImport={importarVariantes}
              onEdit={editarVariante}
              onDuplicate={duplicarVariante}
              onDelete={excluirVariante}
            />
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
        </>
      )}
    </div>
  );
}

function TiposProdutoTab({
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
}) {
  type TipoProdutoTextField = Exclude<keyof typeof tipoInicial, "produtosFornecidos">;
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
  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          {editingId ? "Editar tipo de produto" : "Cadastrar tipo de produto"}
        </h3>
        <form className="grid grid-cols-1 gap-4 md:grid-cols-4" onSubmit={onSubmit}>
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
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Tipos cadastrados</h3>
        <TableEmpty visible={tipos.length === 0} text="Nenhum tipo de produto cadastrado." />
        {tipos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Titulo</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Categoria</th>
                  <th className="p-3">Produto fornecido</th>
                  <th className="p-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {tipos.map((tipo) => (
                  <tr key={tipo.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-700">
                      <div>{tipo.titulo}</div>
                      <div className="mt-1 text-xs text-slate-500">{tipo.slug ?? "-"}</div>
                    </td>
                    <td className="p-3 text-slate-700">{tipo.sku}</td>
                    <td className="p-3 text-slate-700">{tipo.categoria ?? "-"}</td>
                    <td className="p-3 text-slate-700">
                      {tipo.produtosFornecidos[0]?.produtoFornecedor.nome ?? "-"}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(tipo)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDuplicate(tipo)}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TamanhosTab({
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
}) {
  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          {editingId ? "Editar tamanho" : "Cadastrar tamanho"}
        </h3>
        <form className="grid grid-cols-1 gap-4 md:grid-cols-3" onSubmit={onSubmit}>
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
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Tamanhos cadastrados</h3>
          <label className="w-full text-sm text-slate-700 md:max-w-xs">
            Buscar
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Titulo, SKU ou slug"
            />
          </label>
        </div>

        <TableEmpty visible={tamanhos.length === 0} text="Nenhum tamanho encontrado." />
        {tamanhos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Titulo</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Slug</th>
                  <th className="p-3">Quantidade usada</th>
                  <th className="p-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {tamanhos.map((tamanho) => (
                  <tr key={tamanho.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-700">{tamanho.titulo}</td>
                    <td className="p-3 text-slate-700">{tamanho.sku}</td>
                    <td className="p-3 text-slate-700">{tamanho.slug ?? "-"}</td>
                    <td className="p-3 text-slate-700">
                      {formatDecimal(tamanho.quantidadeProdutoFornecedor, 4)}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(tamanho)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicate(tamanho)}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EstampasTab({
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
}) {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const estampasIds = useMemo(() => estampas.map((estampa) => estampa.id), [estampas]);
  const todasSelecionadas =
    estampasIds.length > 0 && estampasIds.every((id) => selectedIds.includes(id));

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

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError(null);

    try {
      await onImport(importText);
      setImportText("");
      setImportModalOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Erro ao importar estampas.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            {editingId ? "Editar estampa" : "Cadastrar estampa"}
          </h3>
          <button
            type="button"
            onClick={() => {
              setImportError(null);
              setImportModalOpen(true);
            }}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Importar em lote
          </button>
        </div>

        <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={onSubmit}>
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
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Estampas cadastradas</h3>
            {selectedIds.length > 0 && (
              <p className="mt-1 text-sm text-slate-500">{selectedIds.length} selecionada(s)</p>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 md:max-w-md md:flex-row md:items-end">
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
              onClick={() => downloadCsv("estampas-importacao.csv", buildEstampasImportCsv(estampas))}
              disabled={estampas.length === 0}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:mb-0"
            >
              Exportar CSV
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={verificarSelecionadas}
            disabled={saving || selectedIds.length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Verificar imagens no Storage
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
        </div>

        <TableEmpty visible={estampas.length === 0} text="Nenhuma estampa encontrada." />
        {estampas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">
                    <input
                      type="checkbox"
                      checked={todasSelecionadas}
                      onChange={toggleTodas}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label="Selecionar todas as estampas"
                    />
                  </th>
                  <th className="p-3">Codigo</th>
                  <th className="p-3">Descricao</th>
                  <th className="p-3">Imagens</th>
                  <th className="p-3">Palavras-chave</th>
                  <th className="p-3">Extra</th>
                  <th className="p-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {estampas.map((estampa) => (
                  <tr key={estampa.id} className="border-b border-slate-100">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(estampa.id)}
                        onChange={() => toggleEstampa(estampa.id)}
                        className="h-4 w-4 rounded border-slate-300"
                        aria-label={`Selecionar estampa ${estampa.codigo}`}
                      />
                    </td>
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
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(estampa)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicate(estampa)}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Importar estampas</h3>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={submitImport}>
              <label className="block text-sm text-slate-700">
                Codigo;Descricao;Palavras-chave;Extra
                <textarea
                  required
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  className="mt-2 min-h-64 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder={"FLR-001;Floral azul;floral, azul, primavera;tecido claro\nFLR-002;Folhagem verde;folhagem, verde;tropical"}
                />
              </label>

              {importError && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {importError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Importando..." : "Importar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function VariantesTab({
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
}) {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError(null);

    try {
      await onImport(importText);
      setImportText("");
      setImportModalOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Erro ao importar variantes.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            {editingId ? "Editar variante" : "Cadastrar variante"}
          </h3>
          <button
            type="button"
            onClick={() => {
              setImportError(null);
              setImportModalOpen(true);
            }}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Importar em lote
          </button>
        </div>

        <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={onSubmit}>
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
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Variantes cadastradas</h3>
          <div className="flex w-full flex-col gap-2 md:max-w-md md:flex-row md:items-end">
            <label className="w-full text-sm text-slate-700">
              Buscar por codigo
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Codigo, estampa ou tamanho"
              />
            </label>
            <button
              type="button"
              onClick={() => downloadCsv("variantes-importacao.csv", buildVariantesImportCsv(variantes))}
              disabled={variantes.length === 0}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:mb-0"
            >
              Exportar CSV
            </button>
          </div>
        </div>

        <TableEmpty visible={variantes.length === 0} text="Nenhuma variante encontrada." />
        {variantes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Codigo</th>
                  <th className="p-3">Estampa</th>
                  <th className="p-3">Tamanho</th>
                  <th className="p-3">Descricao</th>
                  <th className="p-3">Palavras-chave</th>
                  <th className="p-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {variantes.map((variante) => (
                  <tr key={variante.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-700">{variante.codigo}</td>
                    <td className="p-3 text-slate-700">{variante.estampa?.codigo ?? "-"}</td>
                    <td className="p-3 text-slate-700">{variante.tamanho?.titulo ?? "-"}</td>
                    <td className="p-3 text-slate-700">{variante.descricao ?? "-"}</td>
                    <td className="p-3 text-slate-700">{variante.palavrasChave ?? "-"}</td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(variante)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicate(variante)}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Importar variantes</h3>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <form className="space-y-4 p-5" onSubmit={submitImport}>
              <label className="block text-sm text-slate-700">
                Codigo;Estampa;Tamanho;Descricao;Palavras-chave
                <textarea
                  required
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  className="mt-2 min-h-64 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder={"VAR-001;FLR-001;P;Versao pequena;pequeno, p\nVAR-002;FLR-001;M;Versao media;medio, m"}
                />
              </label>

              {importError && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {importError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Importando..." : "Importar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
  onDeleteMany: (id: string) => void | Promise<void>;
  onExportCsv: (produtos: ProdutoFinalOlist[]) => void;
  onLinkProdutos: (ids: string[]) => void | Promise<void>;
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
    setProdutoVisualizando(produto);
    setMockupGerado(null);
    setMockupErro(null);
    setMockupErroIndex(null);
    setMockupGerando(null);
    setMockupUploading(false);
    setMockupUrlsSubstitutas({});
    setCsvImageCacheKey(Date.now());
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
      const resposta = await gerarMockupProdutoOlist({
        produtoId: produto.id,
        mockupIndex,
        mode: mockupQuality === "high" ? "final" : "preview",
        quality: mockupQuality,
        mockupUrlOverride,
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

    for (const produto of produtosSelecionados) {
      await onDeleteMany(produto.id);
    }

    setSelecionados([]);
  }

  async function vincularSelecionados() {
    if (produtosSelecionados.length === 0) return;

    await onLinkProdutos(produtosSelecionados.map((produto) => produto.id));
  }

  function abrirModalFabricado() {
    setFabricadoErro(null);
    setFabricadoModalOpen(true);
  }

  function exportarFabricado(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFabricadoErro(null);

    const componenteId = fabricadoComponenteId.trim();
    const quantidadeNumber = parseFlexibleDecimalText(fabricadoQuantidade.trim() || "1");
    const semProdutoVinculado = produtosSelecionados.filter((produto) => !produto.produto?.idCadastroOlist);

    if (!componenteId) {
      setFabricadoErro("Informe o ID componente.");
      return;
    }
    if (quantidadeNumber === null || quantidadeNumber <= 0) {
      setFabricadoErro("Informe uma quantidade decimal valida.");
      return;
    }
    if (semProdutoVinculado.length > 0) {
      setFabricadoErro("Todos os produtos selecionados precisam ter ID produto Olist vinculado.");
      return;
    }

    const csv = montarCsvProdutosFabricadosOlist(produtosSelecionados, {
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
                {[5, 10, 50, 100].map((size) => (
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
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Exportar CSV
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

                {mockupErro && (
                  <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {mockupErro}
                  </p>
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
  const [modalAberto, setModalAberto] = useState(false);
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
      alturaEmbalagem: formatNumberForInput(valoresProdutoFornecidoCalculados.alturaEmbalagem, 2),
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
    setModalAberto(false);
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
      <section className="rounded-lg border border-slate-200 bg-white p-6">
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

      <section className="rounded-lg border border-slate-200 bg-white p-6">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Gerar Produto Final</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Serão geradas apenas as variantes vinculadas as estampas e tamanhos selecionados.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-5">
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
                      { key: "alturaEmbalagem", label: "Altura da embalagem", digits: 2, placeholder: "0,00" },
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
                              [field.key]: normalizeDecimalText(
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
                onClick={() => setModalAberto(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
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
        </div>
      )}
    </div>
  );
}

function TableEmpty({ visible, text }: { visible: boolean; text: string }) {
  if (!visible) return null;
  return <p className="text-sm text-slate-600">{text}</p>;
}
