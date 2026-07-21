ALTER TABLE "tarefas_midia"
  ADD COLUMN "links_apoio" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "tarefas_midia"
SET "links_apoio" = ARRAY["link_apoio"]
WHERE "link_apoio" IS NOT NULL AND BTRIM("link_apoio") <> '';

UPDATE "tarefas_midia"
SET
  "links_apoio" = ARRAY[
    'https://www.instagram.com/direct/inbox/',
    'https://seller.shopee.com.br/new-webchat/conversations',
    'https://seller-br.tiktok.com/chat/inbox/current?lang=pt-BR&oec_seller_id=7494613694621582877&shop_region=BR'
  ],
  "descricao" = CASE
    WHEN LOWER("nome") LIKE '%manhã%' THEN 'Validar as mensagens da Shopee, TikTok, Direct do Instagram e WhatsApp no período da manhã.'
    ELSE 'Validar as mensagens da Shopee, TikTok, Direct do Instagram e WhatsApp no período da tarde.'
  END
WHERE "nome" IN ('Validar chats de manhã', 'Validar chats de tarde');

UPDATE "tarefas_midia"
SET
  "links_apoio" = ARRAY[
    'https://affiliate.tiktok.com/product/sample-request?is_new_connect=0&is_new_user=0&shop_region=BR&shop_id=7494613694621582877',
    'https://seller.shopee.com.br/portal/web-seller-affiliate/homepage'
  ],
  "descricao" = 'Conferir as solicitações de amostra nos programas de afiliados da Shopee e do TikTok.'
WHERE "nome" = 'Conferir solicitações de amostra Shopee e TikTok';

UPDATE "tarefas_midia"
SET
  "links_apoio" = ARRAY[
    'https://seller.shopee.com.br/portal/marketing/pas/index?source_page_id=1&from=1784516400&to=1784602799&type=new_cpc_homepage&group=yesterday&offset=572',
    'https://seller-br.tiktok.com/ads-creation/dashboard?activated_tab_id=0&is_new_connect=0&mpa=1&type=product&list_start_date=1784630567308&list_end_date=1784630567308&shop_region=BR&sp_campaign_list_pgm=%5B%5D_'
  ],
  "descricao" = 'Conferir o ROAS no painel de controle de anúncios da Shopee e do TikTok.'
WHERE "nome" = 'Conferir ROAS dos anúncios Shopee e TikTok';

UPDATE "tarefas_midia"
SET
  "links_apoio" = ARRAY[
    'https://seller-br.tiktok.com/product/rating?shop_region=BR',
    'https://seller.shopee.com.br/portal/settings/shop/rating?pageNumber=1&fromPageNumber=1&cursor=0&pageSize=20&replied=ALL&ratingStar=ALL&ratingStar=5&ratingStar=4&ratingStar=3&ratingStar=2&ratingStar=1'
  ],
  "descricao" = 'Responder a lista de avaliações da loja na Shopee e no TikTok.'
WHERE "nome" = 'Responder avaliações da loja Shopee e TikTok';

UPDATE "tarefas_midia"
SET
  "links_apoio" = ARRAY[
    'https://sistema.meuryshop.com.br/confirmar-producao',
    'https://sistema.meuryshop.com.br/estoque'
  ],
  "descricao" = 'Cobrar os vídeos dos produtos que estão em estoque ou foram solicitados.'
WHERE "nome" = 'Cobrar vídeo dos produtos em estoque ou solicitados';

ALTER TABLE "ocorrencias_tarefas_midia"
  ADD COLUMN "links_relacionados" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "ocorrencias_tarefas_midia"
SET "links_relacionados" = ARRAY["link_relacionado"]
WHERE "link_relacionado" IS NOT NULL AND BTRIM("link_relacionado") <> '';

ALTER TABLE "tarefas_midia" DROP COLUMN "link_apoio";
ALTER TABLE "ocorrencias_tarefas_midia" DROP COLUMN "link_relacionado";
