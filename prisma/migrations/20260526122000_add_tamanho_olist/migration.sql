-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Repeticao segura do mesmo default ja previsto em 20260524210000.
ALTER TABLE public.tamanho ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;
