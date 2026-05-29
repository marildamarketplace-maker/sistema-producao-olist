"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  EstampaOlist,
  GeradorCsvOlistData,
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
  montarCsvProdutosOlist,
  salvarEstampaOlist,
  salvarProdutoFinalOlist,
  salvarTamanhoOlist,
  salvarTipoProdutoOlist,
  salvarVarianteOlist,
  uploadMockupProdutoOlist,
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
  low: "Baixa",
  medium: "Media",
  high: "Alta",
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
  precoCusto: "",
  preco: "",
  pesoLiquido: "",
  pesoBruto: "",
  larguraEmbalagem: "",
  alturaEmbalagem: "",
  comprimentoEmbalagem: "",
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
  precoCusto: "",
  preco: "",
  pesoLiquido: "",
  pesoBruto: "",
  larguraEmbalagem: "",
  alturaEmbalagem: "",
  comprimentoEmbalagem: "",
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

function cleanSkuPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
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

export function GeradorCsvOlistClient() {
  const [abaAtiva, setAbaAtiva] = useState<Aba>("tipos");
  const [dados, setDados] = useState<GeradorCsvOlistData>({
    tiposProduto: [],
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
      if (!tipoForm.titulo.trim() || !tipoForm.sku.trim()) {
        throw new Error("Preencha os campos obrigatorios: Titulo e SKU.");
      }

      await salvarTipoProdutoOlist({
        id: tipoEditId,
        titulo: tipoForm.titulo,
        sku: tipoForm.sku,
        descricao: tipoForm.descricao || null,
        descricaoSeo: tipoForm.descricaoSeo || null,
        palavrasChave: tipoForm.palavrasChave || null,
        detalhesPromptIa: tipoForm.detalhesPromptIa || null,
        slug: tipoForm.slug || null,
        categoria: tipoForm.categoria || null,
        precoCusto: toNumberOrNull(tipoForm.precoCusto),
        preco: toNumberOrNull(tipoForm.preco),
        pesoLiquido: toNumberOrNull(tipoForm.pesoLiquido),
        pesoBruto: toNumberOrNull(tipoForm.pesoBruto),
        larguraEmbalagem: toNumberOrNull(tipoForm.larguraEmbalagem),
        alturaEmbalagem: toNumberOrNull(tipoForm.alturaEmbalagem),
        comprimentoEmbalagem: toNumberOrNull(tipoForm.comprimentoEmbalagem),
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

      await salvarEstampaOlist({
        id: estampaEditId,
        codigo,
        descricao: estampaForm.descricao || null,
        palavrasChave: estampaForm.palavrasChave || null,
        extra: estampaForm.extra || null,
      });
      setEstampaForm(estampaInicial);
      setEstampaEditId(null);
      setMessage("Estampa salva com sucesso.");
      await carregar();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar estampa.");
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

      await salvarTamanhoOlist({
        id: tamanhoEditId,
        titulo,
        sku,
        slug: tamanhoForm.slug || null,
        precoCusto: toNumberOrNull(tamanhoForm.precoCusto),
        preco: toNumberOrNull(tamanhoForm.preco),
        pesoLiquido: toNumberOrNull(tamanhoForm.pesoLiquido),
        pesoBruto: toNumberOrNull(tamanhoForm.pesoBruto),
        larguraEmbalagem: toNumberOrNull(tamanhoForm.larguraEmbalagem),
        alturaEmbalagem: toNumberOrNull(tamanhoForm.alturaEmbalagem),
        comprimentoEmbalagem: toNumberOrNull(tamanhoForm.comprimentoEmbalagem),
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
    tamanhoIds?: string[];
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
      if (!payload.tamanhoIds || payload.tamanhoIds.length === 0) {
        throw new Error("Selecione ao menos um tamanho.");
      }

      const tamanhoIds = payload.tamanhoIds;
      const skusExistentes = new Set(dados.produtosFinais.map((produto) => produto.sku));
      const skusNovos = new Set<string>();
      const combinacoes = [];

      for (const estampaId of payload.estampaIds) {
        const estampa = dados.estampas.find((item) => item.id === estampaId);
        if (!estampa) continue;

        const variantesParaGerar = dados.variantes.filter(
          (item) => item.estampaId === estampa.id && item.tamanhoId && tamanhoIds.includes(item.tamanhoId),
        );

        for (const variante of variantesParaGerar) {
          const tamanho = dados.tamanhos.find((item) => item.id === variante.tamanhoId) ?? null;
          if (!tamanho) continue;
          const skuFinal = buildSkuFinal(tipoProduto, estampa, variante, tamanho);

          if (skusExistentes.has(skuFinal)) {
            throw new Error(`Ja existe um produto final com o SKU ${skuFinal}.`);
          }
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

      for (const combinacao of combinacoes) {
        await gerarProdutoFinalOlist({
          tipoProdutoId: tipoProduto.id,
          estampaId: combinacao.estampa.id,
          varianteId: combinacao.variante?.id ?? null,
          tamanhoId: combinacao.tamanho?.id ?? null,
        });
        totalGerado += 1;
      }

      setMessage(`${totalGerado} produto(s) final(is) gerado(s) com sucesso.`);
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
      precoCusto: formatNumberForInput(tipo.precoCusto, 2),
      preco: formatNumberForInput(tipo.preco, 2),
      pesoLiquido: formatNumberForInput(tipo.pesoLiquido, 3),
      pesoBruto: formatNumberForInput(tipo.pesoBruto, 3),
      larguraEmbalagem: formatNumberForInput(tipo.larguraEmbalagem, 2),
      alturaEmbalagem: formatNumberForInput(tipo.alturaEmbalagem, 2),
      comprimentoEmbalagem: formatNumberForInput(tipo.comprimentoEmbalagem, 2),
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
      precoCusto: formatNumberForInput(tipo.precoCusto, 2),
      preco: formatNumberForInput(tipo.preco, 2),
      pesoLiquido: formatNumberForInput(tipo.pesoLiquido, 3),
      pesoBruto: formatNumberForInput(tipo.pesoBruto, 3),
      larguraEmbalagem: formatNumberForInput(tipo.larguraEmbalagem, 2),
      alturaEmbalagem: formatNumberForInput(tipo.alturaEmbalagem, 2),
      comprimentoEmbalagem: formatNumberForInput(tipo.comprimentoEmbalagem, 2),
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
  }

  function duplicarEstampa(estampa: EstampaOlist) {
    setEstampaEditId(null);
    setEstampaForm({
      codigo: withCopySuffix(estampa.codigo),
      descricao: estampa.descricao ?? "",
      palavrasChave: estampa.palavrasChave ?? "",
      extra: estampa.extra ?? "",
    });
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
      precoCusto: formatNumberForInput(tamanho.precoCusto, 2),
      preco: formatNumberForInput(tamanho.preco, 2),
      pesoLiquido: formatNumberForInput(tamanho.pesoLiquido, 3),
      pesoBruto: formatNumberForInput(tamanho.pesoBruto, 3),
      larguraEmbalagem: formatNumberForInput(tamanho.larguraEmbalagem, 2),
      alturaEmbalagem: formatNumberForInput(tamanho.alturaEmbalagem, 2),
      comprimentoEmbalagem: formatNumberForInput(tamanho.comprimentoEmbalagem, 2),
    });
  }

  function duplicarTamanho(tamanho: TamanhoOlist) {
    setTamanhoEditId(null);
    setTamanhoForm({
      titulo: `${tamanho.titulo} Copia`,
      sku: withCopySuffix(tamanho.sku),
      slug: withSlugCopySuffix(tamanho.slug),
      precoCusto: formatNumberForInput(tamanho.precoCusto, 2),
      preco: formatNumberForInput(tamanho.preco, 2),
      pesoLiquido: formatNumberForInput(tamanho.pesoLiquido, 3),
      pesoBruto: formatNumberForInput(tamanho.pesoBruto, 3),
      larguraEmbalagem: formatNumberForInput(tamanho.larguraEmbalagem, 2),
      alturaEmbalagem: formatNumberForInput(tamanho.alturaEmbalagem, 2),
      comprimentoEmbalagem: formatNumberForInput(tamanho.comprimentoEmbalagem, 2),
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

  function baixarCsv(produtos?: ProdutoFinalOlist[]) {
    const produtosCsv = Array.isArray(produtos) ? produtos : dados.produtosFinais;
    const csv = montarCsvProdutosOlist(produtosCsv, { cacheKey: Date.now() });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "produtos-olist.csv";
    link.click();
    URL.revokeObjectURL(url);
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
              editingId={estampaEditId}
              setEditingId={setEstampaEditId}
              busca={estampaBusca}
              setBusca={setEstampaBusca}
              saving={saving}
              onSubmit={salvarEstampa}
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
            />
          )}
        </>
      )}
    </div>
  );
}

function TiposProdutoTab({
  tipos,
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
  const textFields: {
    key: keyof typeof tipoInicial;
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
  const decimalFields: {
    key: keyof typeof tipoInicial;
    label: string;
    digits: number;
    placeholder?: string;
  }[] = [
    { key: "precoCusto", label: "Preco de custo", digits: 2, placeholder: "0,00" },
    { key: "preco", label: "Preco", digits: 2, placeholder: "0,00" },
    { key: "pesoLiquido", label: "Peso liquido", digits: 3, placeholder: "0,000" },
    { key: "pesoBruto", label: "Peso bruto", digits: 3, placeholder: "0,000" },
    { key: "larguraEmbalagem", label: "Largura da embalagem", digits: 2, placeholder: "0,00" },
    { key: "alturaEmbalagem", label: "Altura da embalagem", digits: 2, placeholder: "0,00" },
    { key: "comprimentoEmbalagem", label: "Comprimento da embalagem", digits: 2, placeholder: "0,00" },
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
                onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
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
          {decimalFields.map((field) => (
            <label key={field.key} className="text-sm text-slate-700">
              {field.label}
              <input
                inputMode="decimal"
                value={form[field.key]}
                onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                onBlur={() =>
                  setForm((prev) => ({
                    ...prev,
                    [field.key]: normalizeDecimalText(prev[field.key], field.digits),
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder={field.placeholder}
              />
            </label>
          ))}
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
                  <th className="p-3">Preco custo</th>
                  <th className="p-3">Preco</th>
                  <th className="p-3">Embalagem</th>
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
                    <td className="p-3 text-slate-700">{formatMoney(tipo.precoCusto)}</td>
                    <td className="p-3 text-slate-700">{formatMoney(tipo.preco)}</td>
                    <td className="p-3 text-slate-700">
                      {[
                        formatDecimal(tipo.larguraEmbalagem, 2),
                        formatDecimal(tipo.alturaEmbalagem, 2),
                        formatDecimal(tipo.comprimentoEmbalagem, 2),
                      ].join(" x ")}
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
  const decimalFields: {
    key: keyof typeof tamanhoInicial;
    label: string;
    digits: number;
    placeholder?: string;
  }[] = [
    { key: "precoCusto", label: "Preco de custo", digits: 2, placeholder: "0,00" },
    { key: "preco", label: "Preco", digits: 2, placeholder: "0,00" },
    { key: "pesoLiquido", label: "Peso liquido", digits: 3, placeholder: "0,000" },
    { key: "pesoBruto", label: "Peso bruto", digits: 3, placeholder: "0,000" },
    { key: "larguraEmbalagem", label: "Largura da embalagem", digits: 2, placeholder: "0,00" },
    { key: "alturaEmbalagem", label: "Altura da embalagem", digits: 2, placeholder: "0,00" },
    { key: "comprimentoEmbalagem", label: "Comprimento da embalagem", digits: 2, placeholder: "0,00" },
  ];

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
          {decimalFields.map((field) => (
            <label key={field.key} className="text-sm text-slate-700">
              {field.label}
              <input
                inputMode="decimal"
                value={form[field.key]}
                onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                onBlur={() =>
                  setForm((prev) => ({
                    ...prev,
                    [field.key]: normalizeDecimalText(prev[field.key], field.digits),
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder={field.placeholder}
              />
            </label>
          ))}
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
                  <th className="p-3">Preco custo</th>
                  <th className="p-3">Preco</th>
                  <th className="p-3">Embalagem</th>
                  <th className="p-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {tamanhos.map((tamanho) => (
                  <tr key={tamanho.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-700">{tamanho.titulo}</td>
                    <td className="p-3 text-slate-700">{tamanho.sku}</td>
                    <td className="p-3 text-slate-700">{tamanho.slug ?? "-"}</td>
                    <td className="p-3 text-slate-700">{formatMoney(tamanho.precoCusto)}</td>
                    <td className="p-3 text-slate-700">{formatMoney(tamanho.preco)}</td>
                    <td className="p-3 text-slate-700">
                      {[
                        formatDecimal(tamanho.larguraEmbalagem, 2),
                        formatDecimal(tamanho.alturaEmbalagem, 2),
                        formatDecimal(tamanho.comprimentoEmbalagem, 2),
                      ].join(" x ")}
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
  estampas: EstampaOlist[];
  form: typeof estampaInicial;
  setForm: Dispatch<SetStateAction<typeof estampaInicial>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  busca: string;
  setBusca: Dispatch<SetStateAction<string>>;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (estampa: EstampaOlist) => void;
  onDuplicate: (estampa: EstampaOlist) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          {editingId ? "Editar estampa" : "Cadastrar estampa"}
        </h3>

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
          <h3 className="text-lg font-semibold text-slate-900">Estampas cadastradas</h3>
          <label className="w-full text-sm text-slate-700 md:max-w-xs">
            Buscar por codigo
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Digite codigo, descricao ou extra"
            />
          </label>
        </div>

        <TableEmpty visible={estampas.length === 0} text="Nenhuma estampa encontrada." />
        {estampas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Codigo</th>
                  <th className="p-3">Descricao</th>
                  <th className="p-3">Palavras-chave</th>
                  <th className="p-3">Extra</th>
                  <th className="p-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {estampas.map((estampa) => (
                  <tr key={estampa.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-700">{estampa.codigo}</td>
                    <td className="p-3 text-slate-700">{estampa.descricao ?? "-"}</td>
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
  onEdit: (variante: VarianteOlist) => void;
  onDuplicate: (variante: VarianteOlist) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          {editingId ? "Editar variante" : "Cadastrar variante"}
        </h3>

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
          <label className="w-full text-sm text-slate-700 md:max-w-xs">
            Buscar por codigo
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Codigo, estampa ou tamanho"
            />
          </label>
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
}) {
  const [buscaSku, setBuscaSku] = useState("");
  const [buscaTitulo, setBuscaTitulo] = useState("");
  const [tipoProdutoId, setTipoProdutoId] = useState("");
  const [estampaId, setEstampaId] = useState("");
  const [varianteId, setVarianteId] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pagina, setPagina] = useState(1);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [produtoEditando, setProdutoEditando] = useState<ProdutoFinalOlist | null>(null);
  const [produtoVisualizando, setProdutoVisualizando] = useState<ProdutoFinalOlist | null>(null);
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
  const pageSize = 10;

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
          <p className="text-sm text-slate-600">{selecionados.length} selecionado(s)</p>
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
                        <option value="low">Baixa</option>
                        <option value="medium">Media</option>
                        <option value="high">Alta</option>
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
                          {item.valor === "" || item.valor === null || item.valor === undefined
                            ? "-"
                            : String(item.valor)}
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
    tamanhoIds?: string[];
  }) => Promise<void>;
  onDownloadCsv: () => void;
}) {
  const [modalAberto, setModalAberto] = useState(false);
  const [tipoProdutoId, setTipoProdutoId] = useState("");
  const [estampaIds, setEstampaIds] = useState<string[]>([]);
  const [tamanhoIds, setTamanhoIds] = useState<string[]>([]);
  const totalCombinacoes = estampaIds.reduce((total, estampaId) => {
    return total + variantes.filter(
      (variante) => variante.estampaId === estampaId && variante.tamanhoId && tamanhoIds.includes(variante.tamanhoId),
    ).length;
  }, 0);
  const tipoSelecionado = tipos.find((tipo) => tipo.id === tipoProdutoId) ?? null;
  const skusExistentes = useMemo(() => new Set(produtos.map((produto) => produto.sku)), [produtos]);
  const previewProdutos = useMemo(() => {
    if (!tipoSelecionado || estampaIds.length === 0) return [];

    return estampaIds.flatMap((estampaId) => {
      const estampa = estampas.find((item) => item.id === estampaId);
      if (!estampa) return [];

      const variantesParaGerar = variantes.filter(
        (variante) => variante.estampaId === estampa.id && variante.tamanhoId && tamanhoIds.includes(variante.tamanhoId),
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
  }, [estampaIds, estampas, skusExistentes, tamanhoIds, tamanhos, tipoSelecionado, variantes]);
  const previewTemDuplicados = previewProdutos.some((produto) => produto.duplicado);

  function toggleSelecionado(id: string, selecionados: string[], setSelecionados: Dispatch<SetStateAction<string[]>>) {
    setSelecionados(
      selecionados.includes(id)
        ? selecionados.filter((item) => item !== id)
        : [...selecionados, id],
    );
  }

  async function confirmarGeracao() {
    await onGenerate({ tipoProdutoId, estampaIds, tamanhoIds });
    setModalAberto(false);
    setTipoProdutoId("");
    setEstampaIds([]);
    setTamanhoIds([]);
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
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Produtos finais</h3>
        <TableEmpty visible={produtos.length === 0} text="Nenhum produto final gerado." />
        {produtos.length > 0 && (
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
                {produtos.map((produto) => (
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
                            type="checkbox"
                            checked={tamanhoIds.includes(tamanho.id)}
                            onChange={() => toggleSelecionado(tamanho.id, tamanhoIds, setTamanhoIds)}
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
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">Estampas</h4>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                    {estampas.map((estampa) => (
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
                            {variantes.filter((variante) => variante.estampaId === estampa.id).length} variante(s)
                          </span>
                          {estampa.descricao && (
                            <span className="block text-xs text-slate-500">{estampa.descricao}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
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
                            <td className={`p-3 ${produto.duplicado ? "text-red-700" : "text-emerald-700"}`}>
                              {produto.duplicado ? "SKU existente" : "Pronto"}
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
                  tamanhoIds.length === 0 ||
                  previewProdutos.length === 0 ||
                  previewTemDuplicados
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
