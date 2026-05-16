import { supabaseAdmin } from "@/lib/supabase-admin";

type OlistOrder = {
  id: string;
  status: string;
  approved_at?: string | null;
  created_at?: string | null;
  items: Array<{
    id?: string;
    sku: string;
    name: string;
    quantity: number;
    image_url?: string;
  }>;
};

const STATUS_PERMITIDOS = new Set(["Em aberto", "Aprovado", "Preparando envio", "Faturado"]);
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
  const dataBase = filtroDataBase === "APROVACAO_PEDIDO" ? parseIsoDateOrNull(pedido.approved_at) : parseIsoDateOrNull(pedido.created_at);
  if (!dataBase) return false;
  return dataBase >= periodoInicio && dataBase <= periodoFim;
}

export async function buscarPedidosOlistPorDataLimite(
  dataLimite: string,
  filtroDataBase: FiltroDataBase,
  periodoInicio: Date,
  periodoFim: Date,
): Promise<OlistOrder[]> {
  const baseUrl = process.env.OLIST_API_URL;
  const token = process.env.OLIST_API_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Configure OLIST_API_URL e OLIST_API_TOKEN nas variáveis de ambiente da Vercel.");
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("orders", normalizedBaseUrl);
  url.searchParams.set("shipping_deadline_lte", dataLimite);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Erro Olist ${response.status} ${response.statusText}: ${responseText}`);
  }

  const payload = await response.json();
  const pedidos = (payload?.orders ?? payload?.results ?? []) as OlistOrder[];

  return pedidos
    .filter((pedido) => STATUS_PERMITIDOS.has(pedido.status))
    .filter((pedido) => pedidoDentroDoPeriodo(pedido, filtroDataBase, periodoInicio, periodoFim));
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
    (pedido.items ?? []).map((item, index) => ({
      pedido_olist_id: pedido.id,
      item_olist_id: item.id ? String(item.id) : `${pedido.id}:${item.sku}:${index}`,
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
    for (const [index, item] of (pedido.items ?? []).entries()) {
      const itemOlistId = item.id ? String(item.id) : `${pedido.id}:${item.sku}:${index}`;
      const chaveProcessamento = `${pedido.id}::${itemOlistId}`;
      if (processadosSet.has(chaveProcessamento)) {
        itensJaProcessados += 1;
        continue;
      }
      if (novosProcessadosSet.has(chaveProcessamento)) continue;

      const atual = agregados.get(item.sku) ?? { sku: item.sku, nome: item.name, imagem_url: item.image_url ?? null, quantidade_pedidos: 0 };
      atual.quantidade_pedidos += Number(item.quantity ?? 0);
      if (!atual.imagem_url && item.image_url) atual.imagem_url = item.image_url;
      agregados.set(item.sku, atual);
      itensNovosProcessados.push({ pedido_olist_id: pedido.id, item_olist_id: itemOlistId, sku: item.sku });
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
