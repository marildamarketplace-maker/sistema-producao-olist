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
  "dias_semana",
  "dia_mes",
  "ordinal_semana_mes",
  "dia_semana_mensal"
)
SELECT
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
);
