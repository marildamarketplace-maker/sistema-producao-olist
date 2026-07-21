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
);
