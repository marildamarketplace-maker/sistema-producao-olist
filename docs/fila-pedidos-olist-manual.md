# Envio manual da fila para a Olist

## Operação

1. Em Pedidos → Fila de pedidos, salvar a filial destinatária.
2. Mais opções → Enviar para a Olist: pesquisar cliente, vendedor, produtos, serviço de laser e forma na conta da filial.
3. Selecionar o plano local associado à forma **nessa filial**, revisar preços e gerar a prévia.
4. Conferir produtos, consumo, informações adicionais, observações, parcelas e total. Confirmar explicitamente a criação.
5. Consultar o resultado e ID Olist em Mais opções. A solicitação original permanece intacta; a montagem usa o JSON revisado da fila.

Configurações validadas são sugeridas por fornecedor + filial, com IDs, referências consultadas e preços. Continuam sujeitas à validação na prévia e confirmação. A prévia dura 15 minutos, pertence ao usuário e à versão da fila. Trocar filial exige salvar e gerar outra prévia.

Não há cron, reenvio automático ou WhatsApp neste fluxo.

## Concorrência e conferência manual

`envio_fornecedor.solicitacao_id` é a reserva compartilhada pelos envios direto e pela fila. A transação trava a solicitação antes de verificar registros e reservar. O HTTP ocorre fora da transação e o POST nunca é repetido automaticamente, nem após 401. O histórico registra tentativa, responsável, conta, instante e conferências.

- PENDENTE: aguardando configuração/confirmacão.
- PROCESSAR: reserva criada para a operação manual.
- CONCLUIDO: ID válido e registro local confirmados na mesma transação.
- FALHADO: rejeição conhecida ou resultado incerto.
- CANCELADO: bloqueado; nenhuma ação nova de cancelamento.

Timeout, HTTP não conclusivo, resposta sem ID ou falha de persistência depois do POST bloqueiam reenvio. Uma reserva interrompida com mais de 10 minutos é apresentada como resultado incerto ao consultar seu detalhe, sem disparar processamento.

Em Mais opções, o administrador pode informar o ID existente e uma justificativa. O servidor consulta **a conta da tentativa**, exige o identificador `Solicitacao fornecedor: <UUID>` nas observações internas e registra o vínculo. Se nenhum pedido foi criado, o administrador precisa conferir a conta, confirmar explicitamente a ausência e justificar a liberação. Um ID já conhecido impede essa liberação. Nunca liberar ausência apenas por timeout: um servidor externo pode ter aceitado o pedido mesmo sem resposta.

## Preparação e validação operacional

Aplicar as migrations `20261017000000_envio_manual_fila_fornecedor` e `20261017001000_reabrir_fila_sem_envio_olist` antes de disponibilizar o código. A segunda retorna a PENDENTE os antigos marcadores PROCESSAR sem reserva e sem pedido registrado; no novo fluxo essa combinação não pode nascer, pois reserva e status são atômicos. Ela é aditiva e reexecutável, cria as reservas, prévias e sugestões, adiciona conta destinatária ao registro existente e restringe as novas tabelas ao backend com RLS.

Configurar OAuth, conectar a Olist da filial e associar os planos locais às formas dessa conta. Em consulta somente leitura realizada em 16/10/2026, MV PRINTS FILIAL, MV PRINTS MATRIZ e SEU OLHAR estavam sem configuração OAuth completa e sem associações de planos. Isso impede considerar o fluxo operacional até nova verificação.

Após publicar, gerar uma prévia controlada na filial escolhida, conferir todas as seleções e criar apenas o pedido aprovado pelo administrador. Confirmar na Olist e no banco o mesmo ID e a conta correta. Testes locais com banco/HTTP simulados e navegador com dados fictícios não substituem essa aceitação.

## Verificações locais

- `npm test`: regras comerciais, isolamento, consultas na filial, prévia sem criação, confirmação, conciliação, corridas entre os dois fluxos e falhas incertas.
- `npx tsc --noEmit --incremental false` e lint nos arquivos alterados.
- `npm run build`.
- Interface: conferir formulário, busca, edição, erros preservando valores, prévia, resultado, rolagem, foco, Tab/Escape e temas em 360–390px e 1280–1440px. A validação em viewport é emulada; dispositivo real e sessão autenticada publicada exigem aceite separado.
