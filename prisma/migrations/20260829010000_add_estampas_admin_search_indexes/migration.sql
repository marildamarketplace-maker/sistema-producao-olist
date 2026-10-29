-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Apenas os tres indices ausentes; os GIN equivalentes de cores/categorias sao preservados.
CREATE INDEX IF NOT EXISTS idx_estampas_status_created_at ON public.estampas (processing_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estampas_elementos_visuais_gin ON public.estampas USING GIN (elementos_visuais);
CREATE INDEX IF NOT EXISTS idx_estampas_ocasioes_gin ON public.estampas USING GIN (ocasioes);

COMMIT;
