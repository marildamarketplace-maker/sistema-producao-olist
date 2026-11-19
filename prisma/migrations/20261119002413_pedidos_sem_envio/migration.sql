BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE public.pedido_sem_envio_jobs (
  aplicativo_id uuid PRIMARY KEY REFERENCES public.aplicativo(id) ON DELETE RESTRICT,
  referencia date NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU')),
  situacao_indice int NOT NULL DEFAULT 0 CHECK (situacao_indice IN (0,1)),
  pagina_offset int NOT NULL DEFAULT 0 CHECK (pagina_offset >= 0),
  tentativas int NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 5),
  pedidos_alertados int NOT NULL DEFAULT 0 CHECK (pedidos_alertados >= 0),
  notificacoes int NOT NULL DEFAULT 0 CHECK (notificacoes >= 0),
  erro_codigo text,
  reserva_id uuid,
  reserva_ate timestamptz,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'PROCESSANDO' AND reserva_id IS NOT NULL AND reserva_ate IS NOT NULL)
    OR (status <> 'PROCESSANDO' AND reserva_id IS NULL AND reserva_ate IS NULL))
);
CREATE INDEX pedido_sem_envio_jobs_pendentes_idx ON public.pedido_sem_envio_jobs(status, proxima_tentativa_em);
CREATE TABLE public.pedido_sem_envio_alertas (
  aplicativo_id uuid NOT NULL REFERENCES public.pedido_sem_envio_jobs(aplicativo_id) ON DELETE CASCADE,
  pedido_olist_id text NOT NULL CHECK (pedido_olist_id ~ '^[0-9]{1,30}$'),
  referencia date NOT NULL,
  PRIMARY KEY (aplicativo_id, pedido_olist_id)
);
CREATE INDEX pedido_sem_envio_alertas_referencia_idx ON public.pedido_sem_envio_alertas(referencia);
ALTER TABLE public.pedido_sem_envio_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_sem_envio_alertas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedido_sem_envio_jobs, public.pedido_sem_envio_alertas FROM PUBLIC, anon, authenticated;
INSERT INTO public.configuracoes_jobs(chave, pausado) VALUES ('alertar-pedidos-sem-envio', true) ON CONFLICT DO NOTHING;
COMMIT;
