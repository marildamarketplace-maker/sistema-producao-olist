BEGIN;

ALTER TABLE public.estampas
  ADD COLUMN IF NOT EXISTS tipo_imagem TEXT NOT NULL DEFAULT 'INDEFINIDO',
  ADD COLUMN IF NOT EXISTS conteudos_imagem TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS suporte_aplicacao TEXT NOT NULL DEFAULT 'NAO_APLICAVEL',
  ADD COLUMN IF NOT EXISTS descricao_aplicacao TEXT,
  ADD COLUMN IF NOT EXISTS confianca_tipo_imagem DOUBLE PRECISION;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estampas'::regclass
      AND conname = 'estampas_tipo_imagem_check'
  ) THEN
    ALTER TABLE public.estampas ADD CONSTRAINT estampas_tipo_imagem_check
      CHECK (tipo_imagem IN ('ESTAMPA', 'LAYOUT', 'APLICACAO_PRODUTO', 'INDEFINIDO'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estampas'::regclass
      AND conname = 'estampas_suporte_aplicacao_check'
  ) THEN
    ALTER TABLE public.estampas ADD CONSTRAINT estampas_suporte_aplicacao_check
      CHECK (suporte_aplicacao IN (
        'MODELO_REAL', 'MANEQUIM', 'PRODUTO_ISOLADO', 'AMBIENTE',
        'MISTO', 'OUTRO', 'NAO_APLICAVEL'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estampas'::regclass
      AND conname = 'estampas_conteudos_imagem_check'
  ) THEN
    ALTER TABLE public.estampas ADD CONSTRAINT estampas_conteudos_imagem_check
      CHECK (conteudos_imagem <@ ARRAY[
        'ESTAMPA', 'APLICACAO_PRODUTO', 'MODELO_REAL', 'MANEQUIM',
        'PRODUTO_ISOLADO', 'AMBIENTE', 'TEXTO', 'VARIANTES', 'OUTRO'
      ]::TEXT[]);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estampas'::regclass
      AND conname = 'estampas_confianca_tipo_imagem_check'
  ) THEN
    ALTER TABLE public.estampas ADD CONSTRAINT estampas_confianca_tipo_imagem_check
      CHECK (confianca_tipo_imagem IS NULL OR confianca_tipo_imagem BETWEEN 0 AND 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estampas'::regclass
      AND conname = 'estampas_aplicacao_visual_consistente_check'
  ) THEN
    ALTER TABLE public.estampas ADD CONSTRAINT estampas_aplicacao_visual_consistente_check
      CHECK (
        (
          suporte_aplicacao = 'NAO_APLICAVEL'
          AND descricao_aplicacao IS NULL
          AND NOT (conteudos_imagem @> ARRAY['APLICACAO_PRODUTO']::TEXT[])
          AND tipo_imagem <> 'APLICACAO_PRODUTO'
        )
        OR
        (
          suporte_aplicacao <> 'NAO_APLICAVEL'
          AND btrim(COALESCE(descricao_aplicacao, '')) <> ''
          AND conteudos_imagem @> ARRAY['APLICACAO_PRODUTO']::TEXT[]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estampas'::regclass
      AND conname = 'estampas_tipo_apresentacao_consistente_check'
  ) THEN
    ALTER TABLE public.estampas ADD CONSTRAINT estampas_tipo_apresentacao_consistente_check
      CHECK (tipo_imagem <> 'ESTAMPA' OR suporte_aplicacao = 'NAO_APLICAVEL');
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_estampas_tipo_imagem
  ON public.estampas (tipo_imagem);
CREATE INDEX IF NOT EXISTS idx_estampas_suporte_aplicacao
  ON public.estampas (suporte_aplicacao);
CREATE INDEX IF NOT EXISTS estampas_conteudos_imagem_gin
  ON public.estampas USING GIN (conteudos_imagem);

COMMIT;
