import axios, { AxiosResponse } from "axios";
import { getAplicativoOlistConfig } from "@/lib/aplicativo";
import { prisma } from "@/lib/prisma";

/* =========================================================
 * CONFIGURAÇÕES
 * ======================================================= */

const SITUACOES_PADRAO = ["3", "4", "1"];
const SITUACOES_PERMITIDAS = new Set(["8", "0", "3", "4", "1", "7", "5", "6", "2", "9"]);
const CONTROLE_BUSCA_BAIXA_ESTOQUE = "baixa_estoque_olist";
const SITUACOES_BAIXA_ESTOQUE = ["7", "5", "6"];
const SITUACAO_PRODUTO_ATIVO = "A";

/* =========================================================
 * TYPES
 * ======================================================= */

type FiltroDataBase = "APROVACAO_PEDIDO" | "CRIACAO_PEDIDO";

type OlistOrderItem = {
  produto: {
    sku: string;
  };
  quantidade: number;
};

type OlistOrder = {
  id: string | number;
  itens?: OlistOrderItem[];
};

type ProdutoRow = {
  id: string;
  sku: string;
  imagem_url: string | null;
  meta_estoque: number | null;
  minimo_estoque: number | null;
  ativo: boolean;
};

type EstoqueAtualRow = {
  sku: string;
  estoque_atual: number | null;
};

type ItemSolicitacao = {
  produto_id: string;
  sku: string;
  imagem_url: string | null;
  quantidade_solicitada: number;
  prioridade_producao: boolean;
  existe_em_producao?: boolean;
  quantidade_em_producao?: number;
  quantidade_pedidos?: number;
  estoque_atual?: number;
};

type ItemEstoqueSuficiente = {
  sku: string;
  estoque_atual: number;
  quantidade_pedidos: number;
  estoque_apos_pedidos: number;
  minimo_estoque: number;
};

export class NecessidadeProducaoError extends Error {
  estoqueSuficiente: ItemEstoqueSuficiente[];

  constructor(estoqueSuficiente: ItemEstoqueSuficiente[]) {
    super("Não há necessidade de produção.");
    this.name = "NecessidadeProducaoError";
    this.estoqueSuficiente = estoqueSuficiente;
  }
}

type ItemBaixaEstoqueInput = {
  sku: string;
  quantidade: number;
  pedidoOlistId?: string | null;
  itemOlistId?: string | null;
  observacao?: string | null;
};

function isPrismaUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

type ProdutoOlistListagem = {
  id?: string | number;
  sku?: string | number | null;
  descricao?: string | null;
  tipo?: string | null;
  situacao?: string | null;
  dataCriacao?: string | null;
  dataAlteracao?: string | null;
  unidade?: string | null;
  gtin?: string | null;
  precos?: unknown;
  estoque?: unknown;
  tipoVariacao?: string | null;
};

export type FiltrosListagemProdutosOlist = {
  nome?: string;
  codigo?: string;
  gtin?: string;
  situacao?: "A" | "I" | "E";
  limit: number;
  offset: number;
};

export type ListagemProdutosOlist = {
  itens: ProdutoOlistListagem[];
  paginacao: {
    limit: number;
    offset: number;
    total: number;
  };
};

type ContatoOlistListagem = {
  id?: string | number;
  nome?: string | null;
  codigo?: string | null;
  fantasia?: string | null;
  tipoPessoa?: "J" | "F" | "E" | "X" | null;
  cpfCnpj?: string | null;
  inscricaoEstadual?: string | null;
  rg?: string | null;
  telefone?: string | null;
  celular?: string | null;
  email?: string | null;
  endereco?: Record<string, unknown> | null;
  vendedor?: Record<string, unknown> | null;
  situacao?: "B" | "A" | "I" | "E" | null;
  statusCrm?: "L" | "P" | "C" | "I" | null;
  dataCriacao?: string | null;
  dataAtualizacao?: string | null;
};

export type FiltrosListagemContatosOlist = {
  nome?: string;
  codigo?: string;
  situacao?: "B" | "A" | "I" | "E";
  idVendedor?: string;
  cpfCnpj?: string;
  celular?: string;
  orderBy?: "asc" | "desc";
  limit: number;
  offset: number;
};

export type FiltrosListagemPedidosOlist = {
  numero?: string;
  nomeCliente?: string;
  codigoCliente?: string;
  cpfCnpj?: string;
  dataInicial?: string;
  dataFinal?: string;
  situacao?: string;
  numeroPedidoEcommerce?: string;
  origemPedido?: "0" | "1";
  orderBy?: "asc" | "desc";
  limit: number;
  offset: number;
};

export type FiltrosListagemVendedoresOlist = {
  nome?: string;
  codigo?: string;
  limit: number;
  offset: number;
};

/* =========================================================
 * HELPERS
 * ======================================================= */

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizarBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arredondarParaPar(valor: number) {
  return valor % 2 === 0 ? valor : valor + 1;
}

function logIntegracaoOlist(input: {
  endpoint: string;
  status: number;
  modulo: string;
  quantidade?: number;
  total?: number | null;
  limit?: number;
  offset?: number;
}) {
  console.info("[olist-api]", input);
}

function validarRespostaAxiosJsonOrThrow(response: AxiosResponse<unknown>) {
  const contentType = String(response.headers["content-type"] ?? "");
  const bodyText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data ?? "");

  const isHtml =
    contentType.includes("text/html") ||
    /<html|<script|alert\(/i.test(bodyText);

  if (isHtml) {
    throw new Error(
      "Endpoint incorreto: a Olist retornou HTML em vez de JSON.",
    );
  }
}

function isErroTiny429(error: unknown) {
  return error instanceof Error && error.message.includes("Erro Tiny 429");
}

function normalizarPayloadPedidos(payload: unknown): OlistOrder[] {
  if (!payload || typeof payload !== "object") return [];

  const dataObj = payload as Record<string, unknown>;

  const data =
    dataObj.itens ?? dataObj.data ?? dataObj.orders ?? dataObj.results;

  return Array.isArray(data) ? (data as OlistOrder[]) : [];
}

function normalizarPayloadProdutos(payload: unknown): ProdutoOlistListagem[] {
  if (!payload || typeof payload !== "object") return [];

  const dataObj = payload as Record<string, unknown>;
  const data =
    dataObj.itens ?? dataObj.data ?? dataObj.produtos ?? dataObj.results;

  return Array.isArray(data) ? (data as ProdutoOlistListagem[]) : [];
}

