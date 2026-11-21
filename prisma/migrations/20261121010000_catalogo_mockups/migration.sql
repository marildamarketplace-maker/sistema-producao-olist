BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE public.mockups_catalogo (
  aplicativo_id uuid NOT NULL REFERENCES public.aplicativo(id) ON DELETE CASCADE ON UPDATE CASCADE,
  id varchar(608) NOT NULL,
  nome varchar(100) NOT NULL,
  tipo varchar(16) NOT NULL,
  categoria varchar(80) NOT NULL DEFAULT '',
  observacao_prompt varchar(1500) NOT NULL DEFAULT '',
  storage_path varchar(1024) NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mockups_catalogo_pkey PRIMARY KEY (aplicativo_id, id),
  CONSTRAINT mockups_catalogo_tipo_check CHECK (tipo IN ('INDIVIDUAL', 'LAYOUT', 'INFORMATIVO')),
  CONSTRAINT mockups_catalogo_storage_path_unique UNIQUE (aplicativo_id, storage_path)
);

CREATE INDEX mockups_catalogo_listagem_idx
  ON public.mockups_catalogo (aplicativo_id, tipo, created_at DESC, id DESC)
  WHERE ativo = true;

ALTER TABLE public.mockups_catalogo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mockups_catalogo FROM PUBLIC, anon, authenticated;

COMMIT;
