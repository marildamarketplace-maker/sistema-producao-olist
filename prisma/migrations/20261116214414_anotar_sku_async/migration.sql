BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE public.busca_sku_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicativo_id uuid NOT NULL REFERENCES public.aplicativo(id) ON DELETE RESTRICT,
  solicitado_por uuid NOT NULL,
  chave uuid NOT NULL,
  situacoes text[] NOT NULL CHECK (cardinality(situacoes) BETWEEN 1 AND 10 AND situacoes <@ ARRAY['8','0','3','4','1','7','5','6','2','9']::text[]),
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY','FALHOU','CONCLUIDO','CANCELADO')),
  etapa text NOT NULL DEFAULT 'LISTAGEM' CHECK (etapa IN ('LISTAGEM','DETALHAMENTO','CONSOLIDACAO')),
  situacao_indice int NOT NULL DEFAULT 0 CHECK (situacao_indice >= 0 AND situacao_indice < cardinality(situacoes)),
  pagina_offset int NOT NULL DEFAULT 0 CHECK (pagina_offset >= 0),
  passagem int NOT NULL DEFAULT 0 CHECK (passagem IN (0,1)),
  encontrados int NOT NULL DEFAULT 0 CHECK (encontrados >= 0),
  processados int NOT NULL DEFAULT 0 CHECK (processados >= 0 AND processados <= encontrados),
  ignorados int NOT NULL DEFAULT 0 CHECK (ignorados >= 0 AND ignorados <= processados),
  tentativas int NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 5),
  retomadas int NOT NULL DEFAULT 0 CHECK (retomadas >= 0),
  erro text,
  erro_codigo text,
  reserva_id uuid,
  reserva_ate timestamptz,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  busca_id uuid UNIQUE REFERENCES public.buscas_sku(id) ON DELETE SET NULL,
  teve_resultado boolean NOT NULL DEFAULT false,
  UNIQUE (aplicativo_id, solicitado_por, chave),
  UNIQUE (id, aplicativo_id),
  CHECK ((status = 'PROCESSANDO' AND reserva_id IS NOT NULL AND reserva_ate IS NOT NULL)
    OR (status <> 'PROCESSANDO' AND reserva_id IS NULL AND reserva_ate IS NULL)),
  CHECK ((status IN ('CONCLUIDO','CANCELADO')) = (finalizado_em IS NOT NULL)),
  CHECK (busca_id IS NULL OR (status = 'CONCLUIDO' AND teve_resultado))
);
CREATE UNIQUE INDEX busca_sku_job_aberto_unico ON public.busca_sku_jobs(aplicativo_id) WHERE status NOT IN ('CONCLUIDO','CANCELADO');
CREATE INDEX busca_sku_jobs_aplicativo_id_created_at_idx ON public.busca_sku_jobs(aplicativo_id, created_at);
CREATE INDEX busca_sku_jobs_status_proxima_tentativa_em_idx ON public.busca_sku_jobs(status, proxima_tentativa_em);
CREATE INDEX busca_sku_jobs_expirados_idx ON public.busca_sku_jobs(reserva_ate) WHERE status = 'PROCESSANDO';

CREATE TABLE public.busca_sku_job_pedidos (
  job_id uuid NOT NULL,
  aplicativo_id uuid NOT NULL,
  pedido_olist_id text NOT NULL CHECK (pedido_olist_id ~ '^[0-9]+$'),
  processado boolean NOT NULL DEFAULT false,
  ignorado boolean NOT NULL DEFAULT false,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  PRIMARY KEY (job_id, pedido_olist_id),
  FOREIGN KEY (job_id, aplicativo_id) REFERENCES public.busca_sku_jobs(id, aplicativo_id) ON DELETE CASCADE,
  CHECK (NOT ignorado OR processado)
);
CREATE INDEX busca_sku_job_pedidos_job_id_processado_pedido_olist_id_idx ON public.busca_sku_job_pedidos(job_id, processado, pedido_olist_id);
ALTER TABLE public.busca_sku_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.busca_sku_job_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.busca_sku_jobs, public.busca_sku_job_pedidos FROM PUBLIC, anon, authenticated;
COMMIT;