function extrairTotalPaginacao(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const paginacao = (payload as Record<string, unknown>).paginacao;

  if (!paginacao || typeof paginacao !== "object") return null;

  const data = paginacao as Record<string, unknown>;
  const total =
    data.total ??
    data.totalRegistros ??
    data.total_registros ??
    data.quantidadeTotal;
  const totalNumber = Number(total);

  return Number.isFinite(totalNumber) ? totalNumber : null;
}

export async function listarContatosOlistApi(aplicativoId: string, filtros: FiltrosListagemContatosOlist) {
  const token = await getValidOlistAccessToken(aplicativoId);
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("contatos", normalizarBaseUrl(olistConfig.apiBaseUrl));

  url.searchParams.set("limit", String(filtros.limit));
  url.searchParams.set("offset", String(filtros.offset));
  if (filtros.nome) url.searchParams.set("nome", filtros.nome);
  if (filtros.codigo) url.searchParams.set("codigo", filtros.codigo);
  if (filtros.situacao) url.searchParams.set("situacao", filtros.situacao);
  if (filtros.idVendedor) url.searchParams.set("idVendedor", filtros.idVendedor);
  if (filtros.cpfCnpj) url.searchParams.set("cpfCnpj", filtros.cpfCnpj);
  if (filtros.celular) url.searchParams.set("celular", filtros.celular);
  if (filtros.orderBy) url.searchParams.set("orderBy", filtros.orderBy);

  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });

  logIntegracaoOlist({ endpoint: url.toString(), status: response.status, modulo: "contatos-listagem" });
  validarRespostaAxiosJsonOrThrow(response);
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) throw new Error("Token inválido ou sem permissão.");
    throw new Error(`Erro Olist ${response.status}`);
  }

  const payload = response.data && typeof response.data === "object"
    ? response.data as Record<string, unknown>
    : {};
  const dados = payload.itens ?? payload.data ?? payload.contatos ?? payload.results;
  const itens = Array.isArray(dados) ? dados as ContatoOlistListagem[] : [];
  return {
    itens,
    paginacao: {
      limit: filtros.limit,
      offset: filtros.offset,
      total: extrairTotalPaginacao(response.data) ?? itens.length,
    },
  };
}

export async function listarPedidosOlistApi(aplicativoId: string, filtros: FiltrosListagemPedidosOlist) {
  const token = await getValidOlistAccessToken(aplicativoId);
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("pedidos", normalizarBaseUrl(olistConfig.apiBaseUrl));

  url.searchParams.set("limit", String(filtros.limit));
  url.searchParams.set("offset", String(filtros.offset));
  const opcionais = {
    numero: filtros.numero,
    nomeCliente: filtros.nomeCliente,
    codigoCliente: filtros.codigoCliente,
    cpfCnpj: filtros.cpfCnpj,
    dataInicial: filtros.dataInicial,
    dataFinal: filtros.dataFinal,
    situacao: filtros.situacao,
    numeroPedidoEcommerce: filtros.numeroPedidoEcommerce,
    origemPedido: filtros.origemPedido,
    orderBy: filtros.orderBy,
  };
  Object.entries(opcionais).forEach(([chave, valor]) => { if (valor) url.searchParams.set(chave, valor); });

  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  logIntegracaoOlist({ endpoint: url.toString(), status: response.status, modulo: "pedidos-listagem" });
  validarRespostaAxiosJsonOrThrow(response);
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) throw new Error("Token inválido ou sem permissão.");
    throw new Error(`Erro Olist ${response.status}`);
  }

  const payload = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
  const dados = payload.itens ?? payload.data ?? payload.pedidos ?? payload.results;
  const itens = Array.isArray(dados) ? dados as Record<string, unknown>[] : [];
  const total = extrairTotalPaginacao(response.data) ?? itens.length;
  logIntegracaoOlist({
    endpoint: url.toString(), status: response.status, modulo: "pedidos-listagem-retorno",
    quantidade: itens.length, total, limit: filtros.limit, offset: filtros.offset,
  });
  return { itens, paginacao: { limit: filtros.limit, offset: filtros.offset, total } };
}

export async function listarVendedoresOlistApi(aplicativoId: string, filtros: FiltrosListagemVendedoresOlist) {
  const token = await getValidOlistAccessToken(aplicativoId);
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("vendedores", normalizarBaseUrl(olistConfig.apiBaseUrl));
  url.searchParams.set("limit", String(filtros.limit));
  url.searchParams.set("offset", String(filtros.offset));
  if (filtros.nome) url.searchParams.set("nome", filtros.nome);
  if (filtros.codigo) url.searchParams.set("codigo", filtros.codigo);

  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true,
  });
  logIntegracaoOlist({ endpoint: url.toString(), status: response.status, modulo: "vendedores-listagem" });
  validarRespostaAxiosJsonOrThrow(response);
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) throw new Error("Token inválido ou sem permissão.");
    throw new Error(`Erro Olist ${response.status}`);
  }

  const payload = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
  const dados = payload.itens ?? payload.data ?? payload.vendedores ?? payload.results;
  const itens = Array.isArray(dados) ? dados as Record<string, unknown>[] : [];
  const total = extrairTotalPaginacao(response.data) ?? itens.length;
  logIntegracaoOlist({
    endpoint: url.toString(), status: response.status, modulo: "vendedores-listagem-retorno",
    quantidade: itens.length, total, limit: filtros.limit, offset: filtros.offset,
  });
  return { itens, paginacao: { limit: filtros.limit, offset: filtros.offset, total } };
}

export async function criarPedidoOlistApi(aplicativoId: string, pedido: Record<string, unknown>) {
  const token = await getValidOlistAccessToken(aplicativoId);
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("pedidos", normalizarBaseUrl(olistConfig.apiBaseUrl));
  const response = await axios.post(url.toString(), pedido, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    validateStatus: () => true,
  });
  logIntegracaoOlist({ endpoint: url.toString(), status: response.status, modulo: "pedidos-criacao" });
  validarRespostaAxiosJsonOrThrow(response);
  if (response.status < 200 || response.status >= 300) {
    const detalhe = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? {});
    throw new Error(response.status === 401 ? "Token inválido ou sem permissão." : `Erro Olist ${response.status}: ${detalhe}`);
  }
  return response.data as { id?: number; numeroPedido?: string };
}

