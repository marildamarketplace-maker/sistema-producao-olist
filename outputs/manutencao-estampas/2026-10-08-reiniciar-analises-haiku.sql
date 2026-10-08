BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.estampas, public.estampa_jobs IN SHARE ROW EXCLUSIVE MODE;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.estampa_jobs WHERE status::text IN ('PROCESSING', 'WAITING_PROVIDER')) THEN
    RAISE EXCEPTION 'Limpeza cancelada: há jobs em processamento.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.estampa_ai_batches WHERE status::text NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'Limpeza cancelada: há batches ativos.';
  END IF;
END
$check$;

CREATE TEMP TABLE origens_estampas_antes ON COMMIT DROP AS
SELECT id, codigo, variante, preview_url, storage_key, original_relative_path,
       original_filename, original_extension, content_hash, arquivo_id, created_at, is_active
FROM public.estampas;

UPDATE public.configuracoes_jobs
SET pausado = true, updated_at = CURRENT_TIMESTAMP
WHERE chave = 'processar-estampas';

UPDATE public.estampa_jobs
SET status = 'PENDING',
    tentativas = 0,
    ultimo_erro = NULL,
    modelo_utilizado = NULL,
    next_attempt_at = CURRENT_TIMESTAMP,
    started_at = NULL,
    finished_at = NULL,
    locked_at = NULL,
    worker_id = NULL,
    batch_id = NULL,
    provider_custom_id = NULL,
    manual_requested = false,
    manual_requested_at = NULL,
    manual_requested_by = NULL,
    updated_at = CURRENT_TIMESTAMP;

UPDATE public.estampas
SET titulo = NULL, descricao = NULL, tema = NULL, estilo = NULL,
    subtemas = ARRAY[]::text[], palavras_chave = ARRAY[]::text[],
    cores = ARRAY[]::text[], elementos_visuais = ARRAY[]::text[],
    ocasioes = ARRAY[]::text[], categorias = ARRAY[]::text[],
    texto_pesquisa = NULL, ai_metadata = NULL, ai_processed_hash = NULL,
    processing_status = 'PENDING', processing_error = NULL, processed_at = NULL,
    tipo_imagem = 'INDEFINIDO', conteudos_imagem = ARRAY[]::text[],
    suporte_aplicacao = 'NAO_APLICAVEL', descricao_aplicacao = NULL,
    confianca_tipo_imagem = NULL, publicos_sugeridos = ARRAY[]::text[],
    contextos_uso = ARRAY[]::text[], afinidades_visuais = ARRAY[]::text[],
    confianca_segmentacao = NULL, padroes_texteis = ARRAY[]::text[],
    confianca_padrao_textil = NULL, updated_at = CURRENT_TIMESTAMP;

DO $check$
BEGIN
  IF EXISTS (
    (SELECT * FROM origens_estampas_antes
     EXCEPT SELECT id, codigo, variante, preview_url, storage_key, original_relative_path,
       original_filename, original_extension, content_hash, arquivo_id, created_at, is_active
     FROM public.estampas)
    UNION ALL
    (SELECT id, codigo, variante, preview_url, storage_key, original_relative_path,
       original_filename, original_extension, content_hash, arquivo_id, created_at, is_active
     FROM public.estampas EXCEPT SELECT * FROM origens_estampas_antes)
  ) THEN RAISE EXCEPTION 'Verificação falhou: dados de origem alterados.'; END IF;
  IF EXISTS (SELECT 1 FROM public.estampas WHERE processing_status <> 'PENDING'
             OR ai_metadata IS NOT NULL OR ai_processed_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'Verificação falhou: limpeza das análises incompleta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.estampa_jobs WHERE status::text <> 'PENDING'
             OR tentativas <> 0 OR worker_id IS NOT NULL OR locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Verificação falhou: fila não reiniciada.';
  END IF;
END
$check$;
COMMIT;
