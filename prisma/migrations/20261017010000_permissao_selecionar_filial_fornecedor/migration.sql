ALTER TABLE public.usuario
  ADD COLUMN pode_selecionar_filial_fornecedor BOOLEAN NOT NULL DEFAULT false;