export async function listarProdutosOlistApi(
  aplicativoId: string,
  filtros: FiltrosListagemProdutosOlist,
): Promise<ListagemProdutosOlist> {
  const token = await getValidOlistAccessToken(aplicativoId);
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("produtos", normalizarBaseUrl(olistConfig.apiBaseUrl));

  url.searchParams.set("limit", String(filtros.limit));
  url.searchParams.set("offset", String(filtros.offset));
  if (filtros.nome) url.searchParams.set("nome", filtros.nome);
  if (filtros.codigo) url.searchParams.set("codigo", filtros.codigo);
  if (filtros.gtin) url.searchParams.set("gtin", filtros.gtin);
  if (filtros.situacao) url.searchParams.set("situacao", filtros.situacao);

  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });

  logIntegracaoOlist({
    endpoint: url.toString(),
    status: response.status,
    modulo: "produtos-listagem",
  });
  validarRespostaAxiosJsonOrThrow(response);

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) {
      throw new Error("Token inválido ou sem permissão.");
    }
    throw new Error(`Erro Olist ${response.status}`);
  }

  const itens = normalizarPayloadProdutos(response.data);
  const total = extrairTotalPaginacao(response.data);
  logIntegracaoOlist({
    endpoint: url.toString(),
    status: response.status,
    modulo: "produtos-listagem-retorno",
    quantidade: itens.length,
    total,
    limit: filtros.limit,
    offset: filtros.offset,
  });
  return {
    itens,
    paginacao: {
      limit: filtros.limit,
      offset: filtros.offset,
      total: total ?? itens.length,
    },
  };
}

/* =========================================================
 * OAUTH
 * ======================================================= */

async function renovarTokenComRefresh(aplicativoId: string, refreshToken: string) {
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const clientId = olistConfig.clientId;
  const clientSecret = olistConfig.clientSecret;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais da API v3 ausentes.");
  }

  const response = await axios.post(
    olistConfig.oauthUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      validateStatus: () => true,
    },
  );

  logIntegracaoOlist({
    endpoint: olistConfig.oauthUrl,
    status: response.status,
    modulo: "oauth-refresh",
  });

  validarRespostaAxiosJsonOrThrow(response);

  if (response.status < 200 || response.status >= 300) {
    throw new Error("Falha ao renovar token OAuth.");
  }

  return response.data as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

function normalizarSituacoes(situacoes?: string[]) {
  const situacoesNormalizadas = (
    situacoes?.length ? situacoes : SITUACOES_PADRAO
  )
    .map((situacao) => String(situacao).trim())
    .filter((situacao) => SITUACOES_PERMITIDAS.has(situacao));

  const unicas = [...new Set(situacoesNormalizadas)];

  if (unicas.length === 0) {
    throw new Error("Selecione ao menos uma situacao para consultar pedidos.");
  }

  return unicas;
}

export async function getValidOlistAccessToken(aplicativoId: string) {
  const now = new Date();

  const tokenRow = await prisma.integracaoOlistToken.findFirst({
    where: { aplicativoId, provider: "olist" },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  });

  if (
    tokenRow?.accessToken &&
    tokenRow?.expiresAt &&
    tokenRow.expiresAt > now
  ) {
    return tokenRow.accessToken;
  }

  if (tokenRow?.refreshToken) {
    const refreshed = await renovarTokenComRefresh(aplicativoId, tokenRow.refreshToken);

    const expiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : null;

    const tokenData = {
      aplicativoId,
      accessToken: refreshed.access_token ?? null,
      refreshToken: refreshed.refresh_token ?? tokenRow.refreshToken,
      expiresAt,
      status: refreshed.access_token ? "conectado" : "erro_autenticacao",
      updatedAt: new Date(),
    };
    if (tokenRow.id) {
      await prisma.integracaoOlistToken.update({ where: { id: tokenRow.id }, data: tokenData });
    } else {
      await prisma.integracaoOlistToken.create({ data: {
        provider: "olist",
        ...tokenData,
      } });
    }

    if (refreshed.access_token) {
      return refreshed.access_token;
    }
  }

  throw new Error("Falha no OAuth Olist/Tiny.");
}

type CategoriaOlistImportada = {
  olistId: string;
  nome: string;
  caminho: string;
  parentOlistId: string | null;
  nivel: number;
};

export async function listarArvoreCategoriasOlist(aplicativoId: string): Promise<CategoriaOlistImportada[]> {
  const token = await getValidOlistAccessToken(aplicativoId);
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("categorias/todas", normalizarBaseUrl(olistConfig.apiBaseUrl));
  const response = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });

  logIntegracaoOlist({ endpoint: url.toString(), status: response.status, modulo: "categorias" });
  validarRespostaAxiosJsonOrThrow(response);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.status === 401 ? "Token inválido ou sem permissão." : `Erro Olist ${response.status}`);
  }

  const resultado: CategoriaOlistImportada[] = [];
  const visitados = new Set<string>();
  const raiz = response.data as unknown;

  function visitar(valor: unknown, pai: string | null, nomesPais: string[], nivel: number) {
    if (Array.isArray(valor)) {
      valor.forEach((item) => visitar(item, pai, nomesPais, nivel));
      return;
    }
    if (!valor || typeof valor !== "object") return;
    const item = valor as Record<string, unknown>;
    const idRaw = item.id ?? item.idCategoria ?? item.codigo ?? item.categoriaId;
    const nomeRaw = item.nome ?? item.descricao ?? item.titulo;
    const id = idRaw === undefined || idRaw === null ? null : String(idRaw);
    const nome = typeof nomeRaw === "string" ? nomeRaw.trim() : "";
    const filhos =
      item.filhos ??
      item.filhas ??
      item.children ??
      item.subcategorias ??
      item.subCategorias ??
      item.categorias;

    if (id && nome) {
      if (!visitados.has(id)) {
        resultado.push({ olistId: id, nome, caminho: [...nomesPais, nome].join(" > "), parentOlistId: pai, nivel });
        visitados.add(id);
      }
      visitar(filhos, id, [...nomesPais, nome], nivel + 1);
      return;
    }

    for (const [chave, conteudo] of Object.entries(item)) {
      if (["data", "itens", "results", "categorias", "arvore"].includes(chave)) visitar(conteudo, pai, nomesPais, nivel);
    }
  }

  visitar(raiz, null, [], 0);
  return resultado;
}

/* =========================================================
 * API OLIST
 * ======================================================= */

