BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- A chave composta impede vínculos entre aplicativos diferentes também no banco.
ALTER TABLE public.produtos ADD CONSTRAINT produtos_id_aplicativo_key UNIQUE (id, aplicativo_id);
CREATE TABLE public.calendario_evento_produtos (
  aplicativo_id uuid NOT NULL REFERENCES public.aplicativo(id) ON DELETE CASCADE,
  evento_id varchar(100) NOT NULL,
  produto_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (aplicativo_id, evento_id, produto_id),
  FOREIGN KEY (produto_id, aplicativo_id) REFERENCES public.produtos(id, aplicativo_id) ON DELETE CASCADE
);
CREATE INDEX calendario_evento_produtos_produto_id_aplicativo_id_idx
  ON public.calendario_evento_produtos(produto_id, aplicativo_id);
-- Somente o backend autorizado usa esta relação. Não expor via Data API.
ALTER TABLE public.calendario_evento_produtos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendario_evento_produtos FROM anon, authenticated;
COMMIT;
