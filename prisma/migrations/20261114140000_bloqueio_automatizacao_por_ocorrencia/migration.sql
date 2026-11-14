BEGIN;
SET LOCAL lock_timeout = '5s';

-- Uma intervenção pendente pertence ao horário que falhou, não à rotina inteira.
CREATE UNIQUE INDEX "automatizacao_rotina_bloqueada_v4"
  ON "automatizacao_execucao" ("aplicativoId", "rotinaId")
  WHERE (tipo <> 'TESTE_ROTINA'::text AND status NOT IN ('CONCLUIDA'::text, 'FALHA_FINAL'::text, 'BLOQUEADA'::text));
DROP INDEX "automatizacao_rotina_bloqueada";
ALTER INDEX "automatizacao_rotina_bloqueada_v4" RENAME TO "automatizacao_rotina_bloqueada";
COMMIT;
