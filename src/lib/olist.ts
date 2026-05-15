import { supabaseAdmin } from "@/lib/supabase-admin";

type OlistOrder = {
  id: string;
  status: string;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    image_url?: string;
  }>;
};

const STATUS_PERMITIDOS = new Set(["Em aberto", "Aprovado", "Preparando envio", "Faturado"]);

export async function buscarPedidosOlistPorDataLimite(dataLimite: string): Promise<OlistOrder[]> {
  const baseUrl = process.env.OLIST_API_URL;
  const token = process.env.OLIST_API_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Configure OLIST_API_URL e OLIST_API_TOKEN nas variáveis de ambiente da Vercel.");
  }

  const url = new URL("/orders", baseUrl);
  url.searchParams.set("shipping_deadline_lte", dataLimite);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Erro Olist ${response.status}`);
  }

  const payload = await response.json();
  const pedidos = (payload?.orders ?? payload?.results ?? []) as OlistOrder[];

  return pedidos.filter((pedido) => STATUS_PERMITIDOS.has(pedido.status));
}

export async function gerarSolicitacaoPorPedidosOlist(dataLimite: string) {
  const pedidos = await buscarPedidosOlistPorDataLimite(dataLimite);

  const agregados = new Map<string, { sku: string; nome: string; imagem_url: string | null; quantidade_pedidos: number }>();
  for (const pedido of pedidos) {
    for (const item of pedido.items ?? []) {
      const atual = agregados.get(item.sku) ?? { sku: item.sku, nome: item.name, imagem_url: item.image_url ?? null, quantidade_pedidos: 0 };
      atual.quantidade_pedidos += Number(item.quantity ?? 0);
      if (!atual.imagem_url && item.image_url) atual.imagem_url = item.image_url;
      agregados.set(item.sku, atual);
    }
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
  const estoqueMap = new Map((estoqueRows ?? []).map((e: any) => [e.sku, Number(e.estoque_atual ?? 0)]));

  const itens: any[] = [];
  for (const produto of (produtos ?? []) as any[]) {
    if (!produto.ativo) continue;
    const demanda = agregados.get(produto.sku);
    if (!demanda) continue;

    const estoqueAtual = estoqueMap.get(produto.sku) ?? 0;
    const metaEstoque = produto.meta_estoque ?? metaGeral;
    const quantidadeAProduzir = Math.max(0, demanda.quantidade_pedidos + metaEstoque - estoqueAtual);

    if (quantidadeAProduzir > 0) {
      itens.push({ produto_id: produto.id, sku: produto.sku, nome: produto.nome ?? demanda.nome, imagem_url: produto.imagem_url ?? demanda.imagem_url, quantidade_solicitada: quantidadeAProduzir });
    }
  }

  if (itens.length === 0) throw new Error("Não há necessidade de produção para os critérios informados.");

  const { data: solicitacao, error: solError } = await supabaseAdmin
    .from("solicitacoes_producao")
    .insert({ data_entrega: dataLimite, status: "em_producao", observacao_geral: "Gerada automaticamente via Olist" })
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

  return { solicitacao_id: solicitacao.id, itens: itensPayload.length };
}
