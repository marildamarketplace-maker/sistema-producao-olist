INSERT INTO "tarefas_midia" (
  "aplicativo_id",
  "nome",
  "descricao",
  "links_apoio",
  "periodicidade",
  "prioridade",
  "ativa",
  "data_inicio",
  "hora_prevista",
  "dias_semana"
)
SELECT
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
);
