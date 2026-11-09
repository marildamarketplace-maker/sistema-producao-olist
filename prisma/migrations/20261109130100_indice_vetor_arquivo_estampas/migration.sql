-- Execute este arquivo como uma instrução isolada, fora de uma transação.
CREATE INDEX CONCURRENTLY idx_estampas_search_vector_arquivo_gin
  ON public.estampas USING gin (search_vector_arquivo);
