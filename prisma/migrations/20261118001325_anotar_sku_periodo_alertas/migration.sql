BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- NULL identifica buscas anteriores: seus resultados/checkpoints não são reclassificados.
ALTER TABLE public.busca_sku_jobs
  ADD COLUMN periodo_inicio date,
  ADD COLUMN periodo_fim date,
  ADD COLUMN fora_periodo integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT busca_sku_jobs_periodo_check CHECK (
    (periodo_inicio IS NULL AND periodo_fim IS NULL) OR
    (periodo_inicio IS NOT NULL AND periodo_fim IS NOT NULL AND periodo_fim >= periodo_inicio AND periodo_fim - periodo_inicio < 366)
  ),
  ADD CONSTRAINT busca_sku_jobs_fora_periodo_check CHECK (fora_periodo >= 0 AND fora_periodo <= encontrados);

ALTER TABLE public.buscas_sku
  ADD COLUMN periodo_inicio date,
  ADD COLUMN periodo_fim date,
  ADD COLUMN pedidos_fora_periodo integer NOT NULL DEFAULT 0 CHECK (pedidos_fora_periodo >= 0),
  ADD CONSTRAINT buscas_sku_periodo_check CHECK (
    (periodo_inicio IS NULL AND periodo_fim IS NULL) OR
    (periodo_inicio IS NOT NULL AND periodo_fim IS NOT NULL AND periodo_fim >= periodo_inicio AND periodo_fim - periodo_inicio < 366)
  );

ALTER TABLE public.busca_sku_job_pedidos
  ADD COLUMN data_criacao date,
  ADD COLUMN fora_periodo boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT busca_sku_job_pedidos_fora_periodo_check CHECK (NOT fora_periodo OR (data_criacao IS NOT NULL AND processado AND itens = '[]'::jsonb));
CREATE INDEX busca_sku_job_pedidos_job_id_fora_periodo_pedido_olist_id_idx
  ON public.busca_sku_job_pedidos(job_id, fora_periodo, pedido_olist_id);

-- Nenhuma alteração de RLS, grants ou configuração de execução.
COMMIT;