async function listarPedidosOlist(
  token: string,
  aplicativoId: string,
  periodoInicio: Date | null,
  periodoFim: Date | null,
  situacao: string,
) {
  const limite = 100;
  const pedidos: OlistOrder[] = [];
  let offset = 0;
  let total: number | null = null;
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);

  while (true) {
    const url = new URL("pedidos", normalizarBaseUrl(olistConfig.apiBaseUrl));

    if (periodoInicio && periodoFim) {
      url.searchParams.set("dataInicial", inputDate(periodoInicio));
      url.searchParams.set("dataFinal", inputDate(periodoFim));
    }

    url.searchParams.set("situacao", situacao);

    url.searchParams.set("limit", String(limite));

    url.searchParams.set("offset", String(offset));

    url.searchParams.set("orderBy", "asc");

    const response = await axios.get(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      validateStatus: () => true,
    });

    logIntegracaoOlist({
      endpoint: url.toString(),
      status: response.status,
      modulo: "pedidos",
    });

    if (response.status < 200 || response.status >= 300) {
      validarRespostaAxiosJsonOrThrow(response);

      if (response.status === 401) {
        throw new Error("Token inválido ou sem permissão.");
      }

      throw new Error(`Erro Tiny ${response.status}`);
    }

    const payload = response.data;
    const paginaPedidos = normalizarPayloadPedidos(payload);

    if (total === null) {
      total = extrairTotalPaginacao(payload);
    }

    pedidos.push(...paginaPedidos);

    offset += limite;

    if (paginaPedidos.length < limite || (total !== null && offset >= total)) {
      return pedidos;
    }

    await aguardar(300);
  }
}

async function buscarDetalhePedidoOlist(
  token: string,
  aplicativoId: string,
  pedidoId: string | number,
) {
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL(
    `pedidos/${pedidoId}`,
    normalizarBaseUrl(olistConfig.apiBaseUrl),
  );

  const response = await axios.get(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    validateStatus: () => true,
  });

  logIntegracaoOlist({
    endpoint: url.toString(),
    status: response.status,
    modulo: "pedido-detalhe",
  });

  if (response.status < 200 || response.status >= 300) {
    validarRespostaAxiosJsonOrThrow(response);

    if (response.status === 401) {
      throw new Error("Token inválido ou sem permissão.");
    }

    throw new Error(`Erro Tiny ${response.status}`);
  }

  const responseJson = response.data as OlistOrder;

  return {
    id: pedidoId,
    itens: (responseJson.itens ?? []) as OlistOrderItem[],
  };
}

async function listarProdutosOlist(token: string, aplicativoId: string, offset: number, limite: number) {
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const url = new URL("produtos", normalizarBaseUrl(olistConfig.apiBaseUrl));

  url.searchParams.set("limit", String(limite));
  url.searchParams.set("offset", String(offset));

  const response = await axios.get(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    validateStatus: () => true,
  });

  logIntegracaoOlist({
    endpoint: url.toString(),
    status: response.status,
    modulo: "produtos",
  });

  if (response.status < 200 || response.status >= 300) {
    validarRespostaAxiosJsonOrThrow(response);

    if (response.status === 401) {
      throw new Error("Token inválido ou sem permissão.");
    }

    throw new Error(`Erro Tiny ${response.status}`);
  }

  return {
    produtos: normalizarPayloadProdutos(response.data),
    total: extrairTotalPaginacao(response.data),
  };
}

function normalizarProdutoOlist(produto: ProdutoOlistListagem) {
  const sku = String(produto.sku ?? "").trim();
  const idCadastroOlist = produto.id === null || produto.id === undefined ? null : String(produto.id).trim() || null;
  const situacao = String(produto.situacao ?? "A").toUpperCase();

  if (!sku) {
    return null;
  }

  return {
    sku,
    idCadastroOlist,
    imagemUrl: null,
    ativo: situacao === SITUACAO_PRODUTO_ATIVO,
  };
}

export async function importarProdutosOlist(aplicativoId: string) {
  const token = await getValidOlistAccessToken(aplicativoId);
  const limite = 100;
  let offset = 0;
  let total: number | null = null;
  let lidos = 0;
  let criados = 0;
  let atualizados = 0;
  let ignorados = 0;
  const vistos = new Set<string>();

  while (true) {
    const pagina = await listarProdutosOlist(token, aplicativoId, offset, limite);

    if (total === null) {
      total = pagina.total;
    }

    if (pagina.produtos.length === 0) {
      break;
    }

    for (const produtoOlist of pagina.produtos) {
      lidos += 1;

      const produto = normalizarProdutoOlist(produtoOlist);

      if (!produto || vistos.has(produto.sku)) {
        ignorados += 1;
        continue;
      }

      vistos.add(produto.sku);

      const existente = await prisma.produto.findUnique({
        where: { sku: produto.sku },
        select: { id: true },
      });

      await prisma.produto.upsert({
        where: { sku: produto.sku },
        create: {
          sku: produto.sku,
          idCadastroOlist: produto.idCadastroOlist,
          imagemUrl: produto.imagemUrl,
          ativo: produto.ativo,
        },
        update: {
          idCadastroOlist: produto.idCadastroOlist,
          imagemUrl: produto.imagemUrl,
          ativo: produto.ativo,
        },
      });

      if (existente) {
        atualizados += 1;
      } else {
        criados += 1;
      }
    }

    offset += pagina.produtos.length;

    if (total !== null && offset >= total) {
      break;
    }

    await aguardar(300);
  }

  return {
    lidos,
    criados,
    atualizados,
    ignorados,
  };
}

export async function buscarPedidosOlistPorDataLimite(
  aplicativoId: string,
  periodoInicio: Date | null,
  periodoFim: Date | null,
  situacoes: string[],
): Promise<{
  pedidos: OlistOrder[];
  pedidosEncontrados: number;
}> {
  const token = await getValidOlistAccessToken(aplicativoId);

  const pedidos: OlistOrder[] = [];

  for (const situacao of situacoes) {
    const pedidosPorSituacao = await listarPedidosOlist(
      token,
      aplicativoId,
      periodoInicio,
      periodoFim,
      situacao,
    );

    pedidos.push(...pedidosPorSituacao);

    await aguardar(500);
  }

  const pedidosUnicos = Array.from(
    new Map(pedidos.map((pedido) => [String(pedido.id), pedido])).values(),
  );

  const resultados = [];

  for (const pedido of pedidosUnicos) {
    const detalhe = await buscarDetalhePedidoOlist(token, aplicativoId, pedido.id);

    resultados.push(detalhe);

    await aguardar(500);
  }

  return {
    pedidos: resultados,
    pedidosEncontrados: pedidosUnicos.length,
  };
}

/* =========================================================
 * PROCESSAMENTO
 * ======================================================= */

function extrairParesPedidoItem(pedidos: OlistOrder[]) {
  return pedidos.flatMap((pedido) =>
    (pedido.itens ?? []).map((item) => ({
      pedido_olist_id: String(pedido.id),
      item_olist_id: item.produto.sku,
    })),
  );
}

