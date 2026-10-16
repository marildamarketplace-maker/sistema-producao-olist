DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='status_pedido_fornecedor_queue') THEN
    CREATE TYPE public.status_pedido_fornecedor_queue AS ENUM ('PENDENTE', 'PROCESSANDO', 'ENVIADO', 'COM_FALHA', 'CANCELADO');
  END IF;
END $$;
ALTER TABLE public.pedido_fornecedor_queue ADD COLUMN IF NOT EXISTS status public.status_pedido_fornecedor_queue NOT NULL DEFAULT 'PENDENTE';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pedido_fornecedor_queue'::regclass AND conname='pedido_fornecedor_queue_status_filial') THEN
    ALTER TABLE public.pedido_fornecedor_queue ADD CONSTRAINT pedido_fornecedor_queue_status_filial
      CHECK (status NOT IN ('PROCESSANDO', 'ENVIADO', 'COM_FALHA') OR aplicativo_filial_id IS NOT NULL);
  END IF;
END $$;
