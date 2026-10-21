-- NULL identifica retorno registrado por perda na entrega, sem entrada de estoque.
ALTER TABLE public.itens_retorno_estoque_olist ALTER COLUMN movimentacao_id DROP NOT NULL;
