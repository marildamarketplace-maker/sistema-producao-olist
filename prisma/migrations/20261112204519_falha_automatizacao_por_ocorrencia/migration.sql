BEGIN;
SET LOCAL lock_timeout = '5s';

-- Falhas encerram somente sua ocorrência; mantém a exclusão entre trabalhos abertos.
CREATE UNIQUE INDEX "automatizacao_rotina_bloqueada_v3"
  ON "automatizacao_execucao" ("aplicativoId", "rotinaId")
  WHERE (tipo <> 'TESTE_ROTINA'::text AND status NOT IN ('CONCLUIDA'::text, 'FALHA_FINAL'::text));
DROP INDEX "automatizacao_rotina_bloqueada";
ALTER INDEX "automatizacao_rotina_bloqueada_v3" RENAME TO "automatizacao_rotina_bloqueada";
COMMIT;
