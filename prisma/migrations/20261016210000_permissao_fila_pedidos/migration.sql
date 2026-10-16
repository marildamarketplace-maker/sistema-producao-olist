ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS pode_gerenciar_fila_pedidos BOOLEAN NOT NULL DEFAULT false;
