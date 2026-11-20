BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE ia_configuracao
  ADD COLUMN gerar_automaticamente boolean NOT NULL DEFAULT false;

COMMIT;
