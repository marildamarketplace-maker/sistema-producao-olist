WITH tarefas(nome, descricao, link_apoio, prioridade, hora_prevista, dias_semana) AS (
  VALUES
    (
      'Validar solicitação de pedido de manhã',
      'Validar as solicitações de produção recebidas no período da manhã.',
      'https://sistema.meuryshop.com.br/solicitacoes-producao',
      'ALTA'::"PrioridadeTarefaMidia",
      '09:00',
      ARRAY[1,2,3,4,5]::INTEGER[]
    ),
    (
      'Validar solicitação de pedido de tarde',
      'Validar as solicitações de produção recebidas no período da tarde.',
      'https://sistema.meuryshop.com.br/solicitacoes-producao',
      'ALTA'::"PrioridadeTarefaMidia",
      '14:00',
      ARRAY[1,2,3,4,5]::INTEGER[]
    ),
    (
      'Validar chats de manhã',
      E'Validar as mensagens da Shopee, TikTok, Direct do Instagram e WhatsApp no período da manhã.\nLinks adicionais:\nhttps://seller.shopee.com.br/new-webchat/conversations\nhttps://seller-br.tiktok.com/chat/inbox/current?lang=pt-BR&oec_seller_id=7494613694621582877&shop_region=BR',
      'https://www.instagram.com/direct/inbox/',
      'MEDIA'::"PrioridadeTarefaMidia",
      '09:00',
      ARRAY[1,2,3,4,5,6]::INTEGER[]
    ),
    (
      'Validar chats de tarde',
      E'Validar as mensagens da Shopee, TikTok, Direct do Instagram e WhatsApp no período da tarde.\nLinks adicionais:\nhttps://seller.shopee.com.br/new-webchat/conversations\nhttps://seller-br.tiktok.com/chat/inbox/current?lang=pt-BR&oec_seller_id=7494613694621582877&shop_region=BR',
      'https://www.instagram.com/direct/inbox/',
      'MEDIA'::"PrioridadeTarefaMidia",
      '14:00',
      ARRAY[1,2,3,4,5,6]::INTEGER[]
    ),
    (
      'Conferir solicitações de amostra Shopee e TikTok',
      E'Conferir as solicitações de amostra nos programas de afiliados da Shopee e do TikTok.\nLink adicional:\nhttps://seller.shopee.com.br/portal/web-seller-affiliate/homepage',
      'https://affiliate.tiktok.com/product/sample-request?is_new_connect=0&is_new_user=0&shop_region=BR&shop_id=7494613694621582877',
      'BAIXA'::"PrioridadeTarefaMidia",
      NULL,
      ARRAY[1,2,3,4,5]::INTEGER[]
    ),
    (
      'Conferir ROAS dos anúncios Shopee e TikTok',
      E'Conferir o ROAS no painel de controle de anúncios da Shopee e do TikTok.\nLink adicional:\nhttps://seller-br.tiktok.com/ads-creation/dashboard?activated_tab_id=0&is_new_connect=0&mpa=1&type=product&list_start_date=1784630567308&list_end_date=1784630567308&shop_region=BR&sp_campaign_list_pgm=%5B%5D_',
      'https://seller.shopee.com.br/portal/marketing/pas/index?source_page_id=1&from=1784516400&to=1784602799&type=new_cpc_homepage&group=yesterday&offset=572',
      'MEDIA'::"PrioridadeTarefaMidia",
      NULL,
      ARRAY[1,2,3,4,5,6]::INTEGER[]
    ),
    (
      'Responder avaliações da loja Shopee e TikTok',
      E'Responder a lista de avaliações da loja na Shopee e no TikTok.\nLink adicional:\nhttps://seller.shopee.com.br/portal/settings/shop/rating?pageNumber=1&fromPageNumber=1&cursor=0&pageSize=20&replied=ALL&ratingStar=ALL&ratingStar=5&ratingStar=4&ratingStar=3&ratingStar=2&ratingStar=1',
      'https://seller-br.tiktok.com/product/rating?shop_region=BR',
      'BAIXA'::"PrioridadeTarefaMidia",
      NULL,
      ARRAY[1,2,3,4,5]::INTEGER[]
    ),
    (
      'Cobrar vídeo dos produtos em estoque ou solicitados',
      E'Cobrar os vídeos dos produtos que estão em estoque ou foram solicitados.\nLink adicional:\nhttps://sistema.meuryshop.com.br/estoque',
      'https://sistema.meuryshop.com.br/confirmar-producao',
      'BAIXA'::"PrioridadeTarefaMidia",
      NULL,
      ARRAY[1,2,3,4,5]::INTEGER[]
    ),
    (
      'Dar baixa nos produtos vendidos e enviados',
      'Dar baixa no estoque dos produtos que foram vendidos e enviados para o cliente.',
      'https://sistema.meuryshop.com.br/baixa-estoque-olist',
      'ALTA'::"PrioridadeTarefaMidia",
      NULL,
      ARRAY[1,2,3,4,5,6]::INTEGER[]
    ),
    (
      'Impulsionar 4 produtos Shopee de manhã',
      'Impulsionar quatro produtos na Shopee no período da manhã.',
      'https://seller.shopee.com.br/portal/product/list/live/all?operationSortBy=recommend_v2',
      'BAIXA'::"PrioridadeTarefaMidia",
      '09:00',
      ARRAY[0,1,2,3,4,5,6]::INTEGER[]
    ),
    (
      'Impulsionar 4 produtos Shopee de tarde',
      'Impulsionar quatro produtos na Shopee no período da tarde.',
      'https://seller.shopee.com.br/portal/product/list/live/all?operationSortBy=recommend_v2',
      'BAIXA'::"PrioridadeTarefaMidia",
      '14:00',
      ARRAY[0,1,2,3,4,5,6]::INTEGER[]
    ),
    (
      'Impulsionar 4 produtos Shopee de noite',
      'Impulsionar quatro produtos na Shopee no período da noite.',
      'https://seller.shopee.com.br/portal/product/list/live/all?operationSortBy=recommend_v2',
      'BAIXA'::"PrioridadeTarefaMidia",
      '20:00',
      ARRAY[0,1,2,3,4,5,6]::INTEGER[]
    )
)
INSERT INTO "tarefas_midia" (
  "aplicativo_id",
  "nome",
  "descricao",
  "link_apoio",
  "periodicidade",
  "prioridade",
  "ativa",
  "data_inicio",
  "hora_prevista",
  "dias_semana"
)
SELECT
  aplicativo.id,
  tarefas.nome,
  tarefas.descricao,
  tarefas.link_apoio,
  'DIARIA'::"PeriodicidadeTarefaMidia",
  tarefas.prioridade,
  true,
  DATE '2026-07-21',
  tarefas.hora_prevista,
  tarefas.dias_semana
FROM "aplicativo" aplicativo
CROSS JOIN tarefas
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER(tarefas.nome)
);
