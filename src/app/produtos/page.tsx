"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  id_cadastro_olist: string | null;
  imagem_url: string | null;
  meta_estoque: number | null;
  minimo_estoque: number | null;
  ativo: boolean;
  created_at: string;
  tem_produto_fornecido?: boolean;
};

type FormData = {
  sku: string;
  imagem_url: string;
  meta_estoque: string;
  minimo_estoque: string;
  ativo: boolean;
};

type StatusFiltro = "todos" | "ativos" | "inativos";
type EstoqueFiltro = "todos" | "com-meta" | "sem-meta" | "com-minimo" | "sem-minimo";
type ProdutoFornecidoFiltro = "todos" | "com" | "sem";
type IdOlistFiltro = "todos" | "com" | "sem";

type FiltrosData = {
  sku: string;
  status: StatusFiltro;
  estoque: EstoqueFiltro;
  produtoFornecido: ProdutoFornecidoFiltro;
  idOlist: IdOlistFiltro;
};

type ProdutoFabricadoImportado = {
  produtoSku: string;
  produtoFornecidoId: string;
  quantidade: string;
};

type ProdutoImportacaoRow = {
  id: string;
  sku: string;
  id_cadastro_olist: string | null;
};

type ProdutoOlistRelacionamentoRow = {
  id: string;
  produto_id?: string | null;
  sku_final: string;
};

type ProdutoOlistFornecedorRow = {
  produto_id: string;
  produto_olist_id: string | null;
  produto_fornecedor_id: string;
  quantidade_usada: number | string | null;
};

type ProdutoFornecedorRow = {
  id: string;
  nome: string;
  referencia: string | null;
};

type ProdutoFornecedorImportacaoRow = {
  id: string;
};

type RelacionamentoProdutoFornecido = {
  produtoFornecedorId: string;
  nome: string;
  referencia: string | null;
  quantidadeUsada: number | null;
};

type RelacionamentoFormData = {
  produtoFornecedorId: string;
  quantidadeUsada: string;
  editingProdutoFornecedorId: string | null;
};

type ProdutoCsvImportado = {
  sku: string;
  idOlist: string | null;
  metaEstoque: number | null;
  minimoEstoque: number | null;
  referenciaProdutoFornecedor: string | null;
  quantidadeProdutoFornecedor: number | null;
  ativo: boolean;
};

const INITIAL_FORM: FormData = {
  sku: "",
  imagem_url: "",
  meta_estoque: "",
  minimo_estoque: "",
  ativo: true,
};

const PRODUTO_SKU_MAX_LENGTH = 50;
const OPCOES_POR_PAGINA = [100, 1000, 9999999] as const;

const INITIAL_FILTROS: FiltrosData = {
  sku: "",
  status: "todos",
  estoque: "todos",
  produtoFornecido: "todos",
  idOlist: "todos",
};

const INITIAL_RELACIONAMENTO_FORM: RelacionamentoFormData = {
  produtoFornecedorId: "",
  quantidadeUsada: "",
  editingProdutoFornecedorId: null,
};

function parseFlexibleDecimalText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const numberValue = Number(normalized);

  return Number.isNaN(numberValue) ? null : numberValue;
}

function formatNumberForInput(value: number, digits: number) {
  return value.toFixed(digits).replace(".", ",");
}

function normalizeFlexibleDecimalText(value: string, digits: number) {
  const numberValue = parseFlexibleDecimalText(value);
  return numberValue === null ? value : formatNumberForInput(numberValue, digits);
}

