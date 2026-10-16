-- O fluxo anterior somente marcava PROCESSAR e não executava criação externa.
-- No fluxo novo, PROCESSAR e reserva nascem na mesma transação.
-- Reabre apenas os marcadores antigos, sem tentativa nem pedido registrado.
UPDATE pedido_fornecedor_queue q
SET status = 'PENDENTE', versao = versao + 1
WHERE q.status = 'PROCESSAR'
  AND NOT EXISTS (SELECT 1 FROM envio_fornecedor e WHERE e.solicitacao_id = q.solicitacao_producao_id)
  AND NOT EXISTS (SELECT 1 FROM pedido_fornecedor_solicitacao p WHERE p.solicitacao_id = q.solicitacao_producao_id);
