import { supabaseAdmin } from "@/lib/supabase-admin";

/* =========================================================
 * CONFIGURAÇÕES
 * ======================================================= */

const OLIST_API_BASE_URL =
  process.env.OLIST_API_BASE_URL ?? "https://api.tiny.com.br/public-api/v3";

const OLIST_OAUTH_URL =
  process.env.OLIST_OAUTH_URL ??
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

const SITUACAO = "4";

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

function validarRespostaJsonOrThrow(response: Response, bodyText: string) {
  const contentType = response.headers.get("content-type") ?? "";

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

  const response = await fetch(OLIST_OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    cache: "no-store",
  });

  logIntegracaoOlist({
    endpoint: OLIST_OAUTH_URL,
    status: response.status,
    modulo: "oauth-refresh",
  });

  const rawText = await response.text();

  validarRespostaJsonOrThrow(response, rawText);

  if (!response.ok) {
    throw new Error("Falha ao renovar token OAuth.");
  }

  return JSON.parse(rawText) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

export async function getValidOlistAccessToken() {
  const now = new Date();

  const { data: tokenRow } = await supabaseAdmin
    .from("integracao_olist_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("provider", "olist")
    .maybeSingle();

  if (
    tokenRow?.access_token &&
    tokenRow?.expires_at &&
    new Date(tokenRow.expires_at) > now
  ) {
    return tokenRow.access_token;
  }

  if (tokenRow?.refresh_token) {
    const refreshed = await renovarTokenComRefresh(tokenRow.refresh_token);

    const expiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      : null;

    await supabaseAdmin.from("integracao_olist_tokens").upsert(
      {
        provider: "olist",
        access_token: refreshed.access_token ?? null,
        refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
        expires_at: expiresAt,
        status: refreshed.access_token ? "conectado" : "erro_autenticacao",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "provider",
      },
    );

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
) {
  const limite = 100;

  const pedidos: OlistOrder[] = [];

  let offset = 0;

  while (true) {
    const url = new URL("pedidos", normalizarBaseUrl(OLIST_API_BASE_URL));

    url.searchParams.set("dataInicial", inputDate(periodoInicio));

    url.searchParams.set("dataFinal", inputDate(periodoFim));

    url.searchParams.set("dataAtualizacao", inputDate(periodoFim));

    url.searchParams.set("situacao", SITUACAO);

    url.searchParams.set("limit", String(limite));

    url.searchParams.set("offset", String(offset));

    url.searchParams.set("orderBy", "asc");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    logIntegracaoOlist({
      endpoint: url.toString(),
      status: response.status,
      modulo: "pedidos",
    });

    if (!response.ok) {
      const responseText = await response.text();

      validarRespostaJsonOrThrow(response, responseText);

      if (response.status === 401) {
        throw new Error("Token inválido ou sem permissão.");
      }

      throw new Error(`Erro Tiny ${response.status}`);
    }

    const payload = await response.json();

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

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  logIntegracaoOlist({
    endpoint: url.toString(),
    status: response.status,
    modulo: "pedido-detalhe",
  });

  if (!response.ok) {
    const responseText = await response.text();

    validarRespostaJsonOrThrow(response, responseText);

    if (response.status === 401) {
      throw new Error("Token inválido ou sem permissão.");
    }

    throw new Error(`Erro Tiny ${response.status}`);
  }

  const responseJson = (await response.json()) as OlistOrder;

  return {
    id: pedidoId,
    itens: (responseJson.itens ?? []) as OlistOrderItem[],
  };
}

export async function buscarPedidosOlistPorDataLimite(
  periodoInicio: Date,
  periodoFim: Date,
): Promise<OlistOrder[]> {
  const token = await getValidOlistAccessToken();

  const pedidos = await listarPedidosOlist(token, periodoInicio, periodoFim);

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

  const { data: processadosRows, error } =
    pedidosIds.length > 0 && itensIds.length > 0
      ? await supabaseAdmin
          .from("pedidos_olist_processados")
          .select("pedido_olist_id, item_olist_id")
          .in("pedido_olist_id", pedidosIds)
          .in("item_olist_id", itensIds)
      : {
          data: [],
          error: null,
        };

  if (error) {
    throw new Error(error.message);
  }

  return new Set(
    (
      (processadosRows ?? []) as Array<{
        pedido_olist_id: string;
        item_olist_id: string;
      }>
    ).map((row) => `${row.pedido_olist_id}::${row.item_olist_id}`),
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

    for (const [index, item] of (pedido.itens ?? []).entries()) {
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
  const [
    { data: produtos, error: prodError },
    { data: estoqueRows, error: estError },
    { data: cfgData, error: cfgError },
  ] = await Promise.all([
    supabaseAdmin
      .from("produtos")
      .select("id, sku, nome, imagem_url, meta_estoque, ativo")
      .in("sku", skus),

    supabaseAdmin.from("vw_estoque_atual").select("sku, estoque_atual"),

    supabaseAdmin
      .from("configuracoes_sistema")
      .select("valor")
      .eq("chave", "META_GERAL_ESTOQUE")
      .maybeSingle(),
  ]);

  if (prodError || estError || cfgError) {
    throw new Error(
      prodError?.message ??
        estError?.message ??
        cfgError?.message ??
        "Erro ao buscar dados internos.",
    );
  }

  return {
    produtos: (produtos ?? []) as ProdutoRow[],
    estoqueRows: (estoqueRows ?? []) as EstoqueAtualRow[],
    metaGeral: Number(cfgData?.valor ?? 0),
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

    const quantidadeAProduzir = Math.max(
      0,
      demanda.quantidade_pedidos + metaEstoque - estoqueAtual,
    );

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
  turnoId: string;
  filtroDataBase: FiltroDataBase;
  periodoInicio: string;
  periodoFim: string;
}) {
  const { data: solicitacao, error } = await supabaseAdmin
    .from("solicitacoes_producao")
    .insert({
      data_entrega: input.dataLimite,
      turno_id: input.turnoId,
      filtro_data_base: input.filtroDataBase,
      periodo_inicio: input.periodoInicio,
      periodo_fim: input.periodoFim,
      status: "em_producao",
      observacao_geral: "Gerada automaticamente via Olist",
    })
    .select("id")
    .single();

  if (error || !solicitacao) {
    throw new Error(error?.message ?? "Erro ao criar solicitação.");
  }

  return solicitacao;
}

async function inserirItensSolicitacao(
  solicitacaoId: string,
  itens: ItemSolicitacao[],
) {
  const itensPayload = itens.map((item) => ({
    solicitacao_id: solicitacaoId,
    produto_id: item.produto_id,
    sku: item.sku,
    nome: item.nome,
    imagem_url: item.imagem_url,
    quantidade_solicitada: item.quantidade_solicitada,
    quantidade_produzida: 0,
    tipo_corte: "PADRAO",
    observacao: "Gerado por integração Olist",
    status_item: "em_producao",
  }));

  const { error } = await supabaseAdmin
    .from("itens_solicitacao_producao")
    .insert(itensPayload);

  if (error) {
    throw new Error(error.message);
  }

  return itensPayload;
}

async function registrarPedidosProcessados(
  itensNovosProcessados: Array<{
    pedido_olist_id: string;
    item_olist_id: string;
    sku: string;
  }>,
  solicitacaoId: string,
  input: {
    turnoId: string;
    periodoInicio: string;
    periodoFim: string;
  },
) {
  const registros = itensNovosProcessados.map((item) => ({
    pedido_olist_id: item.pedido_olist_id,
    item_olist_id: item.item_olist_id,
    sku: item.sku,
    solicitacao_producao_id: solicitacaoId,
    turno_id: input.turnoId,
    periodo_inicio: input.periodoInicio,
    periodo_fim: input.periodoFim,
  }));

  if (registros.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("pedidos_olist_processados")
    .insert(registros);

  if (error) {
    throw new Error(error.message);
  }
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

  const { data: produtosExistentes, error } = await supabaseAdmin
    .from("produtos")
    .select("sku")
    .in("sku", skus);

  if (error) {
    throw new Error(error.message);
  }

  const skusExistentes = new Set(
    (produtosExistentes ?? []).map((produto) => produto.sku),
  );

  const produtosParaCadastrar = skus
    .filter((sku) => !skusExistentes.has(sku))
    .map((sku) => {
      const item = agregados.get(sku);

      return {
        sku,
        nome: item?.nome ?? sku,
        imagem_url: item?.imagem_url ?? null,
        ativo: true,
        meta_estoque: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

  if (produtosParaCadastrar.length === 0) return;

  const { error: insertError } = await supabaseAdmin
    .from("produtos")
    .insert(produtosParaCadastrar);

  if (insertError) {
    throw new Error(insertError.message);
  }
}

/* =========================================================
 * PRINCIPAL
 * ======================================================= */

export async function gerarSolicitacaoPorPedidosOlist(input: {
  dataLimite: string;
  turnoId: string;
  filtroDataBase: FiltroDataBase;
  periodoInicio: string;
  periodoFim: string;
}) {
  const { periodoInicio, periodoFim } = validarPeriodo(input);

  const pedidos = await buscarPedidosOlistPorDataLimite(
    periodoInicio,
    periodoFim,
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
