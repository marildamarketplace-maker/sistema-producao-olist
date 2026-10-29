-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.retornos_estoque_olist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.retornos_estoque_olist FROM PUBLIC, anon, authenticated;
ALTER TABLE public.itens_retorno_estoque_olist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.itens_retorno_estoque_olist FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.itens_retorno_estoque_olist'::regclass AND conname = 'retorno_olist_quantidade_positiva') THEN
    ALTER TABLE public.itens_retorno_estoque_olist ADD CONSTRAINT retorno_olist_quantidade_positiva CHECK (quantidade > 0) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.itens_retorno_estoque_olist VALIDATE CONSTRAINT retorno_olist_quantidade_positiva;

-- movimentacao_id permanece anulavel: perdas na entrega nao geram entrada de estoque.

COMMIT;
