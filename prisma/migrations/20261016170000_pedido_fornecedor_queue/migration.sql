-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.pedido_fornecedor_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pedido_fornecedor_queue FROM PUBLIC, anon, authenticated;

COMMIT;