async function buscarPedidosComBaixaJaRegistrada(pedidos: OlistOrder[]) {
  const pedidosIds = [...new Set(pedidos.map((pedido) => String(pedido.id)))];

  if (pedidosIds.length === 0) {
    return new Set<string>();
  }

  const baixadosRows = await prisma.itemBaixaEstoqueOlist.findMany({
    where: {
      pedidoOlistId: { in: pedidosIds },
    },
    select: {
      pedidoOlistId: true,
    },
  });

  return new Set(
    baixadosRows
      .map((row) => row.pedidoOlistId)
      .filter((pedidoId): pedidoId is string => Boolean(pedidoId)),
  );
}

function agregarItensNovos(pedidos: OlistOrder[]) {
  const agregados = new Map<
    string,
    {
      sku: string;
      imagem_url: string | null;
      quantidade_pedidos: number;
    }
  >();

  const itensNovosProcessados: Array<{
    pedido_olist_id: string;
    item_olist_id: string;
    sku: string;
  }> = [];

  const novosProcessadosSet = new Set<string>();

  let pedidosAdicionados = 0;

  for (const pedido of pedidos) {
    if (!pedido.itens?.length) {
      throw new Error(`Pedido Olist ${pedido.id} retornado sem itens.`);
    }

    for (const item of pedido.itens ?? []) {
      const sku = String(item.produto.sku).trim();

      if (!sku) {
        throw new Error(`Pedido Olist ${pedido.id} contém item sem SKU.`);
      }

      const quantidade = Number(item.quantidade);

      if (!Number.isFinite(quantidade) || quantidade <= 0) {
        throw new Error(`Pedido Olist ${pedido.id}, SKU ${sku}, contém quantidade inválida.`);
      }

      const itemOlistId = item.produto.sku;
      const chaveProcessamento = `${pedido.id}::${itemOlistId}`;

      const atual = agregados.get(sku) ?? {
        sku,
        imagem_url: null,
        quantidade_pedidos: 0,
      };

      atual.quantidade_pedidos += quantidade;

      agregados.set(sku, atual);

      if (!novosProcessadosSet.has(chaveProcessamento)) {
        itensNovosProcessados.push({
          pedido_olist_id: String(pedido.id),
          item_olist_id: itemOlistId,
          sku,
        });

        novosProcessadosSet.add(chaveProcessamento);
      }
    }

    pedidosAdicionados += 1;
  }

  return {
    agregados,
    itensNovosProcessados,
    pedidosAdicionados,
    skus: [...agregados.keys()],
  };
}

/* =========================================================
 * DADOS INTERNOS
 * ======================================================= */

async function buscarEstoqueAtual(skus: string[]) {
  if (skus.length === 0) return [];

  const movimentacoes = await prisma.movimentacaoEstoque.groupBy({
    by: ["sku", "tipoMovimento"],
    where: {
      sku: { in: skus },
    },
    _sum: {
      quantidade: true,
    },
  });

  const estoquePorSku = new Map(skus.map((sku) => [sku, 0]));

  for (const movimentacao of movimentacoes) {
    const quantidade = Number(movimentacao._sum.quantidade ?? 0);
    const atual = estoquePorSku.get(movimentacao.sku) ?? 0;
    const sinal = movimentacao.tipoMovimento === "saida" ? -1 : 1;

    estoquePorSku.set(movimentacao.sku, atual + quantidade * sinal);
  }

  return [...estoquePorSku.entries()].map(([sku, estoque_atual]) => ({
    sku,
    estoque_atual,
  }));
}

async function buscarDadosInternos(skus: string[]) {
  const [produtos, estoqueRows, cfgRows] = await Promise.all([
    prisma.produto.findMany({
      where: {
        sku: { in: skus },
      },
      select: {
        id: true,
        sku: true,
        imagemUrl: true,
        metaEstoque: true,
        minimoEstoque: true,
        ativo: true,
      },
    }),

    buscarEstoqueAtual(skus),

    prisma.configuracaoSistema.findMany({
      where: {
        chave: { in: ["META_GERAL_ESTOQUE", "MINIMO_GERAL_ESTOQUE"] },
      },
      select: { chave: true, valor: true },
    }),
  ]);

  const configsMap = new Map(
    cfgRows.map((config) => [config.chave, Number(config.valor)]),
  );

  return {
    produtos: produtos.map((produto) => ({
      id: produto.id,
      sku: produto.sku,
      imagem_url: produto.imagemUrl,
      meta_estoque: produto.metaEstoque,
      minimo_estoque: produto.minimoEstoque,
      ativo: produto.ativo,
    })) satisfies ProdutoRow[],
    estoqueRows,
    metaGeral: configsMap.get("META_GERAL_ESTOQUE") ?? 0,
    minimoGeral: configsMap.get("MINIMO_GERAL_ESTOQUE") ?? 0,
  };
}

function montarItensSolicitacao(
  agregados: Map<
    string,
    {
      sku: string;
      imagem_url: string | null;
      quantidade_pedidos: number;
    }
  >,
  produtos: ProdutoRow[],
  estoqueRows: EstoqueAtualRow[],
  metaGeral: number,
  minimoGeral: number,
) {
  const estoqueMap = new Map(
    estoqueRows.map((e) => [e.sku, Number(e.estoque_atual ?? 0)]),
  );

  const itens: ItemSolicitacao[] = [];
  const estoqueSuficiente: ItemEstoqueSuficiente[] = [];
  let prioridadeProducao = false;

  for (const produto of produtos) {
    if (!produto.ativo) continue;

    const demanda = agregados.get(produto.sku);

    if (!demanda) continue;

    const estoqueAtual = estoqueMap.get(produto.sku) ?? 0;
    const quantidadePedidosIntegracao = Number(demanda.quantidade_pedidos ?? 0);

    const metaEstoque = produto.meta_estoque ?? metaGeral;
    const minimoEstoque = produto.minimo_estoque ?? minimoGeral;
    const estoqueAposPedidos = estoqueAtual - quantidadePedidosIntegracao;

    const prioridadeItem = estoqueAtual < quantidadePedidosIntegracao;

    if (prioridadeItem) {
      prioridadeProducao = true;
    }

    if (estoqueAposPedidos >= minimoEstoque) {
      estoqueSuficiente.push({
        sku: produto.sku,
        estoque_atual: estoqueAtual,
        quantidade_pedidos: quantidadePedidosIntegracao,
        estoque_apos_pedidos: estoqueAposPedidos,
        minimo_estoque: minimoEstoque,
      });
      continue;
    }

    const quantidadeMinimaPedido = Math.ceil(quantidadePedidosIntegracao);
    const quantidadeAProduzir = arredondarParaPar(
      Math.max(0, metaEstoque - estoqueAposPedidos, quantidadeMinimaPedido),
    );

    itens.push({
      produto_id: produto.id,
      sku: produto.sku,
      imagem_url: produto.imagem_url ?? demanda.imagem_url,
      quantidade_solicitada: quantidadeAProduzir,
      prioridade_producao: prioridadeItem,
      quantidade_pedidos: quantidadePedidosIntegracao,
      estoque_atual: estoqueAtual,
    });
  }

  return { itens, prioridadeProducao, estoqueSuficiente };
}


