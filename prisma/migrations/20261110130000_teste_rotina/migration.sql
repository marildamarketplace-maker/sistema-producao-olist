BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX "automatizacao_rotina_bloqueada_v2"
  ON "automatizacao_execucao" ("aplicativoId", "rotinaId")
  WHERE (tipo <> 'TESTE_ROTINA'::text AND status <> 'CONCLUIDA'::text);

CREATE UNIQUE INDEX "automatizacao_teste_em_aberto"
  ON "automatizacao_execucao" ("aplicativoId", "rotinaId")
  WHERE (tipo = 'TESTE_ROTINA'::text AND status NOT IN ('CONCLUIDA'::text, 'FALHA_FINAL'::text));

DROP INDEX "automatizacao_rotina_bloqueada";
ALTER INDEX "automatizacao_rotina_bloqueada_v2" RENAME TO "automatizacao_rotina_bloqueada";
COMMIT;
