-- Expansão compatível com a versão anterior: não altera ativação nem escopo.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
UPDATE usuario
SET pode_visualizar_olist_formas_recebimento = true
WHERE pode_visualizar_olist_formas_pagamento
  AND NOT pode_visualizar_olist_formas_recebimento;
COMMIT;
