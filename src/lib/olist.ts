import axios, { AxiosResponse } from "axios";
import { prisma } from "@/lib/prisma";

/* =========================================================
 * CONFIGURAÇÕES
 * ======================================================= */

const OLIST_API_BASE_URL =
  process.env.OLIST_API_BASE_URL ?? "https://api.tiny.com.br/public-api/v3";

const OLIST_OAUTH_URL =
  process.env.OLIST_OAUTH_URL ??
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

const SITUACOES_PADRAO = ["3", "4", "1"];
const SITUACOES_PERMITIDAS = new Set(["3", "4", "1", "7"]);

/* =========================================================
 * TYPES
 * ======================================================= */

type FiltroDataBase = "APROVACAO_PEDIDO" | "CRIACAO_PEDIDO";

type OlistOrderItem = {
  produto: {
    sku: string;
    descricao: string;
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
  nome: string | null;
  imagem_url: string | null;
  meta_estoque: number | null;
  ativo: boolean;
};

type EstoqueAtualRow = {
  sku: string;
  estoque_atual: number | null;
};

type ItemSolicitacao = {
  produto_id: string;
  sku: string;
  nome: string;
  imagem_url: string | null;
  quantidade_solicitada: number;
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

function normalizarPayloadPedidos(payload: unknown): OlistOrder[] {
  if (!payload || typeof payload !== "object") return [];

  const dataObj = payload as Record<string, unknown>;

  const data =
    dataObj.itens ?? dataObj.data ?? dataObj.orders ?? dataObj.results;

  return Array.isArray(data) ? (data as OlistOrder[]) : [];
}

function validarPeriodo(input: { periodoInicio: string; periodoFim: string }) {
  const periodoInicio = new Date(input.periodoInicio);
  const periodoFim = new Date(input.periodoFim);

  console.log("periodoInicio", periodoInicio, "periodoFim", periodoFim)
  if (
    Number.isNaN(periodoInicio.getTime()) ||
    Number.isNaN(periodoFim.getTime())
  ) {
    throw new Error("Período inválido.");
  }

  if (periodoInicio > periodoFim) {
    throw new Error(
      "Período inválido: periodo_inicio deve ser menor ou igual a periodo_fim.",
    );
  }

  return {
    periodoInicio,
    periodoFim,
  };
}

/* =========================================================
 * OAUTH
 * ======================================================= */

async function renovarTokenComRefresh(refreshToken: string) {
  const clientId = process.env.OLIST_CLIENT_ID;
  const clientSecret = process.env.OLIST_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais da API v3 ausentes.");
  }

  const response = await axios.post(
    OLIST_OAUTH_URL,
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
    endpoint: OLIST_OAUTH_URL,
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
  const situacoesNormalizadas = (situacoes?.length ? situacoes : SITUACOES_PADRAO)
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
        provider: "olist",
        accessToken: refreshed.access_token ?? null,
        refreshToken: refreshed.refresh_token ?? tokenRow.refreshToken,
        expiresAt,
        status: refreshed.access_token ? "conectado" : "erro_autenticacao",
        updatedAt: new Date(),
      },
      update: {
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
  periodoInicio: Date,
  periodoFim: Date,
  situacao: string,
) {
  const limite = 100;

  const pedidos: OlistOrder[] = [];

  let offset = 0;

  while (true) {
    const url = new URL("pedidos", normalizarBaseUrl(OLIST_API_BASE_URL));

    url.searchParams.set("dataInicial", inputDate(periodoInicio));

    url.searchParams.set("dataFinal", inputDate(periodoFim));

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

    if (paginaPedidos.length === 0) {
      break;
    }

    pedidos.push(...paginaPedidos);

    if (paginaPedidos.length < limite) {
      break;
    }

    offset += limite;
  }

  return pedidos;
}

async function buscarDetalhePedidoOlist(
  token: string,
  pedidoId: string | number,
) {
  const url = new URL(
    `pedidos/${pedidoId}`,
    normalizarBaseUrl(OLIST_API_BASE_URL),
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

export async function buscarPedidosOlistPorDataLimite(
  periodoInicio: Date,
  periodoFim: Date,
  situacoes: string[],
): Promise<OlistOrder[]> {
  const token = await getValidOlistAccessToken();

  const pedidosPorSituacao = await Promise.all(
    situacoes.map((situacao) =>
      listarPedidosOlist(token, periodoInicio, periodoFim, situacao),
    ),
  );

  const pedidos = pedidosPorSituacao.flat();

  const pedidosUnicos = Array.from(
    new Map(pedidos.map((pedido) => [String(pedido.id), pedido])).values(),
  );

  return Promise.all(
    pedidosUnicos.map((pedido) => buscarDetalhePedidoOlist(token, pedido.id)),
  );
}

/* =========================================================
 * PROCESSAMENTO
 * ======================================================= */

function extrairParesPedidoItem(pedidos: OlistOrder[]) {
  return pedidos.flatMap((pedido) =>
    (pedido.itens ?? []).map((item) => ({
      pedido_olist_id: String(pedido.id),
      item_olist_id: item.produto.sku
    })),
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
      nome: string;
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

      const itemOlistId = item.produto.sku
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
        nome: item.produto.descricao,
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

async function buscarDadosInternos(skus: string[]) {
  const [produtos, estoqueRows, cfgRows] = await Promise.all([
    prisma.produto.findMany({
      where: {
        sku: { in: skus },
      },
      select: {
        id: true,
        sku: true,
        nome: true,
        imagemUrl: true,
        metaEstoque: true,
        ativo: true,
      },
    }),

    prisma.$queryRaw<EstoqueAtualRow[]>`
      select sku, estoque_atual
      from public.vw_estoque_atual
    `,

    prisma.configuracaoSistema.findMany({
      where: {
        chave: { in: ["META_GERAL_ESTOQUE", "MINIMO_GERAL_ESTOQUE"] },
      },
      select: { chave: true, valor: true },
    }),
  ]);

  const configsMap = new Map(cfgRows.map((config) => [config.chave, Number(config.valor)]));

  return {
    produtos: produtos.map((produto) => ({
      id: produto.id,
      sku: produto.sku,
      nome: produto.nome,
      imagem_url: produto.imagemUrl,
      meta_estoque: produto.metaEstoque,
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
      nome: string;
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

  for (const produto of produtos) {
    if (!produto.ativo) continue;

    const demanda = agregados.get(produto.sku);

    if (!demanda) continue;

    const estoqueAtual = estoqueMap.get(produto.sku) ?? 0;

    const metaEstoque = produto.meta_estoque ?? metaGeral;
    const estoqueAposPedidos = estoqueAtual - demanda.quantidade_pedidos;

    if (estoqueAposPedidos > minimoGeral) continue;

    const quantidadeAProduzir = Math.max(0, metaEstoque - estoqueAposPedidos);

    if (quantidadeAProduzir > 0) {
      itens.push({
        produto_id: produto.id,
        sku: produto.sku,
        nome: produto.nome ?? demanda.nome,
        imagem_url: produto.imagem_url ?? demanda.imagem_url,
        quantidade_solicitada: quantidadeAProduzir,
      });
    }
  }

  return itens;
}

/* =========================================================
 * PERSISTÊNCIA
 * ======================================================= */

async function criarSolicitacaoProducao(input: {
  dataLimite: string;
  filtroDataBase: FiltroDataBase;
  periodoInicio: string;
  periodoFim: string;
}) {
  const solicitacao = await prisma.solicitacaoProducao.create({
    data: {
      dataEntrega: new Date(`${input.dataLimite}T00:00:00`),
      filtroDataBase: input.filtroDataBase,
      periodoInicio: new Date(input.periodoInicio),
      periodoFim: new Date(input.periodoFim),
      status: "em_producao",
      observacaoGeral: "Gerada automaticamente via Olist",
    },
    select: { id: true },
  });

  return solicitacao;
}

async function inserirItensSolicitacao(
  solicitacaoId: string,
  itens: ItemSolicitacao[],
) {
  const itensPayload = itens.map((item) => ({
    solicitacaoId,
    produtoId: item.produto_id,
    sku: item.sku,
    nome: item.nome,
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
    nome: item.nome,
    imagem_url: item.imagemUrl,
    quantidade_solicitada: item.quantidadeSolicitada,
    quantidade_produzida: item.quantidadeProduzida,
    tipo_corte: item.tipoCorte,
    observacao: item.observacao,
    status_item: item.statusItem,
  }));
}

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
  });
}

async function cadastrarProdutosOlistNaoCadastrados(
  agregados: Map<
    string,
    {
      sku: string;
      nome: string;
      imagem_url: string | null;
      quantidade_pedidos: number;
    }
  >,
) {
  const skus = [...agregados.keys()];

  if (skus.length === 0) return;

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
        nome: item?.nome ?? sku,
        imagemUrl: item?.imagem_url ?? null,
        ativo: true,
        metaEstoque: null,
        createdAt: new Date(),
      };
    });

  if (produtosParaCadastrar.length === 0) return;

  await prisma.produto.createMany({
    data: produtosParaCadastrar,
  });
}

/* =========================================================
 * PRINCIPAL
 * ======================================================= */

export async function gerarSolicitacaoPorPedidosOlist(input: {
  dataLimite: string;
  filtroDataBase: FiltroDataBase;
  periodoInicio: string;
  periodoFim: string;
  situacoes?: string[];
}) {
  const { periodoInicio, periodoFim } = validarPeriodo(input);
  const situacoes = normalizarSituacoes(input.situacoes);

  const pedidos = await buscarPedidosOlistPorDataLimite(
    periodoInicio,
    periodoFim,
    situacoes,
  );

  const pedidosEncontrados = pedidos.length;

  const paresPedidoItem = extrairParesPedidoItem(pedidos);
  
  if (paresPedidoItem.length === 0) {
    throw new Error("Nenhum item elegível encontrado nos pedidos da Olist.");
  }

  const processadosSet = await buscarItensJaProcessados(paresPedidoItem);

  const resultadoAgregacao = agregarItensNovos(pedidos, processadosSet);

  await cadastrarProdutosOlistNaoCadastrados(resultadoAgregacao.agregados);

  const dadosInternos = await buscarDadosInternos(resultadoAgregacao.skus);

  const itens = montarItensSolicitacao(
    resultadoAgregacao.agregados,
    dadosInternos.produtos,
    dadosInternos.estoqueRows,
    dadosInternos.metaGeral,
    dadosInternos.minimoGeral,
  );

  if (itens.length === 0) {
    throw new Error("Não há necessidade de produção.");
  }

  const solicitacao = await criarSolicitacaoProducao(input);

  const itensPayload = await inserirItensSolicitacao(solicitacao.id, itens);

  await registrarPedidosProcessados(
    resultadoAgregacao.itensNovosProcessados,
    solicitacao.id,
    input,
  );

  return {
    solicitacao_id: solicitacao.id,
    itens: itensPayload.length,
    itens_ja_processados: resultadoAgregacao.itensJaProcessados,
    pedidos_encontrados: pedidosEncontrados,
    pedidos_adicionados: resultadoAgregacao.pedidosAdicionados,
    pedidos_ignorados: resultadoAgregacao.pedidosIgnorados,
    motivo_pedidos_ignorados: "Pedido já processado anteriormente.",
  };
}
