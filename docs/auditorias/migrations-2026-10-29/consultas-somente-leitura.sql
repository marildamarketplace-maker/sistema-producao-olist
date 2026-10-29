-- AUDITORIA SOMENTE DE LEITURA. Não contém execução de migrations.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';

-- 20260716171000_seed_formas_pagamento_planos_ausentes
WITH formas (id, nome, parcelado) AS (
  VALUES
    ('336540343', 'Dinheiro', false),
    ('336540344', 'Cartão de crédito', false),
    ('336540345', 'Cartão de débito', false),
    ('336540346', 'Boleto', true),
    ('336540347', 'Cheque', true),
    ('336540348', 'Depósito', false),
    ('336540349', 'Crediário', false),
    ('336540350', 'Vale-troca', false),
    ('336540351', 'Pix', false),
    ('336540352', 'Cashback', false),
    ('344411685', 'Vale-presente', false)
),
planos_permitidos (nome) AS (
  VALUES
    ('A vista'),
    ('15/30/45/60'),
    ('30'),
    ('30/45'),
    ('30/45/60'),
    ('30/60'),
    ('30/60/90/120'),
    ('30/60/90/150'),
    ('45'),
    ('60'),
    ('60/90/120')
)
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo."id",
  formas.id,
  formas.nome,
  plano."id"
FROM "aplicativo" AS aplicativo
CROSS JOIN formas
JOIN planos_permitidos ON formas.parcelado OR planos_permitidos.nome = 'A vista'
JOIN "plano_pagamento" AS plano ON plano."nome" = planos_permitidos.nome) AS candidatos;

-- 20260721100000_seed_tarefas_midia_operacao_ausentes
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
SELECT count(*) AS ausentes FROM (SELECT
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
)) AS candidatos;

-- 20260721110000_seed_tarefa_semanal_oferta_relampago_ausentes
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo.id,
  'Criar oferta relâmpago Shopee',
  'Criar e configurar a oferta relâmpago semanal da Shopee.',
  'https://seller.shopee.com.br/portal/marketing/shop-flash-sale/create',
  'SEMANAL'::"PeriodicidadeTarefaMidia",
  'ALTA'::"PrioridadeTarefaMidia",
  true,
  DATE '2026-07-21',
  NULL,
  ARRAY[0]::INTEGER[]
FROM "aplicativo" aplicativo
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER('Criar oferta relâmpago Shopee')
)) AS candidatos;

-- 20260721120000_seed_tarefa_quinzenal_google_storage_ausentes
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo.id,
  'Conferir resumo de custo do Google Storage',
  'Conferir o resumo de custos do Google Storage e validar eventuais variações de consumo.',
  'https://console.cloud.google.com/billing/01E312-51BA35-C4B8C1?project=forro-mesa-retangular',
  'QUINZENAL'::"PeriodicidadeTarefaMidia",
  'ALTA'::"PrioridadeTarefaMidia",
  true,
  DATE '2026-07-26',
  NULL,
  ARRAY[0]::INTEGER[]
FROM "aplicativo" aplicativo
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER('Conferir resumo de custo do Google Storage')
)) AS candidatos;

