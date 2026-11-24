-- Amplia apenas as opções permitidas; mantém as escolhas e defaults existentes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE olist_sync_configuracao
  DROP CONSTRAINT olist_sync_config_entidades,
  ADD CONSTRAINT olist_sync_config_entidades CHECK (
    cardinality(entidades) BETWEEN 1 AND 5
    AND entidades <@ ARRAY['PRODUTO','CONTATO','FORMA_PAGAMENTO','VENDEDOR','SERVICO']
  );

ALTER TABLE olist_sync_cobertura
  DROP CONSTRAINT olist_sync_cobertura_entidade_check,
  ADD CONSTRAINT olist_sync_cobertura_entidade_check CHECK (
    entidade IN ('PRODUTO','CONTATO','FORMA_PAGAMENTO','VENDEDOR','SERVICO')
  );

ALTER TABLE olist_sync_afetado
  DROP CONSTRAINT olist_sync_afetado_entidade_check,
  ADD CONSTRAINT olist_sync_afetado_entidade_check CHECK (
    entidade IN ('PRODUTO','CONTATO','FORMA_PAGAMENTO','VENDEDOR','SERVICO')
  );

COMMIT;