async function marcarItensJaSolicitadosEmProducao(itens: ItemSolicitacao[]) {
  if (itens.length === 0) return itens;

  const skus = [...new Set(itens.map((item) => item.sku))];
  const solicitacoesEmProducao = await prisma.solicitacaoProducao.findMany({
    where: { status: "em_producao" },
    select: { id: true },
  });
  const solicitacoesIds = solicitacoesEmProducao.map((solicitacao) => solicitacao.id);

  if (solicitacoesIds.length === 0) return itens;

  const itensEmProducao = await prisma.itemSolicitacaoProducao.groupBy({
    by: ["sku"],
    where: {
      solicitacaoId: { in: solicitacoesIds },
      sku: { in: skus },
    },
    _sum: {
      quantidadeSolicitada: true,
    },
  });
  const quantidadePorSku = new Map(
    itensEmProducao.map((item) => [item.sku, Number(item._sum.quantidadeSolicitada ?? 0)]),
  );

  return itens.map((item) => {
    const quantidadeEmProducao = quantidadePorSku.get(item.sku) ?? 0;

    return {
      ...item,
      existe_em_producao: quantidadeEmProducao > 0,
      quantidade_em_producao: quantidadeEmProducao,
    };
  });
}/* =========================================================
 * PERSISTÊNCIA
 * ======================================================= */

async function registrarPedidosProcessados(
  itensNovosProcessados: Array<{
    pedido_olist_id: string;
    item_olist_id: string;
    sku: string;
  }>,
  solicitacaoId: string,
  input: {
    periodoInicio: string;
    periodoFim: string;
  },
) {
  /*
  const itensPayload = itens.map((item) => ({
    solicitacaoId,
    produtoId: item.produto_id,
    sku: item.sku,
    imagemUrl: item.imagem_url,
    quantidadeSolicitada: item.quantidade_solicitada,
    quantidadeProduzida: 0,
    tipoCorte: "PADRAO",
    observacao: "Gerado por integração Olist",
    statusItem: "em_producao",
  }));

  await prisma.itemSolicitacaoProducao.createMany({
    data: itensPayload,
  });

  return itensPayload.map((item) => ({
    solicitacao_id: item.solicitacaoId,
    produto_id: item.produtoId,
    sku: item.sku,
    imagem_url: item.imagemUrl,
    quantidade_solicitada: item.quantidadeSolicitada,
    quantidade_produzida: item.quantidadeProduzida,
    tipo_corte: item.tipoCorte,
    observacao: item.observacao,
    status_item: item.statusItem,
  }));
  itensNovosProcessados: Array<{
    pedido_olist_id: string;
    item_olist_id: string;
    sku: string;
  }>,
  solicitacaoId: string,
  input: {
    periodoInicio: string;
    periodoFim: string;
  },
) {
  */
  const registros = itensNovosProcessados.map((item) => ({
    pedidoOlistId: item.pedido_olist_id,
    itemOlistId: item.item_olist_id,
    sku: item.sku,
    solicitacaoProducaoId: solicitacaoId,
    periodoInicio: new Date(input.periodoInicio),
    periodoFim: new Date(input.periodoFim),
  }));

  if (registros.length === 0) {
    return;
  }

  await prisma.pedidoOlistProcessado.createMany({
    data: registros,
    skipDuplicates: true,
  });
}

export async function registrarPedidosOlistProcessados(input: {
  solicitacaoId: string;
  periodoInicio: string;
  periodoFim: string;
  itens: Array<{
    pedido_olist_id: string;
    item_olist_id: string;
    sku: string;
  }>;
}) {
  await registrarPedidosProcessados(input.itens, input.solicitacaoId, {
    periodoInicio: input.periodoInicio,
    periodoFim: input.periodoFim,
  });
}

export async function obterPeriodoBuscaBaixaEstoque() {
  const controle = await prisma.controleBuscaOlist.findUnique({
    where: { chave: CONTROLE_BUSCA_BAIXA_ESTOQUE },
    select: { ultimaBuscaEm: true },
  });
  const periodoInicio = controle?.ultimaBuscaEm
    ? new Date(controle.ultimaBuscaEm.getTime() - 24 * 60 * 60 * 1000)
    : new Date("2026-01-01T00:00:00-03:00");

  return {
    periodoInicio,
    periodoFim: new Date(),
  };
}

async function atualizarUltimaBuscaBaixaEstoque(data: Date) {
  await prisma.controleBuscaOlist.upsert({
    where: { chave: CONTROLE_BUSCA_BAIXA_ESTOQUE },
    create: {
      chave: CONTROLE_BUSCA_BAIXA_ESTOQUE,
      ultimaBuscaEm: data,
      updatedAt: new Date(),
    },
    update: {
      ultimaBuscaEm: data,
      updatedAt: new Date(),
    },
  });
}

async function prepararPedidosBaixaEstoque(detalhes: OlistOrder[]) {
  const skus = [
    ...new Set(
      detalhes.flatMap((pedido) =>
        (pedido.itens ?? []).map((item) => String(item.produto.sku).trim()).filter(Boolean),
      ),
    ),
  ];
  const produtos = skus.length
    ? await prisma.produto.findMany({
        where: { sku: { in: skus }, ativo: true },
        select: { id: true, sku: true },
      })
    : [];
  const produtoPorSku = new Map(produtos.map((produto) => [produto.sku, produto]));
  const produtosAusentesMap = new Map<string, { sku: string; }>();

  const pedidos = detalhes.map((pedido) => {
    const itensAgrupados = new Map<string, {
      sku: string;
      quantidade: number;
      itemOlistId: string;
    }>();

    for (const [index, item] of (pedido.itens ?? []).entries()) {
      const sku = String(item.produto.sku).trim();
      const itemOlistId = sku || `${pedido.id}:${index}`;
      const chave = sku || itemOlistId;
      const itemAgrupado = itensAgrupados.get(chave);

      itensAgrupados.set(chave, {
        sku,
        quantidade: (itemAgrupado?.quantidade ?? 0) + Number(item.quantidade ?? 0),
        itemOlistId,
      });
    }

    return {
      id: String(pedido.id),
      detalhe_pendente: false,
      itens: [...itensAgrupados.values()].map((item) => {
        const produto = produtoPorSku.get(item.sku);

        if (!produto) {
          produtosAusentesMap.set(item.sku, {
            sku: item.sku,
          });
        }

        return {
          sku: item.sku,
          quantidade: item.quantidade,
          pedido_olist_id: String(pedido.id),
          item_olist_id: item.itemOlistId,
          produto_id: produto?.id ?? null,
          produto_cadastrado: Boolean(produto),
          detalhe_pendente: false,
        };
      }),
    };
  });

  return {
    pedidos,
    produtosAusentes: [...produtosAusentesMap.values()],
  };
}

