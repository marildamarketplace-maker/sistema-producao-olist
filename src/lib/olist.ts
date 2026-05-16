import { supabaseAdmin } from "@/lib/supabase-admin";

type OlistOrderItem = {
  id?: string | number;
  sku?: string;
  codigo?: string;
  quantidade?: number;
  quantity?: number;
  descricao?: string;
  description?: string;
  product_name?: string;
  imagemURL?: string;
  image_url?: string;
};

type OlistOrder = {
  id: string | number;
  numero?: number;
  number?: string;
  status?: string;
  situacao?: string | number;
  approved_at?: string | null;
  created_at?: string | null;
  data?: string | null;
  date?: string | null;
  itens?: OlistOrderItem[];
  items?: OlistOrderItem[];
};

const OLIST_API_BASE_URL = process.env.OLIST_API_BASE_URL ?? "https://api.tiny.com.br/public-api/v3";
const OLIST_OAUTH_URL = process.env.OLIST_OAUTH_URL ?? "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const SITUACOES_PERMITIDAS = new Set(["0", "3", "4", "1"]);
type FiltroDataBase = "APROVACAO_PEDIDO" | "CRIACAO_PEDIDO";

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

function parseIsoDateOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pedidoDentroDoPeriodo(
  pedido: OlistOrder,
  filtroDataBase: FiltroDataBase,
  periodoInicio: Date,
  periodoFim: Date,
) {
  const dataBaseRaw = filtroDataBase === "APROVACAO_PEDIDO" ? pedido.approved_at : pedido.created_at ?? pedido.data ?? pedido.date;
  const dataBase = parseIsoDateOrNull(dataBaseRaw);
  if (!dataBase) return false;
  return dataBase >= periodoInicio && dataBase <= periodoFim;
}

function normalizarPayloadPedidos(payload: unknown): OlistOrder[] {
  if (!payload || typeof payload !== "object") return [];
  const dataObj = payload as Record<string, unknown>;
  const data = dataObj.itens ?? dataObj.items ?? dataObj.data ?? dataObj.orders ?? dataObj.results;
  return Array.isArray(data) ? (data as OlistOrder[]) : [];
}

function normalizarBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function logIntegracaoOlist(input: { endpoint: string; status: number; modulo: string }) {
  console.info("[olist-api]", input);
}

function validarRespostaJsonOrThrow(response: Response, bodyText: string) {
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html") || /<html|<script|alert\(/i.test(bodyText);
  if (isHtml) {
    throw new Error("Endpoint incorreto: a Olist retornou HTML em vez de JSON. Verifique a URL da API.");
  }
}

async function renovarTokenComRefresh(refreshToken: string) {
  const clientId = process.env.OLIST_CLIENT_ID;
  const clientSecret = process.env.OLIST_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciais da API v3 ausentes.");

  const response = await fetch(OLIST_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    cache: "no-store",
  });

  logIntegracaoOlist({ endpoint: OLIST_OAUTH_URL, status: response.status, modulo: "oauth-refresh" });
  const rawText = await response.text();
  validarRespostaJsonOrThrow(response, rawText);
  if (!response.ok) throw new Error("Falha ao renovar token OAuth.");
  return JSON.parse(rawText) as { access_token?: string; refresh_token?: string; expires_in?: number };
}

