BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.estampas, public.estampa_jobs IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE alvos_remocao ON COMMIT DROP AS
WITH nomes AS (SELECT e.*, upper(regexp_replace(regexp_replace(
 replace(btrim(COALESCE(NULLIF(btrim(e.original_filename),''),NULLIF(btrim(e.original_relative_path),''),e.storage_key)),chr(92),'/'),
 '^.*/',''), '[.][^.]*$','')) AS nome_base FROM public.estampas e)
SELECT n.id FROM nomes n WHERE EXISTS (
 SELECT 1 FROM public.configuracoes_jobs c,
 unnest(c.termos_ignorados_nome_arquivo) termo
 WHERE c.chave='processar-estampas' AND btrim(termo)<>''
 AND CASE WHEN btrim(termo)='-' THEN right(n.nome_base,1)='-'
 ELSE strpos(n.nome_base,upper(btrim(termo)))>0 END
) AND (n.processing_status='COMPLETED' OR n.ai_metadata IS NOT NULL
 OR EXISTS (SELECT 1 FROM public.estampa_jobs j WHERE j.estampa_id=n.id AND j.status='COMPLETED'))
AND n.id IN (857,873,881,883,885,897,899,901,903,905);

DO $check$
BEGIN
 IF (SELECT count(*) FROM alvos_remocao)<>10 THEN
  RAISE EXCEPTION 'Os registros alvo mudaram; remoção cancelada.';
 END IF;
 IF EXISTS (SELECT 1 FROM public.estampa_jobs j JOIN alvos_remocao a ON a.id=j.estampa_id
 WHERE j.status::text IN ('PROCESSING','WAITING_PROVIDER')) THEN
  RAISE EXCEPTION 'Um job alvo está ativo; remoção cancelada.';
 END IF;
END $check$;
CREATE TEMP TABLE registros_preservados ON COMMIT DROP AS
SELECT id,to_jsonb(e) AS dados FROM public.estampas e
WHERE NOT EXISTS (SELECT 1 FROM alvos_remocao a WHERE a.id=e.id);

DELETE FROM public.estampa_jobs j USING alvos_remocao a WHERE j.estampa_id=a.id;
DELETE FROM public.estampas e USING alvos_remocao a WHERE e.id=a.id;

DO $check$
BEGIN
 IF EXISTS (SELECT 1 FROM public.estampas e JOIN alvos_remocao a ON a.id=e.id)
 OR EXISTS (SELECT 1 FROM public.estampa_jobs j JOIN alvos_remocao a ON a.id=j.estampa_id) THEN
  RAISE EXCEPTION 'Remoção incompleta; transação cancelada.';
 END IF;
 IF EXISTS (
 (SELECT id,dados FROM registros_preservados EXCEPT SELECT id,to_jsonb(e) FROM public.estampas e)
 UNION ALL
 (SELECT id,to_jsonb(e) FROM public.estampas e EXCEPT SELECT id,dados FROM registros_preservados)
 ) THEN
  RAISE EXCEPTION 'Registros fora do escopo alterados; transação cancelada.';
 END IF;
END $check$;
COMMIT;