-- 20260721130000_seed_tarefas_mensais_financeiro_ausentes
WITH tarefas(nome, descricao, link_apoio) AS (
  VALUES
    (
      'Enviar relatório de notas fiscais para a contabilidade',
      E'Preparar e enviar por e-mail o relatório das notas fiscais de entrada e saída do mês anterior. Informar a quantidade de notas e o valor total (exemplo: Quantidade: 11; Valor total: R$ 8.787,42). Anexar uma planilha Excel com todas as notas de entrada e saída.',
      NULL
    ),
    (
      'Realizar pagamento da DAS do mês anterior',
      'Localizar no e-mail e realizar o pagamento da DAS referente ao mês anterior.',
      NULL
    ),
    (
      'Realizar pagamento da nota fiscal da MV do mês anterior',
      'Entrar em contato com a MV, obter a nota fiscal referente ao mês anterior e realizar o pagamento.',
      NULL
    ),
    (
      'Validar gastos na Shopee do mês anterior',
      'Conferir e validar os gastos da Shopee referentes ao mês anterior.',
      'https://seller.shopee.com.br/portal/finance/wallet/shopeepay?size=50'
    ),
    (
      'Validar gastos no TikTok do mês anterior',
      'Conferir e validar os gastos do TikTok referentes ao mês anterior.',
      'https://seller-br.tiktok.com/finance/bills?subTab=paid&tab=payouts'
    ),
    (
      'Validar gastos na Nuvem ADS do mês anterior',
      'Conferir e validar os gastos da Nuvem ADS referentes ao mês anterior.',
      'https://lojadoamarildamarketplace.lojavirtualnuvem.com.br/admin/social/meta/#/'
    ),
    (
      'Validar outros gastos do mês anterior',
      'Conferir e validar os demais gastos referentes ao mês anterior.',
      NULL
    ),
    (
      'Solicitar entrada Shopee do mês anterior',
      'Solicitar e conferir os valores de entrada da Shopee referentes ao mês anterior.',
      NULL
    ),
    (
      'Validar entrada TikTok do mês anterior',
      'Conferir e validar os valores de entrada do TikTok referentes ao mês anterior.',
      NULL
    ),
    (
      'Validar entrada Outros do mês anterior',
      'Conferir e validar os demais valores de entrada referentes ao mês anterior.',
      NULL
    )
)
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo.id,
  tarefas.nome,
  tarefas.descricao,
  tarefas.link_apoio,
  'MENSAL'::"PeriodicidadeTarefaMidia",
  'ALTA'::"PrioridadeTarefaMidia",
  true,
  DATE '2026-07-21',
  NULL,
  ARRAY[]::INTEGER[],
  1,
  NULL,
  NULL
FROM "aplicativo" aplicativo
CROSS JOIN tarefas
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER(tarefas.nome)
)) AS candidatos;

-- 20260721150000_seed_tarefa_quinzenal_novos_produtos_ausentes
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo.id,
  'Cadastrar novos produtos',
  'Cadastrar os novos produtos disponíveis nos canais de venda.',
  ARRAY[]::TEXT[],
  'QUINZENAL'::"PeriodicidadeTarefaMidia",
  'ALTA'::"PrioridadeTarefaMidia",
  true,
  DATE '2026-07-25',
  NULL,
  ARRAY[6]::INTEGER[]
FROM "aplicativo" aplicativo
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER('Cadastrar novos produtos')
)) AS candidatos;

-- 20260721160000_seed_tarefa_semanal_devolucoes_ausentes
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo.id,
  'Validar devoluções da Shopee e TikTok',
  'Validar semanalmente as devoluções da Shopee e do TikTok, confirmar o recebimento e dar entrada nos produtos devolvidos.',
  ARRAY[
    'https://seller-br.tiktok.com/order/return?from=menu',
    'https://seller.shopee.com.br/portal/sale/returnrefundcancel'
  ]::TEXT[],
  'SEMANAL'::"PeriodicidadeTarefaMidia",
  'ALTA'::"PrioridadeTarefaMidia",
  true,
  DATE '2026-07-21',
  NULL,
  ARRAY[1]::INTEGER[]
FROM "aplicativo" aplicativo
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER('Validar devoluções da Shopee e TikTok')
)) AS candidatos;

