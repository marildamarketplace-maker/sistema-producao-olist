import axios, { AxiosResponse } from "axios";
import { APLICATIVO_PADRAO_ID, getAplicativoOlistConfig } from "@/lib/aplicativo";
import { prisma } from "@/lib/prisma";

/* =========================================================
 * CONFIGURAÇÕES
 * ======================================================= */

const SITUACOES_PADRAO = ["3", "4", "1"];
const SITUACOES_PERMITIDAS = new Set(["3", "4", "1", "7", "5", "6"]);
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

type ProdutoOlistListagem = {
  id?: string | number;
  sku?: string | number | null;
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

/* =========================================================
 * OAUTH
 * ======================================================= */

async function renovarTokenComRefresh(refreshToken: string) {
  const olistConfig = await getAplicativoOlistConfig();
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

export async function getValidOlistAccessToken() {
  const now = new Date();

  const tokenRow = await prisma.integracaoOlistToken.findUnique({
    where: { provider: "olist" },
    select: {
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
    const refreshed = await renovarTokenComRefresh(tokenRow.refreshToken);

    const expiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : null;

    await prisma.integracaoOlistToken.upsert({
      where: { provider: "olist" },
      create: {
        aplicativoId: APLICATIVO_PADRAO_ID,
        provider: "olist",
        accessToken: refreshed.access_token ?? null,
        refreshToken: refreshed.refresh_token ?? tokenRow.refreshToken,
        expiresAt,
        status: refreshed.access_token ? "conectado" : "erro_autenticacao",
        updatedAt: new Date(),
      },
      update: {
        aplicativoId: APLICATIVO_PADRAO_ID,
        accessToken: refreshed.access_token ?? null,
        refreshToken: refreshed.refresh_token ?? tokenRow.refreshToken,
        expiresAt,
        status: refreshed.access_token ? "conectado" : "erro_autenticacao",
        updatedAt: new Date(),
      },
    });

    if (refreshed.access_token) {
      return refreshed.access_token;
    }
  }

  throw new Error("Falha no OAuth Olist/Tiny.");
}

/* =========================================================
 * API OLIST
 * ======================================================= */

async function listarPedidosOlist(
  token: string,
  periodoInicio: Date | null,
  periodoFim: Date | null,
  situacao: string,
) {
  const limite = 100;
  const pedidos: OlistOrder[] = [];
  let offset = 0;
  let total: number | null = null;
  const olistConfig = await getAplicativoOlistConfig();

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
  pedidoId: string | number,
) {
  const olistConfig = await getAplicativoOlistConfig();
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

async function listarProdutosOlist(token: string, offset: number, limite: number) {
  const olistConfig = await getAplicativoOlistConfig();
  const url = new URL("produtos", normalizarBaseUrl(olistConfig.apiBaseUrl));

  url.searchParams.set("limit", String(limite));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("situacao", SITUACAO_PRODUTO_ATIVO);

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

  if (!sku || situacao !== SITUACAO_PRODUTO_ATIVO) {
    return null;
  }

  return {
    sku,
    idCadastroOlist,
    imagemUrl: null,
    ativo: true,
  };
}

export async function importarProdutosOlist() {
  const token = await getValidOlistAccessToken();
  const limite = 100;
  let offset = 0;
  let total: number | null = null;
  let lidos = 0;
  let criados = 0;
  let atualizados = 0;
  let ignorados = 0;
  const vistos = new Set<string>();

  while (true) {
    const pagina = await listarProdutosOlist(token, offset, limite);

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

    offset += limite;

    if (pagina.produtos.length < limite || (total !== null && offset >= total)) {
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
  periodoInicio: Date | null,
  periodoFim: Date | null,
  situacoes: string[],
): Promise<{
  pedidos: OlistOrder[];
  pedidosEncontrados: number;
  pedidosJaProcessadosIgnorados: number;
}> {
  const token = await getValidOlistAccessToken();

  const pedidos: OlistOrder[] = [];

  for (const situacao of situacoes) {
    const pedidosPorSituacao = await listarPedidosOlist(
      token,
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
  const pedidosJaProcessadosSet = await buscarPedidosJaProcessados(pedidosUnicos);
  const pedidosNaoProcessados = pedidosUnicos.filter(
    (pedido) => !pedidosJaProcessadosSet.has(String(pedido.id)),
  );

  const resultados = [];

  for (const pedido of pedidosNaoProcessados) {
    const detalhe = await buscarDetalhePedidoOlist(token, pedido.id);

    resultados.push(detalhe);

    await aguardar(500);
  }

  return {
    pedidos: resultados,
    pedidosEncontrados: pedidosUnicos.length,
    pedidosJaProcessadosIgnorados: pedidosJaProcessadosSet.size,
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

async function buscarPedidosJaProcessados(pedidos: OlistOrder[]) {
  const pedidosIds = [...new Set(pedidos.map((pedido) => String(pedido.id)))];

  if (pedidosIds.length === 0) {
    return new Set<string>();
  }

  const processadosRows = await prisma.pedidoOlistProcessado.findMany({
    where: {
      pedidoOlistId: { in: pedidosIds },
    },
    select: {
      pedidoOlistId: true,
    },
  });

  return new Set(processadosRows.map((row) => row.pedidoOlistId));
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

async function buscarItensJaProcessados(
  paresPedidoItem: ReturnType<typeof extrairParesPedidoItem>,
) {
  const pedidosIds = [
    ...new Set(paresPedidoItem.map((par) => par.pedido_olist_id)),
  ];

  const itensIds = [
    ...new Set(paresPedidoItem.map((par) => par.item_olist_id)),
  ];

  const processadosRows =
    pedidosIds.length > 0 && itensIds.length > 0
      ? await prisma.pedidoOlistProcessado.findMany({
          where: {
            pedidoOlistId: { in: pedidosIds },
            itemOlistId: { in: itensIds },
          },
          select: {
            pedidoOlistId: true,
            itemOlistId: true,
          },
        })
      : [];

  return new Set(
    processadosRows.map((row) => `${row.pedidoOlistId}::${row.itemOlistId}`),
  );
}

function agregarItensNovos(pedidos: OlistOrder[], processadosSet: Set<string>) {
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

  let itensJaProcessados = 0;
  let pedidosIgnorados = 0;
  let pedidosAdicionados = 0;

  for (const pedido of pedidos) {
    let teveItemNovo = false;

    for (const item of pedido.itens ?? []) {
      const sku = String(item.produto.sku).trim();

      if (!sku) continue;

      const itemOlistId = item.produto.sku;
      const chaveProcessamento = `${pedido.id}::${itemOlistId}`;

      if (processadosSet.has(chaveProcessamento)) {
        itensJaProcessados += 1;
        continue;
      }

      if (novosProcessadosSet.has(chaveProcessamento)) {
        continue;
      }

      const atual = agregados.get(sku) ?? {
        sku,
        imagem_url: null,
        quantidade_pedidos: 0,
      };

      atual.quantidade_pedidos += item.quantidade;

      agregados.set(sku, atual);

      itensNovosProcessados.push({
        pedido_olist_id: String(pedido.id),
        item_olist_id: itemOlistId,
        sku,
      });

      novosProcessadosSet.add(chaveProcessamento);

      teveItemNovo = true;
    }

    if (teveItemNovo) {
      pedidosAdicionados += 1;
    } else {
      pedidosIgnorados += 1;
    }
  }

  return {
    agregados,
    itensNovosProcessados,
    itensJaProcessados,
    pedidosIgnorados,
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

    const quantidadeAProduzir = arredondarParaPar(
      Math.max(0, metaEstoque - estoqueAposPedidos),
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

async function obterPeriodoBuscaBaixaEstoque() {
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

  const pedidos = detalhes.map((pedido) => ({
    id: String(pedido.id),
    detalhe_pendente: false,
    itens: (pedido.itens ?? []).map((item, index) => {
      const sku = String(item.produto.sku).trim();
      const produto = produtoPorSku.get(sku);

      if (!produto) {
        produtosAusentesMap.set(sku, {
          sku,
        });
      }

      return {
        sku,
        quantidade: Number(item.quantidade ?? 0),
        pedido_olist_id: String(pedido.id),
        item_olist_id: sku || `${pedido.id}:${index}`,
        produto_id: produto?.id ?? null,
        produto_cadastrado: Boolean(produto),
        detalhe_pendente: false,
      };
    }),
  }));

  return {
    pedidos,
    produtosAusentes: [...produtosAusentesMap.values()],
  };
}

export async function buscarPedidosParaBaixaEstoqueOlist() {
  const { periodoInicio, periodoFim } = await obterPeriodoBuscaBaixaEstoque();
  const token = await getValidOlistAccessToken();
  const pedidos: OlistOrder[] = [];

  for (const situacao of SITUACOES_BAIXA_ESTOQUE) {
    const pedidosPorSituacao = await listarPedidosOlist(
      token,
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
      detalhes.push(await buscarDetalhePedidoOlist(token, pedido.id));
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

export async function sincronizarPedidoBaixaEstoqueOlist(pedidoId: string) {
  const token = await getValidOlistAccessToken();
  const detalhe = await buscarDetalhePedidoOlist(token, pedidoId);
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

  const skusInformados = input.itens.map((item) => item.sku.trim());

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

  const itensComPedido = input.itens.filter((item) => item.pedidoOlistId && item.itemOlistId);
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

    for (const item of input.itens) {
      const produto = produtoPorSku.get(item.sku.trim());
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
            item.observacao?.trim() ||
            (item.pedidoOlistId ? `Baixa por pedido Olist ${item.pedidoOlistId}` : "Baixa manual de estoque"),
        },
        select: { id: true },
      });

      await tx.itemBaixaEstoqueOlist.create({
        data: {
          baixaId: baixa.id,
          produtoId: produto.id,
          sku: produto.sku,
          quantidade,
          pedidoOlistId: item.pedidoOlistId || null,
          itemOlistId: item.itemOlistId || null,
          observacao: item.observacao?.trim() || null,
          origem: input.origem,
          movimentacaoId: movimentacao.id,
        },
      });
    }

    return {
      baixa_id: baixa.id,
      itens: input.itens.length,
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
  dataLimite: string;
  filtroDataBase: FiltroDataBase;
  situacoes?: string[];
}) {
  const situacoes = normalizarSituacoes(input.situacoes);
  const processamentoEm = new Date().toISOString();

  const {
    pedidos,
    pedidosEncontrados,
    pedidosJaProcessadosIgnorados,
  } = await buscarPedidosOlistPorDataLimite(
    null,
    null,
    situacoes,
  );

  const paresPedidoItem = extrairParesPedidoItem(pedidos);

  if (paresPedidoItem.length === 0) {
    throw new Error("Nenhum item elegível encontrado nos pedidos da Olist.");
  }

  const processadosSet = await buscarItensJaProcessados(paresPedidoItem);

  const resultadoAgregacao = agregarItensNovos(pedidos, processadosSet);

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
    observacao_geral: "Gerada via Olist. Revise os itens antes de salvar.",
    prioridade_producao: prioridadeProducao,
    itens: itensComStatusProducao,
    total_itens: itensComStatusProducao.length,
    itens_ja_processados: resultadoAgregacao.itensJaProcessados,
    pedidos_encontrados: pedidosEncontrados,
    pedidos_adicionados: resultadoAgregacao.pedidosAdicionados,
    pedidos_ignorados:
      resultadoAgregacao.pedidosIgnorados + pedidosJaProcessadosIgnorados,
    produtos_cadastrados: produtosCadastrados,
    rastreio_olist: resultadoAgregacao.itensNovosProcessados,
    motivo_pedidos_ignorados: "Pedido já processado anteriormente.",
  };
}

