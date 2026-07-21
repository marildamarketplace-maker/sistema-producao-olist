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
  "dias_semana",
  "dia_mes",
  "ordinal_semana_mes",
  "dia_semana_mensal"
)
SELECT
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
);

UPDATE "tarefas_midia"
SET
  "dia_mes" = 1,
  "ordinal_semana_mes" = NULL,
  "dia_semana_mensal" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "periodicidade" = 'MENSAL'::"PeriodicidadeTarefaMidia"
  AND "nome" IN (
    'Enviar relatório de notas fiscais para a contabilidade',
    'Realizar pagamento da DAS do mês anterior',
    'Realizar pagamento da nota fiscal da MV do mês anterior',
    'Validar gastos na Shopee do mês anterior',
    'Validar gastos no TikTok do mês anterior',
    'Validar gastos na Nuvem ADS do mês anterior',
    'Validar outros gastos do mês anterior',
    'Solicitar entrada Shopee do mês anterior',
    'Validar entrada TikTok do mês anterior',
    'Validar entrada Outros do mês anterior'
  );
