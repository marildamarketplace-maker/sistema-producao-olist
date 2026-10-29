-- Fixture isolada da estrutura anterior; nao executar em producao.
BEGIN;

ALTER TABLE aplicativo
  ADD COLUMN aplicativo_pai_id uuid,
  ADD CONSTRAINT aplicativo_pai_id_fkey
    FOREIGN KEY (aplicativo_pai_id) REFERENCES aplicativo(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT aplicativo_pai_nao_pode_ser_proprio
    CHECK (aplicativo_pai_id IS NULL OR aplicativo_pai_id <> id);

CREATE INDEX idx_aplicativo_pai_id ON aplicativo(aplicativo_pai_id);

-- MV PRINTS MATRIZ, MV PRINTS FILIAL e SEU OLHAR pertencem à MV Tecidos.
-- Em ambientes sem esses cadastros, nenhum aplicativo é criado ou alterado.
UPDATE aplicativo
SET aplicativo_pai_id = '00000000-0000-0000-0000-000000000002',
    updated_at = now()
WHERE id IN (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);

COMMIT;