export async function buscarPedidosParaBaixaEstoqueOlist(aplicativoId: string, input?: {
  periodoInicio?: string | null;
}) {
  const periodoPadrao = await obterPeriodoBuscaBaixaEstoque();
  const periodoInicioInformado = input?.periodoInicio ? new Date(input.periodoInicio) : null;
  const periodoInicio =
    periodoInicioInformado && !Number.isNaN(periodoInicioInformado.getTime())
      ? periodoInicioInformado
      : periodoPadrao.periodoInicio;
  const periodoFim = periodoPadrao.periodoFim;
  const token = await getValidOlistAccessToken(aplicativoId);
  const pedidos: OlistOrder[] = [];

  for (const situacao of SITUACOES_BAIXA_ESTOQUE) {
    const pedidosPorSituacao = await listarPedidosOlist(
      token,
      aplicativoId,
      periodoInicio,
      periodoFim,
      situacao,
    );

    pedidos.push(...pedidosPorSituacao);
    await aguardar(500);
  }

  const pedidosUnicos = Array.from(
    new Map(pedidos.map((pedido) => [String(pedido.id), pedido])).values(),
  );
  const pedidosComBaixaSet = await buscarPedidosComBaixaJaRegistrada(pedidosUnicos);
  const pedidosNaoBaixados = pedidosUnicos.filter(
    (pedido) => !pedidosComBaixaSet.has(String(pedido.id)),
  );
  const detalhes: OlistOrder[] = [];
  const pedidosPendentes: OlistOrder[] = [];
  let atingiuLimiteDetalhe = false;

  for (let index = 0; index < pedidosNaoBaixados.length; index += 1) {
    const pedido = pedidosNaoBaixados[index];

    try {
      detalhes.push(await buscarDetalhePedidoOlist(token, aplicativoId, pedido.id));
      await aguardar(500);
    } catch (error) {
      if (!isErroTiny429(error)) {
        throw error;
      }

      atingiuLimiteDetalhe = true;
      pedidosPendentes.push(...pedidosNaoBaixados.slice(index));
      break;
    }
  }

  const { pedidos: pedidosPreparados, produtosAusentes } =
    await prepararPedidosBaixaEstoque(detalhes);
  const pedidosPendentesPreparados = pedidosPendentes.map((pedido) => ({
    id: String(pedido.id),
    detalhe_pendente: true,
    itens: [
      {
        sku: "",
        quantidade: 1,
        pedido_olist_id: String(pedido.id),
        item_olist_id: "",
        produto_id: null,
        produto_cadastrado: undefined,
        detalhe_pendente: true,
        observacao: "Detalhe pendente por limite de requisicoes da Olist",
      },
    ],
  }));

  return {
    periodo_inicio: periodoInicio.toISOString(),
    periodo_fim: periodoFim.toISOString(),
    pedidos_encontrados: pedidosUnicos.length,
    pedidos_ignorados: pedidosComBaixaSet.size,
    pedidos: [...pedidosPreparados, ...pedidosPendentesPreparados],
    produtos_ausentes: produtosAusentes,
    pedidos_detalhe_pendente: pedidosPendentesPreparados.length,
    aviso:
      atingiuLimiteDetalhe
        ? "A Olist limitou as requisições de detalhe. Alguns pedidos foram listados apenas com o ID para sincronizar depois."
        : null,
  };
}

export async function sincronizarPedidoBaixaEstoqueOlist(aplicativoId: string, pedidoId: string) {
  const token = await getValidOlistAccessToken(aplicativoId);
  const detalhe = await buscarDetalhePedidoOlist(token, aplicativoId, pedidoId);
  const { pedidos, produtosAusentes } = await prepararPedidosBaixaEstoque([detalhe]);

  return {
    pedido: pedidos[0],
    produtos_ausentes: produtosAusentes,
  };
}