-- 20260721170000_seed_tarefas_mensais_cancelamento_notas_ausentes
WITH tarefas(nome, descricao) AS (
  VALUES
    (
      'Cancelar notas fiscais de pedidos devolvidos',
      'Identificar os pedidos devolvidos no mês anterior e cancelar as respectivas notas fiscais.'
    ),
    (
      'Cancelar notas fiscais de pedidos cancelados',
      'Identificar os pedidos cancelados no mês anterior e cancelar as respectivas notas fiscais.'
    )
)
SELECT count(*) AS ausentes FROM (SELECT
  aplicativo.id,
  tarefas.nome,
  tarefas.descricao,
  ARRAY[]::TEXT[],
  'MENSAL'::"PeriodicidadeTarefaMidia",
  'MEDIA'::"PrioridadeTarefaMidia",
  true,
  DATE '2026-07-21',
  NULL,
  ARRAY[]::INTEGER[],
  1,
  NULL,
  NULL
FROM "aplicativo" aplicativo
CROSS JOIN tarefas
WHERE NOT EXISTS (
  SELECT 1
  FROM "tarefas_midia" existente
  WHERE existente."aplicativo_id" = aplicativo.id
    AND LOWER(existente."nome") = LOWER(tarefas.nome)
)) AS candidatos;

-- whitelabel_backfill
SELECT (SELECT count(*) FROM public."produtos" WHERE aplicativo_id IS NULL) AS "produtos", (SELECT count(*) FROM public."configuracoes_sistema" WHERE aplicativo_id IS NULL) AS "configuracoes_sistema", (SELECT count(*) FROM public."solicitacoes_producao" WHERE aplicativo_id IS NULL) AS "solicitacoes_producao", (SELECT count(*) FROM public."itens_solicitacao_producao" WHERE aplicativo_id IS NULL) AS "itens_solicitacao_producao", (SELECT count(*) FROM public."pedidos_olist_processados" WHERE aplicativo_id IS NULL) AS "pedidos_olist_processados", (SELECT count(*) FROM public."movimentacoes_estoque" WHERE aplicativo_id IS NULL) AS "movimentacoes_estoque", (SELECT count(*) FROM public."solicitacoes_devolucao" WHERE aplicativo_id IS NULL) AS "solicitacoes_devolucao", (SELECT count(*) FROM public."itens_solicitacao_devolucao" WHERE aplicativo_id IS NULL) AS "itens_solicitacao_devolucao", (SELECT count(*) FROM public."baixas_estoque_olist" WHERE aplicativo_id IS NULL) AS "baixas_estoque_olist", (SELECT count(*) FROM public."itens_baixa_estoque_olist" WHERE aplicativo_id IS NULL) AS "itens_baixa_estoque_olist", (SELECT count(*) FROM public."controles_busca_olist" WHERE aplicativo_id IS NULL) AS "controles_busca_olist", (SELECT count(*) FROM public."integracao_olist_tokens" WHERE aplicativo_id IS NULL) AS "integracao_olist_tokens";

-- tamanho_backfill
SELECT count(*) AS candidatos_nulos FROM tamanho t WHERE t.quantidade_produto_fornecedor IS NULL AND EXISTS (SELECT 1 FROM tamanho_produto_fornecedor f WHERE f.tamanho_id=t.id);

-- produto_fornecido_backfill
SELECT count(DISTINCT COALESCE(po.produto_id,p.id)) AS candidatos_sem_associacao FROM produto_olist po JOIN tipo_produto_produto_fornecedor t ON t.tipo_produto_id=po.tipo_produto_id LEFT JOIN produtos p ON p.sku=po.sku_final WHERE COALESCE(po.produto_id,p.id) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produto_olist_produto_fornecedor x WHERE x.produto_id=COALESCE(po.produto_id,p.id));

-- planos_seed
SELECT count(*) AS ausentes FROM unnest(ARRAY['A vista','15/30/45/60','30','30/45','30/45/60','30/60','30/60/90/120','30/60/90/150','45','60','60/90/120']) AS x(nome) WHERE NOT EXISTS(SELECT 1 FROM plano_pagamento p WHERE p.nome=x.nome);

-- permissoes_tarefas_backfill
SELECT count(*) AS categorias_sem_tarefas FROM usuario WHERE pode_visualizar_categorias_midia AND NOT pode_visualizar_tarefas_midia;

