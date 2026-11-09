BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.fila_mockups
  ADD COLUMN observacao text NOT NULL DEFAULT '',
  ADD CONSTRAINT fila_mockups_observacao_check CHECK (char_length(observacao) <= 1500);

COMMIT;
