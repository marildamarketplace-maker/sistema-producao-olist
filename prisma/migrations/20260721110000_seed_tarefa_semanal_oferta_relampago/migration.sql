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
);