function formatarDecimal(value: number | null) {
  if (value === null) return "-";

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function numeroDecimal(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;

  const numberValue = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(numberValue) ? null : numberValue;
}

function normalizarSkuBusca(value: string) {
  return value.trim().toUpperCase();
}

function formatarCampoCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function lerLinhaCsv(linha: string) {
  const campos: string[] = [];
  let campo = "";
  let entreAspas = false;

  for (let index = 0; index < linha.length; index += 1) {
    const caractere = linha[index];
    if (caractere === '"' && entreAspas && linha[index + 1] === '"') {
      campo += '"';
      index += 1;
    } else if (caractere === '"') {
      entreAspas = !entreAspas;
    } else if (caractere === ";" && !entreAspas) {
      campos.push(campo.trim());
      campo = "";
    } else {
      campo += caractere;
    }
  }

  campos.push(campo.trim());
  return campos;
}

function parseNumeroCsv(valor: string, campo: string, linha: number) {
  if (!valor.trim()) return null;
  const numero = parseFlexibleDecimalText(valor);
  if (numero === null || numero < 0) throw new Error(`Linha ${linha}: ${campo} inválido.`);
  return numero;
}

function parseProdutosCsv(conteudo: string): ProdutoCsvImportado[] {
  const linhas = conteudo.replace(/^\uFEFF/, "").split(/\r?\n/).filter((linha) => linha.trim());
  if (linhas.length < 2) throw new Error("O CSV deve conter o cabeçalho e ao menos um produto.");

  const cabecalhoEsperado = [
    "sku", "id olist", "meta de estoque", "minimo de estoque",
    "referencia produto fornecido", "qtd produto fornecido", "situação",
  ];
  const cabecalho = lerLinhaCsv(linhas[0]).map((item) =>
    item.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
  );
  const esperadoNormalizado = cabecalhoEsperado.map((item) =>
    item.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
  if (cabecalho.join("|") !== esperadoNormalizado.join("|")) {
    throw new Error("Cabeçalho inválido. Use o mesmo padrão do arquivo exportado.");
  }

  const produtos = linhas.slice(1).map((linha, index) => {
    const numeroLinha = index + 2;
    const campos = lerLinhaCsv(linha);
    if (campos.length !== 7) throw new Error(`Linha ${numeroLinha}: são esperadas 7 colunas.`);
    const [sku, idOlist, meta, minimo, referencia, quantidade, situacao] = campos;
    if (!sku) throw new Error(`Linha ${numeroLinha}: SKU não informado.`);
    const situacaoNormalizada = situacao.trim().toLowerCase();
    if (!['ativo', 'inativo'].includes(situacaoNormalizada)) {
      throw new Error(`Linha ${numeroLinha}: situação deve ser Ativo ou Inativo.`);
    }
    const metaNormalizada = parseNumeroCsv(meta, "meta de estoque", numeroLinha);
    const minimoNormalizado = parseNumeroCsv(minimo, "mínimo de estoque", numeroLinha);
    if ((metaNormalizada !== null && !Number.isInteger(metaNormalizada)) ||
        (minimoNormalizado !== null && !Number.isInteger(minimoNormalizado))) {
      throw new Error(`Linha ${numeroLinha}: meta e mínimo de estoque devem ser números inteiros.`);
    }
    const quantidadeNormalizada = parseNumeroCsv(quantidade, "quantidade do produto fornecido", numeroLinha);
    if (referencia && (quantidadeNormalizada === null || quantidadeNormalizada <= 0)) {
      throw new Error(`Linha ${numeroLinha}: informe uma quantidade maior que zero para o produto fornecido.`);
    }
    return {
      sku: sku.trim(),
      idOlist: idOlist.trim() || null,
      metaEstoque: metaNormalizada,
      minimoEstoque: minimoNormalizado,
      referenciaProdutoFornecedor: referencia.trim() || null,
      quantidadeProdutoFornecedor: quantidadeNormalizada,
      ativo: situacaoNormalizada === "ativo",
    };
  });

  const skus = new Set<string>();
  for (const produto of produtos) {
    const sku = normalizarSkuBusca(produto.sku);
    if (skus.has(sku)) throw new Error(`SKU duplicado no CSV: ${produto.sku}.`);
    skus.add(sku);
  }
  return produtos;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function parseProdutosFabricadosImport(text: string): ProdutoFabricadoImportado[] {
  const linhas = text
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  if (!linhas.length) {
    throw new Error("Informe ao menos uma linha para importar.");
  }

  const primeiraLinha = linhas[0]?.toLowerCase().replace(/\s+/g, "");
  const hasCabecalho = [
    "produtosku;produtofornecidoid;qtd",
    "sku;produtofornecidoid;qtd",
  ].includes(primeiraLinha);
  const linhasSemCabecalho = hasCabecalho ? linhas.slice(1) : linhas;
  const linhaInicial = hasCabecalho ? 2 : 1;

  if (!linhasSemCabecalho.length) {
    throw new Error("Informe ao menos uma linha de produto.");
  }

  return linhasSemCabecalho.map((linha, index) => {
    const [skuRaw = "", produtoFornecidoIdRaw = "", quantidadeRaw = "", ...extras] = linha.split(";");
    const linhaNumero = linhaInicial + index;
    const produtoSku = skuRaw.trim();
    const produtoFornecidoId = produtoFornecidoIdRaw.trim();
    const quantidadeNumber = parseFlexibleDecimalText(quantidadeRaw);

    if (extras.length > 0) {
      throw new Error(`Linha ${linhaNumero}: use somente produtosku;produtofornecidoid;qtd.`);
    }
    if (!produtoSku) {
      throw new Error(`Linha ${linhaNumero}: informe o SKU do produto.`);
    }
    if (!produtoFornecidoId) {
      throw new Error(`Linha ${linhaNumero}: informe o UUID do produto fornecido.`);
    }
    if (quantidadeNumber === null || quantidadeNumber <= 0) {
      throw new Error(`Linha ${linhaNumero}: informe uma quantidade decimal valida.`);
    }

    return {
      produtoSku,
      produtoFornecidoId,
      quantidade: formatNumberForInput(quantidadeNumber, 4),
    };
  });
}

async function carregarStatusProdutosFornecidos(produtos: Produto[]) {
  if (produtos.length === 0) return produtos;

  const produtosIds = Array.from(new Set(produtos.map((produto) => produto.id)));
  const associacoes: Array<Pick<ProdutoOlistFornecedorRow, "produto_id">> = [];

  for (const produtosIdsChunk of chunkArray(produtosIds, 100)) {
    const { data: associacoesData, error: associacoesError } = await supabase
      .from("produto_olist_produto_fornecedor")
      .select("produto_id")
      .in("produto_id", produtosIdsChunk);

    if (associacoesError) {
      throw new Error(associacoesError.message);
    }

    associacoes.push(...(((associacoesData as Array<Pick<ProdutoOlistFornecedorRow, "produto_id">>) ?? [])));
  }

  const produtosComProdutoFornecido = new Set(
    associacoes.map((associacao) => associacao.produto_id),
  );

  return produtos.map((produto) => ({
    ...produto,
    tem_produto_fornecido: produtosComProdutoFornecido.has(produto.id),
  }));
}

export default function ProdutosPage() {
  const { usuario } = useAuth();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [filtros, setFiltros] = useState<FiltrosData>(INITIAL_FILTROS);
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosData>(INITIAL_FILTROS);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina, setItensPorPagina] = useState<number>(100);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fabricadoModalOpen, setFabricadoModalOpen] = useState(false);
  const [fabricadoImportTexto, setFabricadoImportTexto] = useState("");
  const [fabricadoErro, setFabricadoErro] = useState<string | null>(null);
  const [fabricadoExportando, setFabricadoExportando] = useState(false);
  const [produtosExportando, setProdutosExportando] = useState(false);
  const [importacaoModalOpen, setImportacaoModalOpen] = useState(false);
  const [importacaoEtapa, setImportacaoEtapa] = useState<"arquivo" | "confirmacao">("arquivo");
  const [produtosImportados, setProdutosImportados] = useState<ProdutoCsvImportado[]>([]);
  const [importacaoErro, setImportacaoErro] = useState<string | null>(null);
  const [importacaoSalvando, setImportacaoSalvando] = useState(false);
  const [relacionamentoProduto, setRelacionamentoProduto] = useState<Produto | null>(null);
  const [relacionamentoProdutoOlistId, setRelacionamentoProdutoOlistId] = useState<string | null>(null);
  const [relacionamentosProduto, setRelacionamentosProduto] = useState<RelacionamentoProdutoFornecido[]>([]);
  const [produtosFornecedor, setProdutosFornecedor] = useState<ProdutoFornecedorRow[]>([]);
  const [relacionamentoForm, setRelacionamentoForm] =
    useState<RelacionamentoFormData>(INITIAL_RELACIONAMENTO_FORM);
  const [relacionamentoLoading, setRelacionamentoLoading] = useState(false);
  const [relacionamentoSaving, setRelacionamentoSaving] = useState(false);
  const [relacionamentoErro, setRelacionamentoErro] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const podeEditarEstoque = Boolean(usuario?.podeEditarEstoque);

  const isEditing = useMemo(() => editingId !== null, [editingId]);
  const totalPaginas = Math.max(1, Math.ceil(produtos.length / itensPorPagina));
  const produtosPaginados = useMemo(() => {
    const inicio = (paginaAtual - 1) * itensPorPagina;
    return produtos.slice(inicio, inicio + itensPorPagina);
  }, [itensPorPagina, paginaAtual, produtos]);
  const temFiltrosAplicados = useMemo(
    () =>
      filtrosAplicados.sku.trim() !== "" ||
      filtrosAplicados.status !== "todos" ||
      filtrosAplicados.estoque !== "todos" ||
      filtrosAplicados.produtoFornecido !== "todos" ||
      filtrosAplicados.idOlist !== "todos",
    [filtrosAplicados],
  );

  const loadProdutos = useCallback(async (filtrosBusca: FiltrosData) => {
    setIsLoading(true);
    setErrorMessage(null);

    let query = supabase
      .from("produtos")
      .select("id, sku, id_cadastro_olist, imagem_url, meta_estoque, minimo_estoque, ativo, created_at")
      .order("created_at", { ascending: false });

    const sku = filtrosBusca.sku.trim();

    if (sku) {
      query = query.ilike("sku", `%${sku}%`);
    }

    if (filtrosBusca.status === "ativos") {
      query = query.eq("ativo", true);
    } else if (filtrosBusca.status === "inativos") {
      query = query.eq("ativo", false);
    }

    if (filtrosBusca.estoque === "com-meta") {
      query = query.not("meta_estoque", "is", null);
    } else if (filtrosBusca.estoque === "sem-meta") {
      query = query.is("meta_estoque", null);
    } else if (filtrosBusca.estoque === "com-minimo") {
      query = query.not("minimo_estoque", "is", null);
    } else if (filtrosBusca.estoque === "sem-minimo") {
      query = query.is("minimo_estoque", null);
    }

    if (filtrosBusca.idOlist === "com") {
      query = query.not("id_cadastro_olist", "is", null).neq("id_cadastro_olist", "");
    } else if (filtrosBusca.idOlist === "sem") {
      query = query.or("id_cadastro_olist.is.null,id_cadastro_olist.eq.");
    }

    const { data, error } = await query;

    if (error) {
      setErrorMessage(`Erro ao carregar produtos: ${error.message}`);
      setIsLoading(false);
      return;
    }

    let produtosComRelacionamento: Produto[];

    try {
      produtosComRelacionamento = await carregarStatusProdutosFornecidos((data as Produto[]) ?? []);
    } catch (statusError) {
      setErrorMessage(
        `Erro ao carregar relacionamentos com produtos fornecidos: ${
          statusError instanceof Error ? statusError.message : "erro desconhecido"
        }`,
      );
      setIsLoading(false);
      return;
    }

    if (filtrosBusca.produtoFornecido === "com") {
      produtosComRelacionamento = produtosComRelacionamento.filter((produto) => produto.tem_produto_fornecido);
    } else if (filtrosBusca.produtoFornecido === "sem") {
      produtosComRelacionamento = produtosComRelacionamento.filter((produto) => !produto.tem_produto_fornecido);
    }

    setProdutos(produtosComRelacionamento);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadProdutos(INITIAL_FILTROS);
  }, [loadProdutos]);

  useEffect(() => {
    if (paginaAtual > totalPaginas) setPaginaAtual(totalPaginas);
  }, [paginaAtual, totalPaginas]);

  function resetForm() {
    setFormData(INITIAL_FORM);
    setEditingId(null);
    setFormOpen(false);
  }

  async function handleFiltrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaginaAtual(1);
    setFiltrosAplicados(filtros);
    await loadProdutos(filtros);
  }

  async function limparFiltros() {
    setPaginaAtual(1);
    setFiltros(INITIAL_FILTROS);
    setFiltrosAplicados(INITIAL_FILTROS);
    await loadProdutos(INITIAL_FILTROS);
  }

  async function exportarProdutosCsv() {
    if (produtos.length === 0) return;

    setProdutosExportando(true);
    setErrorMessage(null);

    try {
      const associacoes: ProdutoOlistFornecedorRow[] = [];

      for (const ids of chunkArray(produtos.map((produto) => produto.id), 100)) {
        const { data, error } = await supabase
          .from("produto_olist_produto_fornecedor")
          .select("produto_id, produto_fornecedor_id, quantidade_usada")
          .in("produto_id", ids);

        if (error) throw new Error(`Erro ao buscar produtos fornecidos: ${error.message}`);
        associacoes.push(...((data as ProdutoOlistFornecedorRow[]) ?? []));
      }

      const produtosFornecedorIds = Array.from(
        new Set(associacoes.map((item) => item.produto_fornecedor_id).filter(Boolean)),
      );
      const referencias = new Map<string, string | null>();

      for (const ids of chunkArray(produtosFornecedorIds, 100)) {
        const { data, error } = await supabase
          .from("produtos_fornecedor")
          .select("id, referencia")
          .in("id", ids);

        if (error) throw new Error(`Erro ao buscar referências: ${error.message}`);
        for (const item of (data as Array<Pick<ProdutoFornecedorRow, "id" | "referencia">>) ?? []) {
          referencias.set(item.id, item.referencia);
        }
      }

      const associacaoPorProduto = new Map(
        associacoes.map((associacao) => [associacao.produto_id, associacao]),
      );
      const cabecalho = [
        "SKU",
        "ID Olist",
        "Meta de estoque",
        "Minimo de estoque",
        "Referencia produto fornecido",
        "Qtd produto fornecido",
        "Situação",
      ];
      const linhas = produtos.map((produto) => {
        const associacao = associacaoPorProduto.get(produto.id);
        return [
          produto.sku,
          produto.id_cadastro_olist,
          produto.meta_estoque,
          produto.minimo_estoque,
          associacao ? referencias.get(associacao.produto_fornecedor_id) : null,
          associacao?.quantidade_usada,
          produto.ativo ? "Ativo" : "Inativo",
        ];
      });
      const csv = [cabecalho, ...linhas]
        .map((linha) => linha.map(formatarCampoCsv).join(";"))
        .join("\r\n");
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `produtos-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao exportar produtos.");
    } finally {
      setProdutosExportando(false);
    }
  }

  function fecharImportacao(forcar = false) {
    if (importacaoSalvando && !forcar) return;
    setImportacaoModalOpen(false);
    setImportacaoEtapa("arquivo");
    setProdutosImportados([]);
    setImportacaoErro(null);
  }

  async function lerArquivoImportacao(arquivo: File | null) {
    setImportacaoErro(null);
    setProdutosImportados([]);
    if (!arquivo) return;

    try {
      const produtosLidos = parseProdutosCsv(await arquivo.text());
      setProdutosImportados(produtosLidos);
      setImportacaoEtapa("confirmacao");
    } catch (error) {
      setImportacaoErro(error instanceof Error ? error.message : "Erro ao ler o arquivo CSV.");
    }
  }

  async function confirmarImportacaoCsv() {
    setImportacaoSalvando(true);
    setImportacaoErro(null);

    try {
      const produtosPorSku = new Map<string, ProdutoImportacaoRow>();
      for (const skus of chunkArray(produtosImportados.map((produto) => produto.sku), 100)) {
        const { data, error } = await supabase
          .from("produtos")
          .select("id, sku, id_cadastro_olist")
          .in("sku", skus);
        if (error) throw new Error(`Erro ao validar produtos: ${error.message}`);
        for (const produto of (data as ProdutoImportacaoRow[]) ?? []) {
          produtosPorSku.set(normalizarSkuBusca(produto.sku), produto);
        }
      }

      const naoEncontrado = produtosImportados.find(
        (produto) => !produtosPorSku.has(normalizarSkuBusca(produto.sku)),
      );
      if (naoEncontrado) throw new Error(`Produto com SKU ${naoEncontrado.sku} não encontrado.`);

      const referenciasSolicitadas = Array.from(new Set(
        produtosImportados
          .map((produto) => produto.referenciaProdutoFornecedor)
          .filter((referencia): referencia is string => Boolean(referencia)),
      ));
      const produtosFornecedorPorReferencia = new Map<string, ProdutoFornecedorRow>();
      for (const referencias of chunkArray(referenciasSolicitadas, 100)) {
        const { data, error } = await supabase
          .from("produtos_fornecedor")
          .select("id, nome, referencia")
          .in("referencia", referencias);
        if (error) throw new Error(`Erro ao validar referências: ${error.message}`);
        for (const produto of (data as ProdutoFornecedorRow[]) ?? []) {
          if (produto.referencia) produtosFornecedorPorReferencia.set(produto.referencia, produto);
        }
      }

      const referenciaNaoEncontrada = referenciasSolicitadas.find(
        (referencia) => !produtosFornecedorPorReferencia.has(referencia),
      );
      if (referenciaNaoEncontrada) {
        throw new Error(`Produto fornecido com referência ${referenciaNaoEncontrada} não encontrado.`);
      }

      for (const item of produtosImportados) {
        const produto = produtosPorSku.get(normalizarSkuBusca(item.sku));
        if (!produto) continue;

        const { error: produtoError } = await supabase
          .from("produtos")
          .update({
            id_cadastro_olist: item.idOlist,
            meta_estoque: item.metaEstoque,
            minimo_estoque: item.minimoEstoque,
            ativo: item.ativo,
          })
          .eq("id", produto.id);
        if (produtoError) throw new Error(`Erro ao atualizar ${item.sku}: ${produtoError.message}`);

        if (!item.referenciaProdutoFornecedor) {
          const { error } = await supabase
            .from("produto_olist_produto_fornecedor")
            .delete()
            .eq("produto_id", produto.id);
          if (error) throw new Error(`Erro ao remover vínculo de ${item.sku}: ${error.message}`);
          continue;
        }

        const produtoFornecedor = produtosFornecedorPorReferencia.get(item.referenciaProdutoFornecedor);
        if (!produtoFornecedor || item.quantidadeProdutoFornecedor === null) continue;
        const { error } = await supabase
          .from("produto_olist_produto_fornecedor")
          .upsert({
            produto_id: produto.id,
            produto_fornecedor_id: produtoFornecedor.id,
            quantidade_usada: item.quantidadeProdutoFornecedor,
            updated_at: new Date().toISOString(),
          }, { onConflict: "produto_id" });
        if (error) throw new Error(`Erro ao atualizar produto fornecido de ${item.sku}: ${error.message}`);
      }

      await loadProdutos(filtrosAplicados);
      fecharImportacao(true);
    } catch (error) {
      setImportacaoErro(error instanceof Error ? error.message : "Erro ao importar o CSV.");
    } finally {
      setImportacaoSalvando(false);
    }
  }

  async function exportarFabricadoImportado(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFabricadoErro(null);
    setFabricadoExportando(true);

    try {
      const itens = parseProdutosFabricadosImport(fabricadoImportTexto);
      const produtosPorSku = new Map<string, ProdutoImportacaoRow>();
      const skus = Array.from(new Set(itens.map((item) => item.produtoSku.trim()).filter(Boolean)));
      const skuDuplicado = skus.find(
        (sku) => itens.filter((item) => normalizarSkuBusca(item.produtoSku) === normalizarSkuBusca(sku)).length > 1,
      );

      if (skuDuplicado) {
        throw new Error(`Produto com SKU ${skuDuplicado} aparece mais de uma vez na importacao.`);
      }

      for (const skusChunk of chunkArray(skus, 100)) {
        const { data, error } = await supabase
          .from("produtos")
          .select("id, sku, id_cadastro_olist")
          .in("sku", skusChunk);

        if (error) {
          throw new Error(`Erro ao validar produtos cadastrados: ${error.message}`);
        }

        for (const produtoEncontrado of ((data as ProdutoImportacaoRow[]) ?? [])) {
          produtosPorSku.set(normalizarSkuBusca(produtoEncontrado.sku), produtoEncontrado);
        }
      }

      const skuNaoEncontrado = itens.find((item) => !produtosPorSku.has(normalizarSkuBusca(item.produtoSku)));

      if (skuNaoEncontrado) {
        throw new Error(`Produto com SKU ${skuNaoEncontrado.produtoSku} nao encontrado em Produtos.`);
      }

      const produtosOlistPorSku = new Map<string, ProdutoOlistRelacionamentoRow>();

      for (const skusChunk of chunkArray(skus, 100)) {
        const { data, error } = await supabase
          .from("produto_olist")
          .select("id, produto_id, sku_final")
          .in("sku_final", skusChunk);

        if (error) {
          throw new Error(`Erro ao validar produtos Olist: ${error.message}`);
        }

        for (const produtoOlist of ((data as ProdutoOlistRelacionamentoRow[]) ?? [])) {
          produtosOlistPorSku.set(normalizarSkuBusca(produtoOlist.sku_final), produtoOlist);
        }
      }

      const produtosFornecidosIds = Array.from(
        new Set(itens.map((item) => item.produtoFornecidoId.trim()).filter(Boolean)),
      );
      const produtosFornecidosEncontrados = new Set<string>();

      for (const idsChunk of chunkArray(produtosFornecidosIds, 100)) {
        const { data, error } = await supabase
          .from("produtos_fornecedor")
          .select("id")
          .in("id", idsChunk);

        if (error) {
          throw new Error(`Erro ao validar produtos fornecidos cadastrados: ${error.message}`);
        }

        for (const produtoFornecido of ((data as ProdutoFornecedorImportacaoRow[]) ?? [])) {
          produtosFornecidosEncontrados.add(produtoFornecido.id);
        }
      }

      const produtoFornecidoNaoEncontrado = itens.find(
        (item) => !produtosFornecidosEncontrados.has(item.produtoFornecidoId.trim()),
      );

      if (produtoFornecidoNaoEncontrado) {
        throw new Error(
          `Produto fornecido com UUID ${produtoFornecidoNaoEncontrado.produtoFornecidoId} nao encontrado em Produtos do fornecedor.`,
        );
      }

      const relacionamentosPayload = itens.map((item) => {
        const produto = produtosPorSku.get(normalizarSkuBusca(item.produtoSku));
        const produtoOlist = produtosOlistPorSku.get(normalizarSkuBusca(item.produtoSku));
        const quantidadeUsada = parseFlexibleDecimalText(item.quantidade);

        if (!produto || quantidadeUsada === null) {
          throw new Error(`Linha do SKU ${item.produtoSku} invalida para salvar relacionamento.`);
        }

        return {
          produto_id: produto.id,
          produto_olist_id: produtoOlist?.id ?? null,
          produto_fornecedor_id: item.produtoFornecidoId.trim(),
          quantidade_usada: quantidadeUsada,
        };
      });

      const { error: relacionamentoError } = await supabase
        .from("produto_olist_produto_fornecedor")
        .upsert(relacionamentosPayload, { onConflict: "produto_id" });

      if (relacionamentoError) {
        throw new Error(`Erro ao salvar produtos fornecidos relacionados: ${relacionamentoError.message}`);
      }

      await loadProdutos(filtrosAplicados);
      setFabricadoModalOpen(false);
    } catch (error) {
      setFabricadoErro(error instanceof Error ? error.message : "Erro ao importar produtos fabricados.");
    } finally {
      setFabricadoExportando(false);
    }
  }

  async function carregarRelacionamentosProduto(produto: Produto) {
    setRelacionamentosProduto([]);
    setRelacionamentoErro(null);
    setRelacionamentoLoading(true);
    setRelacionamentoProdutoOlistId(null);

    const atualizarStatusProdutoFornecido = (temProdutoFornecido: boolean) => {
      setProdutos((produtosAtuais) =>
        produtosAtuais.map((produtoAtual) =>
          produtoAtual.id === produto.id
            ? { ...produtoAtual, tem_produto_fornecido: temProdutoFornecido }
            : produtoAtual,
        ),
      );
    };

    const { data: produtosOlistData, error: produtosOlistError } = await supabase
      .from("produto_olist")
      .select("id, sku_final")
      .eq("sku_final", produto.sku)
      .limit(1);

    if (produtosOlistError) {
      setRelacionamentoErro(`Erro ao buscar produto Olist: ${produtosOlistError.message}`);
      setRelacionamentoLoading(false);
      return;
    }

    const produtoOlist = ((produtosOlistData as ProdutoOlistRelacionamentoRow[]) ?? [])[0] ?? null;
    setRelacionamentoProdutoOlistId(produtoOlist?.id ?? null);

    const { data: associacoesData, error: associacoesError } = await supabase
      .from("produto_olist_produto_fornecedor")
      .select("produto_fornecedor_id, quantidade_usada")
      .eq("produto_id", produto.id);

    if (associacoesError) {
      setRelacionamentoErro(`Erro ao buscar relacionamentos: ${associacoesError.message}`);
      setRelacionamentoLoading(false);
      return;
    }

    const associacoes = (associacoesData as ProdutoOlistFornecedorRow[]) ?? [];
    const fornecedoresIds = Array.from(
      new Set(associacoes.map((associacao) => associacao.produto_fornecedor_id).filter(Boolean)),
    );

    if (fornecedoresIds.length === 0) {
      atualizarStatusProdutoFornecido(false);
      setRelacionamentoLoading(false);
      return;
    }

    const { data: fornecedoresData, error: fornecedoresError } = await supabase
      .from("produtos_fornecedor")
      .select("id, nome, referencia")
      .in("id", fornecedoresIds);

    if (fornecedoresError) {
      setRelacionamentoErro(`Erro ao buscar produtos fornecidos: ${fornecedoresError.message}`);
      setRelacionamentoLoading(false);
      return;
    }

    const fornecedoresPorId = new Map(
      ((fornecedoresData as ProdutoFornecedorRow[]) ?? []).map((fornecedor) => [fornecedor.id, fornecedor]),
    );

    setRelacionamentosProduto(
      associacoes.map((associacao) => {
        const fornecedor = fornecedoresPorId.get(associacao.produto_fornecedor_id);

        return {
          produtoFornecedorId: associacao.produto_fornecedor_id,
          nome: fornecedor?.nome ?? "Produto fornecido nao encontrado",
          referencia: fornecedor?.referencia ?? null,
          quantidadeUsada: numeroDecimal(associacao.quantidade_usada),
        };
      }),
    );
    atualizarStatusProdutoFornecido(associacoes.length > 0);
    setRelacionamentoLoading(false);
  }

  async function carregarProdutosFornecedor() {
    const { data, error } = await supabase
      .from("produtos_fornecedor")
      .select("id, nome, referencia")
      .order("nome");

    if (error) {
      setRelacionamentoErro(`Erro ao carregar produtos fornecidos: ${error.message}`);
      return;
    }

    setProdutosFornecedor((data as ProdutoFornecedorRow[]) ?? []);
  }

  async function visualizarRelacionamentos(produto: Produto) {
    setRelacionamentoProduto(produto);
    setRelacionamentoForm(INITIAL_RELACIONAMENTO_FORM);
    await Promise.all([carregarRelacionamentosProduto(produto), carregarProdutosFornecedor()]);
  }

  async function salvarRelacionamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!relacionamentoProduto) {
      setRelacionamentoErro("Produto nao selecionado para cadastrar produto fornecido.");
      return;
    }

    const produtoFornecedorId = relacionamentoForm.produtoFornecedorId.trim();
    const quantidadeUsada = parseFlexibleDecimalText(relacionamentoForm.quantidadeUsada);

    setRelacionamentoErro(null);

    if (!produtoFornecedorId) {
      setRelacionamentoErro("Selecione o produto fornecido.");
      return;
    }
    if (quantidadeUsada === null || quantidadeUsada <= 0) {
      setRelacionamentoErro("Informe uma quantidade usada valida.");
      return;
    }
    setRelacionamentoSaving(true);

    const { error: deleteError } = await supabase
      .from("produto_olist_produto_fornecedor")
      .delete()
      .eq("produto_id", relacionamentoProduto.id);

    if (deleteError) {
      setRelacionamentoErro(`Erro ao atualizar relacionamento: ${deleteError.message}`);
      setRelacionamentoSaving(false);
      return;
    }

    const { error } = await supabase
      .from("produto_olist_produto_fornecedor")
      .insert({
        produto_id: relacionamentoProduto.id,
        produto_olist_id: relacionamentoProdutoOlistId,
        produto_fornecedor_id: produtoFornecedorId,
        quantidade_usada: quantidadeUsada,
      });

    if (error) {
      setRelacionamentoErro(`Erro ao salvar relacionamento: ${error.message}`);
      setRelacionamentoSaving(false);
      return;
    }

    setRelacionamentoForm(INITIAL_RELACIONAMENTO_FORM);
    await carregarRelacionamentosProduto(relacionamentoProduto);
    await loadProdutos(filtrosAplicados);
    setRelacionamentoSaving(false);
  }

  function editarRelacionamento(relacionamento: RelacionamentoProdutoFornecido) {
    setRelacionamentoForm({
      produtoFornecedorId: relacionamento.produtoFornecedorId,
      quantidadeUsada:
        relacionamento.quantidadeUsada === null ? "" : formatNumberForInput(relacionamento.quantidadeUsada, 4),
      editingProdutoFornecedorId: relacionamento.produtoFornecedorId,
    });
    setRelacionamentoErro(null);
  }

  async function excluirRelacionamento(relacionamento: RelacionamentoProdutoFornecido) {
    if (!relacionamentoProduto) return;

    setRelacionamentoSaving(true);
    setRelacionamentoErro(null);

    const { error } = await supabase
      .from("produto_olist_produto_fornecedor")
      .delete()
      .eq("produto_id", relacionamentoProduto.id);

    if (error) {
      setRelacionamentoErro(`Erro ao excluir relacionamento: ${error.message}`);
      setRelacionamentoSaving(false);
      return;
    }

    if (relacionamentoForm.editingProdutoFornecedorId === relacionamento.produtoFornecedorId) {
      setRelacionamentoForm(INITIAL_RELACIONAMENTO_FORM);
    }

    await carregarRelacionamentosProduto(relacionamentoProduto);
    await loadProdutos(filtrosAplicados);
    setRelacionamentoSaving(false);
  }

  function handleEdit(produto: Produto) {
    if (!podeEditarEstoque) return;

    setEditingId(produto.id);
    setFormOpen(true);
    setFormData({
      sku: produto.sku,
      imagem_url: produto.imagem_url ?? "",
      meta_estoque: produto.meta_estoque === null ? "" : String(produto.meta_estoque),
      minimo_estoque: produto.minimo_estoque === null ? "" : String(produto.minimo_estoque),
      ativo: produto.ativo,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!podeEditarEstoque) return;

    setIsSaving(true);
    setErrorMessage(null);

    const payload = {
      sku: formData.sku.trim(),
      imagem_url: formData.imagem_url.trim() || null,
      meta_estoque: formData.meta_estoque === "" ? null : Number(formData.meta_estoque),
      minimo_estoque: formData.minimo_estoque === "" ? null : Number(formData.minimo_estoque),
      ativo: formData.ativo,
    };

    if (
      !payload.sku ||
      payload.sku.length > PRODUTO_SKU_MAX_LENGTH ||
      (payload.meta_estoque !== null &&
        (Number.isNaN(payload.meta_estoque) || payload.meta_estoque < 0)) ||
      (payload.minimo_estoque !== null &&
        (Number.isNaN(payload.minimo_estoque) || payload.minimo_estoque < 0))
    ) {
      setErrorMessage(`Preencha SKU com ate ${PRODUTO_SKU_MAX_LENGTH} caracteres, meta e minimo de estoque validos.`);
      setIsSaving(false);
      return;
    }

    const query = isEditing
      ? supabase.from("produtos").update(payload).eq("id", editingId)
      : supabase.from("produtos").insert(payload);

    const { error } = await query;

    if (error) {
      setErrorMessage(`Erro ao salvar produto: ${error.message}`);
      setIsSaving(false);
      return;
    }

    await loadProdutos(filtrosAplicados);
    resetForm();
    setIsSaving(false);
  }

  return (
    <AccessGuard permissions={["podeVisualizarEstoque", "podeEditarEstoque"]}>
      <div className="space-y-8">
      <PageHeader
        title="Produtos"
        description="Cadastre, edite e acompanhe os produtos têxteis para produção e estoque."
      />

      {podeEditarEstoque && (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {isEditing ? "Editar produto" : "Cadastrar produto"}
          </h3>
          <button
            type="button"
            onClick={() => {
              if (formOpen) {
                resetForm();
                return;
              }

              setFormOpen(true);
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
            aria-expanded={formOpen}
          >
            {formOpen ? "Fechar" : "Abrir"}
          </button>
        </div>

        {formOpen && (
        <form className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="text-sm text-slate-700">
            SKU
            <input
              required
              maxLength={PRODUTO_SKU_MAX_LENGTH}
              value={formData.sku}
              onChange={(event) => setFormData((prev) => ({ ...prev, sku: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Ex.: CAM-001"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            URL da imagem
            <input
              type="url"
              value={formData.imagem_url}
              onChange={(event) => setFormData((prev) => ({ ...prev, imagem_url: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="https://..."
            />
          </label>

          <label className="text-sm text-slate-700">
            Meta de estoque
            <input
              type="number"
              min={0}
              value={formData.meta_estoque}
              onChange={(event) => setFormData((prev) => ({ ...prev, meta_estoque: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Minimo de estoque
            <input
              type="number"
              min={0}
              value={formData.minimo_estoque}
              onChange={(event) => setFormData((prev) => ({ ...prev, minimo_estoque: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formData.ativo}
              onChange={(event) => setFormData((prev) => ({ ...prev, ativo: event.target.checked }))}
            />
            Produto ativo
          </label>

          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving ? "Salvando..." : isEditing ? "Salvar edição" : "Cadastrar"}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edição
              </button>
            )}
          </div>
        </form>
        )}

        {formOpen && errorMessage && <p className="mt-4 text-sm text-red-600">{errorMessage}</p>}
      </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Listagem de produtos</h3>
            {!isLoading && (
              <p className="text-sm text-slate-600">
                {produtos.length} {produtos.length === 1 ? "produto encontrado" : "produtos encontrados"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-700">
              Itens por página
              <select
                value={itensPorPagina}
                onChange={(event) => {
                  setItensPorPagina(Number(event.target.value));
                  setPaginaAtual(1);
                }}
                className="mt-1 block rounded-md border border-slate-300 px-3 py-2"
              >
                {OPCOES_POR_PAGINA.map((opcao) => (
                  <option key={opcao} value={opcao}>{opcao}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void exportarProdutosCsv()}
              disabled={isLoading || produtosExportando || produtos.length === 0}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {produtosExportando ? "Exportando..." : "Exportar CSV"}
            </button>
            {podeEditarEstoque && (
              <button
                type="button"
                onClick={() => {
                  setImportacaoErro(null);
                  setImportacaoEtapa("arquivo");
                  setProdutosImportados([]);
                  setImportacaoModalOpen(true);
                }}
                className="rounded-md border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
              >
                Importar CSV
              </button>
            )}
            {podeEditarEstoque && (
            <button
              type="button"
              onClick={() => {
                setFabricadoErro(null);
                setFabricadoModalOpen(true);
              }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Importar qtd fabricado
            </button>
            )}
          </div>
        </div>

        {!formOpen && errorMessage && <p className="mb-4 text-sm text-red-600">{errorMessage}</p>}

        <form className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-6" onSubmit={handleFiltrar}>
          <label className="text-sm text-slate-700 md:col-span-2">
            Buscar por SKU
            <input
              value={filtros.sku}
              onChange={(event) => setFiltros((prev) => ({ ...prev, sku: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Digite parte do SKU"
            />
          </label>

          <label className="text-sm text-slate-700">
            Status
            <select
              value={filtros.status}
              onChange={(event) =>
                setFiltros((prev) => ({ ...prev, status: event.target.value as StatusFiltro }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="todos">Todos</option>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Estoque
            <select
              value={filtros.estoque}
              onChange={(event) =>
                setFiltros((prev) => ({ ...prev, estoque: event.target.value as EstoqueFiltro }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="todos">Todos</option>
              <option value="com-meta">Com meta</option>
              <option value="sem-meta">Sem meta</option>
              <option value="com-minimo">Com minimo</option>
              <option value="sem-minimo">Sem minimo</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Produto fornecido
            <select
              value={filtros.produtoFornecido}
              onChange={(event) =>
                setFiltros((prev) => ({
                  ...prev,
                  produtoFornecido: event.target.value as ProdutoFornecidoFiltro,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="todos">Todos</option>
              <option value="com">Com produto fornecido</option>
              <option value="sem">Sem produto fornecido</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            ID Olist
            <select
              value={filtros.idOlist}
              onChange={(event) =>
                setFiltros((prev) => ({
                  ...prev,
                  idOlist: event.target.value as IdOlistFiltro,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="todos">Todos</option>
              <option value="com">Com ID Olist</option>
              <option value="sem">Sem ID Olist</option>
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2 md:col-span-6">
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={limparFiltros}
              disabled={isLoading || !temFiltrosAplicados}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              Limpar filtros
            </button>
          </div>
        </form>

        {isLoading ? (
          <p className="text-sm text-slate-600">Carregando produtos...</p>
        ) : produtos.length === 0 ? (
          <p className="text-sm text-slate-600">
            {temFiltrosAplicados ? "Nenhum produto encontrado para os filtros aplicados." : "Nenhum produto cadastrado."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Imagem</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">ID Olist</th>
                  <th className="p-3">Meta de estoque</th>
                  <th className="p-3">Minimo de estoque</th>
                  <th className="p-3">Ativo</th>
                  <th className="p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {produtosPaginados.map((produto) => (
                  <tr key={produto.id} className="border-b border-slate-100">
                    <td className="p-3">
                      {produto.imagem_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={produto.imagem_url}
                          alt={produto.sku}
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
                          Sem imagem
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-medium text-slate-700">{produto.sku}</td>
                    <td className="p-3 text-slate-700">{produto.id_cadastro_olist || "-"}</td>
                    <td className="p-3 text-slate-700">{produto.meta_estoque ?? "(meta geral)"}</td>
                    <td className="p-3 text-slate-700">{produto.minimo_estoque ?? "(minimo geral)"}</td>
                    <td className="p-3 text-slate-700">{produto.ativo ? "Sim" : "Não"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {(produto.tem_produto_fornecido || podeEditarEstoque) && (
                          <button
                            type="button"
                            onClick={() => visualizarRelacionamentos(produto)}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Detalhes
                          </button>
                        )}
                        {podeEditarEstoque && (
                        <button
                          type="button"
                          onClick={() => handleEdit(produto)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Página {paginaAtual} de {totalPaginas}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaginaAtual((pagina) => Math.max(1, pagina - 1))}
                  disabled={paginaAtual === 1}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPaginaAtual((pagina) => Math.min(totalPaginas, pagina + 1))}
                  disabled={paginaAtual === totalPaginas}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {importacaoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Importar produtos por CSV</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Etapa {importacaoEtapa === "arquivo" ? "1 de 2 — Selecionar arquivo" : "2 de 2 — Confirmar dados"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => fecharImportacao()}
                disabled={importacaoSalvando}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {importacaoEtapa === "arquivo" ? (
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Arquivo CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => void lerArquivoImportacao(event.target.files?.[0] ?? null)}
                      className="mt-2 block w-full rounded-md border border-slate-300 p-3 text-sm"
                    />
                  </label>
                  <p className="text-sm text-slate-600">
                    Use o arquivo gerado em “Exportar CSV”, com as mesmas sete colunas e separador ponto e vírgula.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600">
                      Confira os {produtosImportados.length} produtos antes de confirmar a atualização.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setImportacaoEtapa("arquivo");
                        setProdutosImportados([]);
                        setImportacaoErro(null);
                      }}
                      disabled={importacaoSalvando}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Escolher outro arquivo
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="p-3">SKU</th><th className="p-3">ID Olist</th>
                          <th className="p-3">Meta</th><th className="p-3">Mínimo</th>
                          <th className="p-3">Referência fornecido</th><th className="p-3">Qtd fornecido</th>
                          <th className="p-3">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {produtosImportados.map((produto) => (
                          <tr key={produto.sku} className="border-t border-slate-200">
                            <td className="p-3 font-medium text-slate-800">{produto.sku}</td>
                            <td className="p-3 text-slate-700">{produto.idOlist ?? "-"}</td>
                            <td className="p-3 text-slate-700">{produto.metaEstoque ?? "-"}</td>
                            <td className="p-3 text-slate-700">{produto.minimoEstoque ?? "-"}</td>
                            <td className="p-3 text-slate-700">{produto.referenciaProdutoFornecedor ?? "-"}</td>
                            <td className="p-3 text-slate-700">{produto.quantidadeProdutoFornecedor ?? "-"}</td>
                            <td className="p-3 text-slate-700">{produto.ativo ? "Ativo" : "Inativo"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importacaoErro && (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{importacaoErro}</p>
              )}
            </div>

            {importacaoEtapa === "confirmacao" && (
              <div className="flex justify-end gap-2 border-t border-slate-200 p-5">
                <button
                  type="button"
                  onClick={() => fecharImportacao()}
                  disabled={importacaoSalvando}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmarImportacaoCsv()}
                  disabled={importacaoSalvando || produtosImportados.length === 0}
                  className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {importacaoSalvando ? "Importando..." : "Confirmar importação"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {fabricadoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Importar quantidades de fabricado
                </h3>
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

            <form className="space-y-4 p-5" onSubmit={exportarFabricadoImportado}>
              <label className="block text-sm text-slate-700">
                Linhas para importar
                <textarea
                  required
                  value={fabricadoImportTexto}
                  onChange={(event) => setFabricadoImportTexto(event.target.value)}
                  className="mt-1 min-h-48 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder={"produtosku;produtofornecidoid;qtd\nCAM-001;8be2f383-7289-4851-b78c-f0d74b767c80;1,5\nCAM-002;8be2f383-7289-4851-b78c-f0d74b767c80;0.75"}
                />
              </label>
              <p className="text-xs text-slate-600">
                Use uma linha por produto cadastrado no formato SKU do produto, UUID do produto fornecido
                cadastrado no banco e quantidade. A quantidade aceita decimal com virgula ou ponto.
              </p>

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
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {fabricadoExportando ? "Importando..." : "Importar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {relacionamentoProduto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Produtos fornecidos relacionados
                </h3>
                <p className="mt-1 text-sm text-slate-600">Produto: {relacionamentoProduto.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setRelacionamentoProduto(null)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="p-5">
              {relacionamentoLoading ? (
                <p className="text-sm text-slate-600">Carregando relacionamentos...</p>
              ) : relacionamentosProduto.length === 0 ? (
                <div className="space-y-4">
                  {relacionamentoErro && (
                    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {relacionamentoErro}
                    </p>
                  )}
                  <p className="text-sm text-slate-600">
                    Nenhum produto fornecido relacionado a este produto.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {relacionamentoErro && (
                    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {relacionamentoErro}
                    </p>
                  )}

                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                          <th className="p-3">Produto fornecido</th>
                          <th className="p-3">Referência</th>
                          <th className="p-3">Qtd usada</th>
                          {podeEditarEstoque && <th className="p-3">Ações</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {relacionamentosProduto.map((relacionamento) => (
                          <tr key={relacionamento.produtoFornecedorId} className="border-b border-slate-100">
                            <td className="p-3 text-slate-700">{relacionamento.nome}</td>
                            <td className="p-3 text-slate-700">{relacionamento.referencia ?? "-"}</td>
                            <td className="p-3 text-slate-700">
                              {formatarDecimal(relacionamento.quantidadeUsada)} m
                            </td>
                            {podeEditarEstoque && (
                              <td className="p-3">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => editarRelacionamento(relacionamento)}
                                    disabled={relacionamentoSaving}
                                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => excluirRelacionamento(relacionamento)}
                                    disabled={relacionamentoSaving}
                                    className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    Excluir
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {podeEditarEstoque && !relacionamentoLoading && (
                <form className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-200 pt-5 md:grid-cols-5" onSubmit={salvarRelacionamento}>
                  <label className="text-sm text-slate-700 md:col-span-3">
                    Produto fornecido
                    <select
                      required
                      value={relacionamentoForm.produtoFornecedorId}
                      onChange={(event) =>
                        setRelacionamentoForm((prev) => ({ ...prev, produtoFornecedorId: event.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                    >
                      <option value="">Selecione</option>
                      {produtosFornecedor.map((produtoFornecedor) => (
                        <option key={produtoFornecedor.id} value={produtoFornecedor.id}>
                          {produtoFornecedor.nome}
                          {produtoFornecedor.referencia ? ` - ${produtoFornecedor.referencia}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm text-slate-700">
                    Qtd usada
                    <input
                      required
                      inputMode="decimal"
                      value={relacionamentoForm.quantidadeUsada}
                      onChange={(event) =>
                        setRelacionamentoForm((prev) => ({ ...prev, quantidadeUsada: event.target.value }))
                      }
                      onBlur={() =>
                        setRelacionamentoForm((prev) => ({
                          ...prev,
                          quantidadeUsada: prev.quantidadeUsada
                            ? normalizeFlexibleDecimalText(prev.quantidadeUsada, 4)
                            : prev.quantidadeUsada,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                      placeholder="Ex.: 1,5"
                    />
                  </label>

                  <div className="flex items-end gap-2">
                    <button
                      type="submit"
                      disabled={relacionamentoSaving}
                      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {relacionamentoSaving
                        ? "Salvando..."
                        : relacionamentoForm.editingProdutoFornecedorId
                          ? "Salvar"
                          : "Incluir"}
                    </button>
                    {relacionamentoForm.editingProdutoFornecedorId && (
                      <button
                        type="button"
                        onClick={() => setRelacionamentoForm(INITIAL_RELACIONAMENTO_FORM)}
                        disabled={relacionamentoSaving}
                        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </AccessGuard>
  );
}
