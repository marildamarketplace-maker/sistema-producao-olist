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
);