export async function getValidOlistAccessToken() {
  const now = new Date();
  const { data: tokenRow } = await supabaseAdmin
    .from("integracao_olist_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("provider", "olist")
    .maybeSingle();

  if (tokenRow?.access_token && tokenRow?.expires_at && new Date(tokenRow.expires_at) > now) {
    return tokenRow.access_token;
  }

  if (tokenRow?.refresh_token) {
    const refreshed = await renovarTokenComRefresh(tokenRow.refresh_token);
    const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null;
    await supabaseAdmin.from("integracao_olist_tokens").upsert(
      {
        provider: "olist",
        access_token: refreshed.access_token ?? null,
        refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
        expires_at: expiresAt,
        status: refreshed.access_token ? "conectado" : "erro_autenticacao",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider" },
    );
    if (refreshed.access_token) return refreshed.access_token;
  }

  throw new Error("Falha no OAuth Olist/Tiny. Verifique Client ID, Client Secret, Redirect URI e se o código de autorização não expirou.");
}

export async function buscarPedidosOlistPorDataLimite(
  dataLimite: string,
  filtroDataBase: FiltroDataBase,
  periodoInicio: Date,
  periodoFim: Date,
): Promise<OlistOrder[]> {
  const token = await getValidOlistAccessToken();
  const limite = 100;
  const situacoesConsulta = ["0", "3", "4", "1"];
  const pedidos: OlistOrder[] = [];

  for (const situacao of situacoesConsulta) {
    let offset = 0;
    while (true) {
      const url = new URL("pedidos", normalizarBaseUrl(OLIST_API_BASE_URL));
      url.searchParams.set("dataInicial", inputDate(periodoInicio));
      url.searchParams.set("dataFinal", inputDate(periodoFim));
      url.searchParams.set("dataAtualizacao", inputDate(periodoFim));
      url.searchParams.set("situacao", situacao);
      url.searchParams.set("origemPedido", "0");
      url.searchParams.set("limit", String(limite));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("orderBy", "asc");

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      logIntegracaoOlist({ endpoint: url.toString(), status: response.status, modulo: "pedidos" });

      if (!response.ok) {
        const responseText = await response.text();
        validarRespostaJsonOrThrow(response, responseText);
        if (response.status === 401) {
          throw new Error("Token inválido, chave expirada ou usuário sem permissão no módulo solicitado.");
        }
        throw new Error(`Erro Tiny/ERP Olist ${response.status} ${response.statusText}: ${responseText}`);
      }

      const payload = await response.json();
      const paginaPedidos = normalizarPayloadPedidos(payload);
      if (paginaPedidos.length === 0) break;

      pedidos.push(...paginaPedidos);

      if (paginaPedidos.length < limite) break;
      offset += limite;
    }
  }

  const pedidosUnicos = Array.from(new Map(pedidos.map((pedido) => [String(pedido.id), pedido])).values());

  return pedidosUnicos
    .filter((pedido) => {
      const situacao = String(pedido.situacao ?? "").trim();
      if (!situacao) return true;
      return SITUACOES_PERMITIDAS.has(situacao);
    })
    .filter((pedido) => pedidoDentroDoPeriodo(pedido, filtroDataBase, periodoInicio, periodoFim));
}

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function gerarSolicitacaoPorPedidosOlist(input: {
  dataLimite: string;
  turnoId: string;
  filtroDataBase: FiltroDataBase;
  periodoInicio: string;
  periodoFim: string;
}) {
  const periodoInicio = new Date(input.periodoInicio);
  const periodoFim = new Date(input.periodoFim);
  if (Number.isNaN(periodoInicio.getTime()) || Number.isNaN(periodoFim.getTime())) {
    throw new Error("Período inválido.");
  }
  if (periodoInicio > periodoFim) {
    throw new Error("Período inválido: periodo_inicio deve ser menor ou igual a periodo_fim.");
  }

  const pedidos = await buscarPedidosOlistPorDataLimite(input.dataLimite, input.filtroDataBase, periodoInicio, periodoFim);
  const pedidosEncontrados = pedidos.length;
  const paresPedidoItem = pedidos.flatMap((pedido) =>
    (pedido.itens ?? pedido.items ?? []).map((item, index) => ({
      pedido_olist_id: String(pedido.id),
      item_olist_id: item.id ? String(item.id) : `${pedido.id}:${item.sku ?? "sem-sku"}:${index}`,
    })),
  );

  const pedidosIds = [...new Set(paresPedidoItem.map((par) => par.pedido_olist_id))];
  const itensIds = [...new Set(paresPedidoItem.map((par) => par.item_olist_id))];

  const { data: processadosRows, error: processadosError } =
    pedidosIds.length > 0 && itensIds.length > 0
      ? await supabaseAdmin
          .from("pedidos_olist_processados")
          .select("pedido_olist_id, item_olist_id")
          .in("pedido_olist_id", pedidosIds)
          .in("item_olist_id", itensIds)
      : { data: [], error: null };

  if (processadosError) throw new Error(processadosError.message);
  const processadosSet = new Set(
    ((processadosRows ?? []) as Array<{ pedido_olist_id: string; item_olist_id: string }>).map(
      (row) => `${row.pedido_olist_id}::${row.item_olist_id}`,
    ),
  );

  const agregados = new Map<string, { sku: string; nome: string; imagem_url: string | null; quantidade_pedidos: number }>();
  const itensNovosProcessados: Array<{ pedido_olist_id: string; item_olist_id: string; sku: string }> = [];
  const novosProcessadosSet = new Set<string>();
  let itensJaProcessados = 0;
  let pedidosIgnorados = 0;
  let pedidosAdicionados = 0;
  for (const pedido of pedidos) {
    let teveItemNovo = false;
    for (const [index, item] of (pedido.itens ?? pedido.items ?? []).entries()) {
      const sku = String(item.sku ?? item.codigo ?? "").trim();
      if (!sku) continue;

      const itemOlistId = item.id ? String(item.id) : `${pedido.id}:${sku}:${index}`;
      const chaveProcessamento = `${pedido.id}::${itemOlistId}`;
      if (processadosSet.has(chaveProcessamento)) {
        itensJaProcessados += 1;
        continue;
      }
      if (novosProcessadosSet.has(chaveProcessamento)) continue;

      const atual = agregados.get(sku) ?? {
        sku,
        nome: item.product_name ?? item.descricao ?? item.description ?? sku,
        imagem_url: item.image_url ?? item.imagemURL ?? null,
        quantidade_pedidos: 0,
      };
      atual.quantidade_pedidos += Number(item.quantity ?? item.quantidade ?? 0);
      if (!atual.imagem_url && item.image_url) atual.imagem_url = item.image_url;
      agregados.set(sku, atual);
      itensNovosProcessados.push({ pedido_olist_id: String(pedido.id), item_olist_id: itemOlistId, sku });
      novosProcessadosSet.add(chaveProcessamento);
      teveItemNovo = true;
    }
    if (teveItemNovo) pedidosAdicionados += 1;
    else pedidosIgnorados += 1;
  }

  const skus = [...agregados.keys()];
  if (skus.length === 0) throw new Error("Nenhum item elegível encontrado nos pedidos da Olist.");

  const [{ data: produtos, error: prodError }, { data: estoqueRows, error: estError }, { data: cfgData, error: cfgError }] = await Promise.all([
    supabaseAdmin.from("produtos").select("id, sku, nome, imagem_url, meta_estoque, ativo").in("sku", skus),
    supabaseAdmin.from("vw_estoque_atual").select("sku, estoque_atual"),
    supabaseAdmin.from("configuracoes_sistema").select("valor").eq("chave", "META_GERAL_ESTOQUE").maybeSingle(),
  ]);

  if (prodError || estError || cfgError) throw new Error(prodError?.message ?? estError?.message ?? cfgError?.message ?? "Erro ao buscar dados internos.");

  const metaGeral = Number(cfgData?.valor ?? 0);
  const estoqueMap = new Map(((estoqueRows ?? []) as EstoqueAtualRow[]).map((e) => [e.sku, Number(e.estoque_atual ?? 0)]));

  const itens: ItemSolicitacao[] = [];
  for (const produto of (produtos ?? []) as ProdutoRow[]) {
    if (!produto.ativo) continue;
    const demanda = agregados.get(produto.sku);
    if (!demanda) continue;

    const estoqueAtual = estoqueMap.get(produto.sku) ?? 0;
    const metaEstoque = produto.meta_estoque ?? metaGeral;
    const quantidadeAProduzir = Math.max(0, demanda.quantidade_pedidos + metaEstoque - estoqueAtual);

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

  if (itens.length === 0) throw new Error("Não há necessidade de produção para os critérios informados.");

  const { data: solicitacao, error: solError } = await supabaseAdmin
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

  if (solError || !solicitacao) throw new Error(solError?.message ?? "Erro ao criar solicitação.");

  const itensPayload = itens.map((item) => ({
    solicitacao_id: solicitacao.id,
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

  const { error: itemError } = await supabaseAdmin.from("itens_solicitacao_producao").insert(itensPayload);
  if (itemError) throw new Error(itemError.message);

  const registrosProcessados = itensNovosProcessados.map((item) => ({
    pedido_olist_id: item.pedido_olist_id,
    item_olist_id: item.item_olist_id,
    sku: item.sku,
    solicitacao_producao_id: solicitacao.id,
    turno_id: input.turnoId,
    periodo_inicio: input.periodoInicio,
    periodo_fim: input.periodoFim,
  }));

  if (registrosProcessados.length > 0) {
    const { error: processadosInsertError } = await supabaseAdmin.from("pedidos_olist_processados").insert(registrosProcessados);
    if (processadosInsertError) throw new Error(processadosInsertError.message);
  }

  return {
    solicitacao_id: solicitacao.id,
    itens: itensPayload.length,
    itens_ja_processados: itensJaProcessados,
    pedidos_encontrados: pedidosEncontrados,
    pedidos_adicionados: pedidosAdicionados,
    pedidos_ignorados: pedidosIgnorados,
    motivo_pedidos_ignorados: "Pedido já processado anteriormente.",
  };
}
