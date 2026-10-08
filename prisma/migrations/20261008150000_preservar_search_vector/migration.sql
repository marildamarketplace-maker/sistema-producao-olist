ALTER TABLE public.estampas ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_estampas_search_vector_gin
ON public.estampas USING GIN (search_vector);