-- config_jobs_seed
SELECT count(*) AS registros, count(*) FILTER (WHERE NOT pausado) AS habilitados, count(*) FILTER (WHERE termos_ignorados_nome_arquivo @> ARRAY['-','.','MOCKUP']::text[]) AS termos_originais_presentes, count(*) FILTER (WHERE EXISTS(SELECT 1 FROM unnest(termos_ignorados_nome_arquivo) x WHERE upper(btrim(x))='MOCLKUP')) AS moclkup_presente FROM configuracoes_jobs WHERE chave='processar-estampas';

-- matriz_backfill
SELECT count(*) FILTER (WHERE aplicativo_pai_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000002'::uuid) AS divergentes FROM aplicativo WHERE id IN ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005');

-- fornecedores_matriz
SELECT count(*) FILTER (WHERE f.aplicativo_pai_id IS NULL) AS nulos, count(*) FILTER (WHERE a.aplicativo_pai_id IS NOT NULL) AS vinculados_a_filial FROM fornecedores f LEFT JOIN aplicativo a ON a.id=f.aplicativo_pai_id;

-- fila_reabertura
SELECT count(*) AS candidatos_atuais FROM pedido_fornecedor_queue q WHERE q.status='PROCESSAR' AND NOT EXISTS(SELECT 1 FROM envio_fornecedor e WHERE e.solicitacao_id=q.solicitacao_producao_id) AND NOT EXISTS(SELECT 1 FROM pedido_fornecedor_solicitacao p WHERE p.solicitacao_id=q.solicitacao_producao_id);

-- dados_constraints_faltantes
SELECT
 (SELECT count(*) FROM notification WHERE tentativas<0) AS notification_tentativas_negativas,
 (SELECT count(*) FROM acesso_pagina_usuario WHERE acessos<=0) AS acessos_invalidos,
 (SELECT count(*) FROM pedido_fornecedor_queue WHERE versao<0) AS versoes_negativas,
 (SELECT count(*) FROM pedido_fornecedor_queue WHERE NOT ((aplicativo_filial_id IS NULL AND direcionado_por_id IS NULL AND direcionado_em IS NULL) OR (aplicativo_filial_id IS NOT NULL AND direcionado_por_id IS NOT NULL AND direcionado_em IS NOT NULL))) AS direcionamento_incompleto,
 (SELECT count(*) FROM solicitacoes_producao WHERE NOT ((evidencia_url IS NULL AND evidencia_bucket IS NULL AND evidencia_storage_path IS NULL) OR (evidencia_url IS NOT NULL AND evidencia_bucket IS NOT NULL AND evidencia_storage_path IS NOT NULL))) AS evidencia_incompleta,
 (SELECT count(*) FROM itens_retorno_estoque_olist WHERE quantidade<=0) AS retornos_quantidade_invalida,
 (SELECT count(*) FROM estampa_jobs j WHERE NOT EXISTS(SELECT 1 FROM estampas e WHERE e.id=j.estampa_id)) AS jobs_orfaos,
 (SELECT count(*) FROM (SELECT provider_custom_id FROM estampa_jobs WHERE provider_custom_id IS NOT NULL GROUP BY provider_custom_id HAVING count(*)>1) d) AS provider_custom_duplicados,
 (SELECT count(*) FROM (SELECT estampa_id,tipo FROM estampa_jobs GROUP BY estampa_id,tipo HAVING count(*)>1) d) AS jobs_duplicados,
 (SELECT count(*) FROM (SELECT codigo FROM estampa WHERE variante IS NULL GROUP BY codigo HAVING count(*)>1) d) AS codigo_sem_variante_duplicado,
 (SELECT count(*) FROM (SELECT codigo,variante FROM estampa WHERE variante IS NOT NULL GROUP BY codigo,variante HAVING count(*)>1) d) AS codigo_variante_duplicado;