export async function confirmarBaixaEstoqueOlist(input: {
  origem: "automatica" | "manual";
  observacao?: string | null;
  periodoFimBusca?: string | null;
  itens: ItemBaixaEstoqueInput[];
}) {
  if (!input.itens.length) {
    throw new Error("Informe ao menos um item para baixa.");
  }

  const itensNormalizados = input.itens.map((item) => ({
    ...item,
    sku: item.sku.trim(),
    pedidoOlistId: item.pedidoOlistId?.trim() || null,
    itemOlistId: item.itemOlistId?.trim() || null,
    observacao: item.observacao?.trim() || null,
  }));

  const skusInformados = itensNormalizados.map((item) => item.sku);

  if (skusInformados.some((sku) => !sku)) {
    throw new Error("Todos os itens precisam de SKU/referência.");
  }

  const skus = [...new Set(skusInformados)];

  const produtos = await prisma.produto.findMany({
    where: { sku: { in: skus }, ativo: true },
    select: { id: true, sku: true },
  });
  let produtoPorSku = new Map(produtos.map((produto) => [produto.sku, produto]));
  const ausentes = skus.filter((sku) => !produtoPorSku.has(sku));

  if (ausentes.length > 0) {
    await prisma.produto.updateMany({
      where: { sku: { in: ausentes } },
      data: { ativo: true },
    });

    await prisma.produto.createMany({
      data: ausentes.map((sku) => ({
        sku,
        ativo: true,
        metaEstoque: null,
        createdAt: new Date(),
      })),
      skipDuplicates: true,
    });

    const produtosAtualizados = await prisma.produto.findMany({
      where: { sku: { in: skus }, ativo: true },
      select: { id: true, sku: true },
    });

    produtoPorSku = new Map(produtosAtualizados.map((produto) => [produto.sku, produto]));
  }

  const itensComPedido = itensNormalizados.filter((item) => item.pedidoOlistId && item.itemOlistId);
  const chavesPedidoItem = new Set<string>();
  const duplicadosNoEnvio = new Set<string>();

  for (const item of itensComPedido) {
    const chave = `${item.pedidoOlistId}/${item.itemOlistId}`;

    if (chavesPedidoItem.has(chave)) {
      duplicadosNoEnvio.add(chave);
    }

    chavesPedidoItem.add(chave);
  }

  if (duplicadosNoEnvio.size > 0) {
    throw new Error(`Baixa duplicada na lista enviada para pedido/item: ${[...duplicadosNoEnvio].join(", ")}`);
  }

  const baixasExistentes = itensComPedido.length
    ? await prisma.itemBaixaEstoqueOlist.findMany({
        where: {
          OR: itensComPedido.map((item) => ({
            pedidoOlistId: item.pedidoOlistId,
            itemOlistId: item.itemOlistId,
          })),
        },
        select: { pedidoOlistId: true, itemOlistId: true },
      })
    : [];

  if (baixasExistentes.length > 0) {
    const repetidos = baixasExistentes
      .map((item) => `${item.pedidoOlistId}/${item.itemOlistId}`)
      .join(", ");

    throw new Error(`Baixa duplicada bloqueada para pedido/item: ${repetidos}`);
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const baixa = await tx.baixaEstoqueOlist.create({
      data: {
        origem: input.origem,
        observacao: input.observacao?.trim() || null,
      },
      select: { id: true },
    });

    for (const item of itensNormalizados) {
      const produto = produtoPorSku.get(item.sku);
      const quantidade = Number(item.quantidade);

      if (!produto || Number.isNaN(quantidade) || quantidade <= 0) {
        throw new Error(`Quantidade inválida para ${item.sku}.`);
      }

      const movimentacao = await tx.movimentacaoEstoque.create({
        data: {
          produtoId: produto.id,
          sku: produto.sku,
          tipoMovimento: "saida",
          quantidade,
          origem: input.origem === "automatica" ? "BAIXA_OLIST" : "BAIXA_MANUAL",
          referenciaId: baixa.id,
          observacao:
            item.observacao ||
            (item.pedidoOlistId ? `Baixa por pedido Olist ${item.pedidoOlistId}` : "Baixa manual de estoque"),
        },
        select: { id: true },
      });

      try {
        await tx.itemBaixaEstoqueOlist.create({
          data: {
            baixaId: baixa.id,
            produtoId: produto.id,
            sku: produto.sku,
            quantidade,
            pedidoOlistId: item.pedidoOlistId,
            itemOlistId: item.itemOlistId,
            observacao: item.observacao,
            origem: input.origem,
            movimentacaoId: movimentacao.id,
          },
        });
      } catch (error) {
        if (isPrismaUniqueConstraintError(error) && item.pedidoOlistId && item.itemOlistId) {
          throw new Error(`Baixa duplicada bloqueada para pedido/item: ${item.pedidoOlistId}/${item.itemOlistId}`);
        }

        throw error;
      }
    }

    return {
      baixa_id: baixa.id,
      itens: itensNormalizados.length,
    };
  }, { maxWait: 10000, timeout: 30000 });

  if (input.origem === "automatica" && input.periodoFimBusca) {
    const periodoFimBusca = new Date(input.periodoFimBusca);

    if (!Number.isNaN(periodoFimBusca.getTime())) {
      await atualizarUltimaBuscaBaixaEstoque(periodoFimBusca);
    }
  }

  return resultado;
}

async function cadastrarProdutosOlistNaoCadastrados(
  agregados: Map<
    string,
    {
      sku: string;
      imagem_url: string | null;
      quantidade_pedidos: number;
    }
  >,
) {
  const skus = [...agregados.keys()];

  if (skus.length === 0) return 0;

  const produtosExistentes = await prisma.produto.findMany({
    where: {
      sku: { in: skus },
    },
    select: { sku: true },
  });

  const skusExistentes = new Set(
    produtosExistentes.map((produto) => produto.sku),
  );

  const produtosParaCadastrar = skus
    .filter((sku) => !skusExistentes.has(sku))
    .map((sku) => {
      const item = agregados.get(sku);

      return {
        sku,
        imagemUrl: item?.imagem_url ?? null,
        ativo: true,
        metaEstoque: null,
        createdAt: new Date(),
      };
    });

  if (produtosParaCadastrar.length === 0) return 0;

  await prisma.produto.createMany({
    data: produtosParaCadastrar,
  });

  return produtosParaCadastrar.length;
}

/* =========================================================
 * PRINCIPAL
 * ======================================================= */

export async function gerarSolicitacaoPorPedidosOlist(input: {
  aplicativoId: string;
  dataLimite: string;
  filtroDataBase: FiltroDataBase;
  situacoes?: string[];
}) {
  const situacoes = normalizarSituacoes(input.situacoes);
  const processamentoEm = new Date().toISOString();

  const {
    pedidos,
    pedidosEncontrados,
  } = await buscarPedidosOlistPorDataLimite(
    input.aplicativoId,
    null,
    null,
    situacoes,
  );

  const paresPedidoItem = extrairParesPedidoItem(pedidos);

  if (paresPedidoItem.length === 0) {
    throw new Error("Nenhum item elegível encontrado nos pedidos da Olist.");
  }

  const resultadoAgregacao = agregarItensNovos(pedidos);

  const produtosCadastrados = await cadastrarProdutosOlistNaoCadastrados(
    resultadoAgregacao.agregados,
  );

  const dadosInternos = await buscarDadosInternos(resultadoAgregacao.skus);

  const { itens, prioridadeProducao, estoqueSuficiente } = montarItensSolicitacao(
    resultadoAgregacao.agregados,
    dadosInternos.produtos,
    dadosInternos.estoqueRows,
    dadosInternos.metaGeral,
    dadosInternos.minimoGeral,
  );

  if (itens.length === 0) {
    throw new NecessidadeProducaoError(estoqueSuficiente);
  }

  const itensComStatusProducao = await marcarItensJaSolicitadosEmProducao(itens);

  return {
    data_entrega: input.dataLimite,
    filtro_data_base: input.filtroDataBase,
    periodo_inicio: processamentoEm,
    periodo_fim: processamentoEm,
    observacao_geral: "MV:",
    prioridade_producao: prioridadeProducao,
    itens: itensComStatusProducao,
    total_itens: itensComStatusProducao.length,
    itens_ja_processados: 0,
    pedidos_encontrados: pedidosEncontrados,
    pedidos_adicionados: resultadoAgregacao.pedidosAdicionados,
    pedidos_ignorados: 0,
    produtos_cadastrados: produtosCadastrados,
    rastreio_olist: resultadoAgregacao.itensNovosProcessados,
    motivo_pedidos_ignorados: "Nenhum pedido é ignorado durante a busca.",
  };
}
