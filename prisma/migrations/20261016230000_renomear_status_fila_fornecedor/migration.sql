-- Renomeia os valores no próprio enum; preserva registros e constraints existentes.
DO $$
DECLARE par record;
BEGIN
  FOR par IN SELECT * FROM (VALUES
    ('PROCESSANDO', 'PROCESSAR'),
    ('ENVIADO', 'CONCLUIDO'),
    ('COM_FALHA', 'FALHADO')
  ) AS nomes(anterior, novo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname='status_pedido_fornecedor_queue' AND e.enumlabel=par.anterior
    ) THEN
      EXECUTE format('ALTER TYPE public.status_pedido_fornecedor_queue RENAME VALUE %L TO %L', par.anterior, par.novo);
    END IF;
  END LOOP;
END $$;
