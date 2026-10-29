-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Mantem a unicidade por codigo/variante, sem restaurar o indice global antigo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estampa_codigo_sem_variante
  ON public.estampa (codigo) WHERE variante IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_estampa_codigo_variante
  ON public.estampa (codigo, variante) WHERE variante IS NOT NULL;

COMMIT;
