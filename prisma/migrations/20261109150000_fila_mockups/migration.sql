BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE public.fila_mockups (
  id uuid NOT NULL,
  aplicativo_id uuid NOT NULL REFERENCES public.aplicativo(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  solicitado_por uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  trabalhos jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fila_mockups_pkey PRIMARY KEY (aplicativo_id, solicitado_por, id),
  CONSTRAINT fila_mockups_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT fila_mockups_trabalhos_check CHECK (
    CASE WHEN jsonb_typeof(trabalhos) = 'array' THEN jsonb_array_length(trabalhos) BETWEEN 1 AND 500 ELSE false END
  )
);

CREATE INDEX fila_mockups_pendentes_idx ON public.fila_mockups (created_at) WHERE status = 'PENDING';
ALTER TABLE public.fila_mockups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fila_mockups FROM PUBLIC, anon, authenticated;

COMMIT;