-- rls_privilegios
SELECT c.relname AS tabela,c.relrowsecurity AS rls,r.rolname AS papel,has_table_privilege(r.rolname,c.oid,'SELECT') AS leitura,has_table_privilege(r.rolname,c.oid,'INSERT') AS insercao,has_table_privilege(r.rolname,c.oid,'UPDATE') AS alteracao,has_table_privilege(r.rolname,c.oid,'DELETE') AS exclusao FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relname IN ('notification','acesso_pagina_usuario','pedido_fornecedor_queue','retornos_estoque_olist','itens_retorno_estoque_olist','configuracoes_jobs','envio_fornecedor','config_fornecedor_filial','previa_fornecedor','componentes_kit_estoque') AND r.rolname IN ('anon','authenticated') ORDER BY c.relname,r.rolname;

-- funcoes_privilegios
SELECT p.proname,r.rolname,has_function_privilege(r.rolname,p.oid,'EXECUTE') AS executar FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.proname IN ('buscar_estampas_por_relevancia','validar_matriz_fornecedor','proteger_matriz_com_fornecedores') AND r.rolname IN ('anon','authenticated','service_role') ORDER BY p.proname,r.rolname;

-- catalogo_tipos_precisao
SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale,datetime_precision,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position;

-- extensoes
SELECT e.extname,n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('unaccent','pgcrypto');

-- taxonomia_nao_normalizada
SELECT count(*) AS divergentes FROM estampas e WHERE tema IS DISTINCT FROM estampas_normalizar_taxonomia_texto(tema) OR estilo IS DISTINCT FROM estampas_normalizar_taxonomia_texto(estilo) OR subtemas IS DISTINCT FROM estampas_normalizar_taxonomia_lista(subtemas) OR palavras_chave IS DISTINCT FROM estampas_normalizar_taxonomia_lista(palavras_chave) OR cores IS DISTINCT FROM estampas_normalizar_taxonomia_lista(cores) OR elementos_visuais IS DISTINCT FROM estampas_normalizar_taxonomia_lista(elementos_visuais) OR ocasioes IS DISTINCT FROM estampas_normalizar_taxonomia_lista(ocasioes) OR categorias IS DISTINCT FROM estampas_normalizar_taxonomia_lista(categorias);

-- 20260831020000_add_estampa_textile_taxonomy_dados
WITH candidatos AS (
  SELECT
    id,
    lower(extensions.unaccent(concat_ws(' ',
      titulo,
      descricao,
      tema,
      texto_pesquisa,
      array_to_string(palavras_chave, ' '),
      array_to_string(elementos_visuais, ' ')
    ))) AS texto
  FROM public.estampas
), poas AS (
  SELECT id
  FROM candidatos
  WHERE texto ~ '(^|[^[:alnum:]])(poas?|bolinhas?|polka[[:space:]]+dots?)([^[:alnum:]]|$)'
     OR (
       texto ~ '(^|[^[:alnum:]])pontos?([^[:alnum:]]|$)'
       AND texto ~ '(^|[^[:alnum:]])padrao([^[:alnum:]]|$)'
       AND texto ~ '(^|[^[:alnum:]])geometrico([^[:alnum:]]|$)'
     )
)
SELECT count(*) AS candidatos, count(*) FILTER(WHERE NOT e.padroes_texteis @> ARRAY['poá']::text[]) AS sem_poa, count(*) FILTER(WHERE COALESCE(e.confianca_padrao_textil,0)<0.9) AS confianca_baixa, count(*) FILTER(WHERE lower(extensions.unaccent(COALESCE(e.texto_pesquisa,''))) !~ '(^|[^[:alnum:]])poa([^[:alnum:]]|$)') AS sem_termo FROM poas JOIN public.estampas e USING(id);

