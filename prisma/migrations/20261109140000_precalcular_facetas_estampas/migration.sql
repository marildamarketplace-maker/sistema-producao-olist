BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE SCHEMA estampas_interno;
REVOKE ALL ON SCHEMA estampas_interno FROM PUBLIC, anon, authenticated;

CREATE MATERIALIZED VIEW estampas_interno.facetas_pesquisa AS
WITH valores AS (
  SELECT e.processing_status, opcoes.tipo, item.valor
  FROM public.estampas e
  CROSS JOIN LATERAL (VALUES
    ('temas', ARRAY[e.tema]),
    ('cores', e.cores),
    ('elementosVisuais', e.elementos_visuais),
    ('categorias', e.categorias),
    ('ocasioes', e.ocasioes),
    ('publicosSugeridos', e.publicos_sugeridos),
    ('contextosUso', e.contextos_uso),
    ('afinidadesVisuais', e.afinidades_visuais),
    ('padroesTexteis', e.padroes_texteis),
    ('estilos', ARRAY[e.estilo]),
    ('tiposImagem', ARRAY[e.tipo_imagem]),
    ('conteudosImagem', e.conteudos_imagem),
    ('suportesAplicacao', ARRAY[e.suporte_aplicacao]),
    ('distribuicoes', ARRAY(
      SELECT jsonb_array_elements_text(CASE
        WHEN e.ai_metadata #>> '{response,composicaoVisual,distribuicao,estado}' = 'IDENTIFICADO'
          AND jsonb_typeof(e.ai_metadata #> '{response,composicaoVisual,distribuicao,valores}') = 'array'
        THEN e.ai_metadata #> '{response,composicaoVisual,distribuicao,valores}' ELSE '[]'::jsonb END)
    )),
    ('orientacoes', ARRAY(
      SELECT jsonb_array_elements_text(CASE
        WHEN e.ai_metadata #>> '{response,composicaoVisual,orientacao,estado}' = 'IDENTIFICADO'
          AND jsonb_typeof(e.ai_metadata #> '{response,composicaoVisual,orientacao,valores}') = 'array'
        THEN e.ai_metadata #> '{response,composicaoVisual,orientacao,valores}' ELSE '[]'::jsonb END)
    )),
    ('densidades', ARRAY(
      SELECT jsonb_array_elements_text(CASE
        WHEN e.ai_metadata #>> '{response,composicaoVisual,densidade,estado}' = 'IDENTIFICADO'
          AND jsonb_typeof(e.ai_metadata #> '{response,composicaoVisual,densidade,valores}') = 'array'
        THEN e.ai_metadata #> '{response,composicaoVisual,densidade,valores}' ELSE '[]'::jsonb END)
    )),
    ('linguagensVisuais', ARRAY(
      SELECT jsonb_array_elements_text(CASE
        WHEN e.ai_metadata #>> '{response,linguagemVisual,estado}' = 'IDENTIFICADO'
          AND jsonb_typeof(e.ai_metadata #> '{response,linguagemVisual,valores}') = 'array'
        THEN e.ai_metadata #> '{response,linguagemVisual,valores}' ELSE '[]'::jsonb END)
    )),
    ('aplicacoesSugeridas', ARRAY(
      SELECT sugestao->>'termo'
      FROM jsonb_array_elements(CASE
        WHEN e.ai_metadata #>> '{response,aplicacoesSugeridas,estado}' = 'IDENTIFICADO'
          AND jsonb_typeof(e.ai_metadata #> '{response,aplicacoesSugeridas,sugestoes}') = 'array'
        THEN e.ai_metadata #> '{response,aplicacoesSugeridas,sugestoes}' ELSE '[]'::jsonb END) AS sugestao
      -- Mesmo limiar de CONFIANCA_MINIMA_APLICACAO_PESQUISA no domínio.
      WHERE CASE WHEN jsonb_typeof(sugestao->'confianca') = 'number'
        THEN (sugestao->>'confianca')::numeric BETWEEN 0.7 AND 1 ELSE FALSE END
    ))
  ) AS opcoes(tipo, lista)
  CROSS JOIN LATERAL unnest(opcoes.lista) AS item(valor)
  WHERE e.is_active = TRUE
), normalizados AS (
  SELECT processing_status, tipo,
    CASE WHEN tipo IN ('tiposImagem', 'conteudosImagem', 'suportesAplicacao')
      THEN upper(btrim(valor))
      ELSE lower(regexp_replace(btrim(valor), '[[:space:]]+', ' ', 'g')) END AS valor
  FROM valores
  WHERE btrim(COALESCE(valor, '')) <> ''
), frequencias AS (
  -- TODOS conta a população inteira, inclusive valores fora do top 300 de cada status.
  SELECT CASE WHEN GROUPING(processing_status) = 1 THEN 'TODOS' ELSE processing_status END AS status,
    tipo, valor, count(*) AS frequencia
  FROM normalizados
  GROUP BY GROUPING SETS ((processing_status, tipo, valor), (tipo, valor))
  HAVING GROUPING(processing_status) = 1
    OR processing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
), numerados AS (
  SELECT status, tipo, valor,
    row_number() OVER (PARTITION BY status, tipo ORDER BY frequencia DESC, valor) AS posicao
  FROM frequencias
)
SELECT status, tipo, valor, posicao FROM numerados WHERE posicao <= 300;

REVOKE ALL ON estampas_interno.facetas_pesquisa FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX facetas_pesquisa_status_tipo_posicao_idx
  ON estampas_interno.facetas_pesquisa (status, tipo, posicao);

SELECT cron.schedule(
  'atualizar-facetas-pesquisa-estampas',
  '3,18,33,48 * * * *',
  'SET LOCAL lock_timeout = ''5s''; SET LOCAL statement_timeout = ''120s''; REFRESH MATERIALIZED VIEW CONCURRENTLY estampas_interno.facetas_pesquisa;'
);

COMMIT;
