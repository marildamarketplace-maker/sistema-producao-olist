-- CreateIndex
CREATE INDEX "olist_sync_estado_previsao_idx" ON "olist_sync_estado"("configuracao_id", "ultima_execucao_id", "verificado_em") WHERE (metadados_json @> '{"completo": true}'::jsonb);