-- 20260831021000_complete_poa_textile_backfill_dados
WITH candidatos AS (
  SELECT
    id,
    lower(extensions.unaccent(COALESCE(titulo, ''))) AS titulo,
    lower(extensions.unaccent(COALESCE(tema, ''))) AS tema,
    lower(extensions.unaccent(concat_ws(' ',
      titulo,
      descricao,
      texto_pesquisa,
      array_to_string(palavras_chave, ' '),
      array_to_string(elementos_visuais, ' ')
    ))) AS texto
  FROM public.estampas
), poas AS (
  SELECT id
  FROM candidatos
  WHERE texto ~ '(^|[^[:alnum:]])(poas?|bolinhas?|polka[[:space:]]+dots?)([^[:alnum:]]|$)'
     OR (
       titulo ~ '(^|[^[:alnum:]])estampa([^[:alnum:]]|$).*(^|[^[:alnum:]])pontos?([^[:alnum:]]|$)'
       AND tema = 'geometrico'
     )
)
SELECT count(*) AS candidatos, count(*) FILTER(WHERE NOT e.padroes_texteis @> ARRAY['poá']::text[]) AS sem_poa, count(*) FILTER(WHERE COALESCE(e.confianca_padrao_textil,0)<0.9) AS confianca_baixa, count(*) FILTER(WHERE lower(extensions.unaccent(COALESCE(e.texto_pesquisa,''))) !~ '(^|[^[:alnum:]])poa([^[:alnum:]]|$)') AS sem_termo FROM poas JOIN public.estampas e USING(id);

-- search_vector_desatualizado
SELECT count(*) AS divergentes FROM estampas e WHERE e.search_vector IS DISTINCT FROM (
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(e.codigo, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(e.variante, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(e.titulo, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(e.tema, ''))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(e.padroes_texteis, ' '))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(e.descricao, ''))), 'C') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(e.texto_pesquisa, ''))), 'D') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(e.publicos_sugeridos, ' '))), 'D') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(e.contextos_uso, ' '))), 'D') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(e.afinidades_visuais, ' '))), 'D'));

-- resumo_linhas_catalogos
SELECT (SELECT count(*) FROM estampa) AS estampa_legada,(SELECT count(*) FROM estampas) AS estampas_ia,(SELECT count(*) FROM estampa_jobs) AS jobs,(SELECT count(*) FROM aplicativo) AS aplicativos;

-- nullable_arrays
SELECT (SELECT count(*) FROM tarefas_midia WHERE dias_semana IS NULL) AS tarefas_dias_semana_nulos,(SELECT count(*) FROM buscas_sku WHERE situacoes IS NULL) AS buscas_situacoes_nulas,(SELECT count(*) FROM configuracoes_jobs WHERE variantes_permitidas IS NULL) AS variantes_nulas;

-- devolucao_fk_orfaos
SELECT count(*) AS itens_orfaos FROM itens_solicitacao_devolucao i WHERE NOT EXISTS(SELECT 1 FROM solicitacoes_devolucao s WHERE s.id=i.solicitacao_id);

-- default_app
SELECT EXISTS(SELECT 1 FROM aplicativo WHERE id='00000000-0000-0000-0000-000000000001'::uuid) AS app_padrao_presente;

-- seed_tarefas_escopo
SELECT count(DISTINCT aplicativo_id) AS aplicativos_com_tarefas,count(*) AS total_tarefas FROM tarefas_midia;

-- planos_associacoes
SELECT (SELECT count(*) FROM forma_pagamento_olist_plano) AS vinculos_pagamento,(SELECT count(*) FROM forma_recebimento_olist_plano) AS vinculos_recebimento;

-- monthly_schedule
SELECT count(*) AS mensais_fora_dia_1 FROM tarefas_midia WHERE periodicidade='MENSAL' AND nome IN ('Enviar relatório de notas fiscais para a contabilidade','Realizar pagamento da DAS do mês anterior','Realizar pagamento da nota fiscal da MV do mês anterior','Validar gastos na Shopee do mês anterior','Validar gastos no TikTok do mês anterior','Validar gastos na Nuvem ADS do mês anterior','Validar outros gastos do mês anterior','Solicitar entrada Shopee do mês anterior','Validar entrada TikTok do mês anterior','Validar entrada Outros do mês anterior') AND (dia_mes IS DISTINCT FROM 1 OR ordinal_semana_mes IS NOT NULL OR dia_semana_mensal IS NOT NULL);

ROLLBACK;
