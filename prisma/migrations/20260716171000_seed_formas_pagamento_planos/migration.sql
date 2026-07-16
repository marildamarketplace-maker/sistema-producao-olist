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
INSERT INTO "forma_pagamento_olist_plano" (
  "aplicativo_id",
  "forma_olist_id",
  "forma_olist_nome",
  "plano_pagamento_id"
)
SELECT
  aplicativo."id",
  formas.id,
  formas.nome,
  plano."id"
FROM "aplicativo" AS aplicativo
CROSS JOIN formas
JOIN planos_permitidos ON formas.parcelado OR planos_permitidos.nome = 'A vista'
JOIN "plano_pagamento" AS plano ON plano."nome" = planos_permitidos.nome
ON CONFLICT ("aplicativo_id", "forma_olist_id", "plano_pagamento_id") DO NOTHING;
