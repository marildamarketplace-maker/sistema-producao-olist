-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pedido_fornecedor_queue'::regclass AND conname = 'pedido_fornecedor_queue_direcionamento_completo') THEN
    ALTER TABLE public.pedido_fornecedor_queue ADD CONSTRAINT pedido_fornecedor_queue_direcionamento_completo CHECK (
    (aplicativo_filial_id IS NULL AND direcionado_por_id IS NULL AND direcionado_em IS NULL)
    OR (aplicativo_filial_id IS NOT NULL AND direcionado_por_id IS NOT NULL AND direcionado_em IS NOT NULL)
  ) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.pedido_fornecedor_queue VALIDATE CONSTRAINT pedido_fornecedor_queue_direcionamento_completo;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pedido_fornecedor_queue'::regclass AND conname = 'pedido_fornecedor_queue_versao_valida') THEN
    ALTER TABLE public.pedido_fornecedor_queue ADD CONSTRAINT pedido_fornecedor_queue_versao_valida CHECK (versao >= 0) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.pedido_fornecedor_queue VALIDATE CONSTRAINT pedido_fornecedor_queue_versao_valida;

COMMIT;
