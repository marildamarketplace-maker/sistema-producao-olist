# Auditoria de estoque físico por referência

Job: `GET /api/cron/auditoria-estoque-referencias`.
Autenticação: `Authorization: Bearer <CRON_SECRET>`; configuração ausente é negada.
Agendamento em `vercel.json`: semanalmente, às segundas-feiras às 12h UTC (09h em America/Sao_Paulo).

## Ativação

Após publicar, acrescentar `AUDITORIA_ESTOQUE_REFERENCIAS` e `NOTIFICAR` ao campo
`jobs` do aplicativo, preservando as demais chaves. Preencher `whatsapp` com DDI e
DDD; múltiplos números podem ser separados por vírgula. A integração Olist deve
estar conectada e ter permissão de leitura de Produtos e Estoque. Nenhuma migração
é necessária. A implementação não altera automaticamente a configuração dos aplicativos.

## Cálculo

- Lista somente produtos ativos (`situacao=A`), sem filtro textual remoto, até página vazia.
  Seleciona localmente descrições contendo `ref`, sem diferenciar maiúsculas e minúsculas.
  A busca `nome=ref` da API pode retornar zero mesmo com referências visíveis no ERP.
- Consulta `GET /estoque/{idProduto}` para cada produto encontrado.
- Usa o campo `saldo` físico da resposta; não desconta `reservado`, nem usa `disponivel`.
- Usa o saldo total fornecido pelo Olist; não soma depósitos novamente. Depósitos
  desconsiderados e configurações da conta seguem a apuração da própria API.
- Agrupa pela descrição completa removendo somente o sufixo `- LOTE N`, mais unidade.
  Ignora diferenças de caixa/espaços na chave e preserva materiais e referências completas.
  Cadastros com nomes diferentes além desse sufixo ficam separados para evitar mistura indevida.
- Inclui produto base e lotes positivos, negativos e zerados. Usa Decimal para a soma.
- Lista todos os grupos no cálculo; somente grupos com total negativo geram WhatsApp.
  Um lote negativo com total positivo não gera alerta. Ausência de negativos não gera mensagem.

Contrato conferido no Swagger oficial:
https://erp.tiny.com.br/public-api/v3/swagger/swagger.json

## Envio assíncrono e duplicatas

Grava uma `Notification` PENDENTE por destinatário e parte da mensagem.
O job não chama Z-API. O processador existente `/api/cron/processar-notifications`,
agendado a cada cinco minutos, faz o envio e aplica sua política de tentativas.
O envio depende de `NOTIFICAR` e das credenciais existentes do remetente.

Relatórios longos são divididos em partes de até 3.400 caracteres, sem omitir lotes.
Os IDs são derivados do aplicativo, destinatário, data de São Paulo, relatório e
índice da parte. `createMany` com `skipDuplicates` torna o enqueue atômico e impede
que execuções concorrentes/repetidas gravem o mesmo relatório no mesmo dia.
Um relatório diferente no mesmo dia pode gerar novo alerta; na próxima execução semanal,
negativos persistentes geram lembrete. Execuções manuais em outro dia também podem gerar
novo alerta. Não há comparação histórica de agravamento.
Mensagens em ERRO continuam sujeitas ao fluxo operacional existente da fila.

## Falhas e limites

Qualquer lote inválido, ID/unidade/saldo ausente, duplicação na paginação, falha HTTP
(inclusive 429) ou prazo excedido interrompe a auditoria daquele aplicativo sem
enfileirar totais parciais. Os demais aplicativos são tratados isoladamente.
A resposta HTTP é 500 quando algum aplicativo falha; os logs não incluem tokens,
telefones ou erros HTTP completos. Logs e resposta incluem diagnóstico seguro: etapa,
offset ou ID do produto quando disponíveis, código da falha e status HTTP. Mensagens,
headers e corpos arbitrários do provedor não são serializados.

Há orçamento compartilhado de aproximadamente 240 segundos de consultas, abaixo dos
300 segundos da função. Cada consulta tem timeout de 20 segundos. Catálogos grandes,
muitos aplicativos ou limite de API baixo podem impedir conclusão: nesse caso o
job falha explicitamente e precisa de execução posterior ou evolução para processamento
com checkpoints. A auditoria consulta saldos sequencialmente; não representa um
snapshot transacional enquanto o Olist recebe movimentações simultâneas.

## Validação local

`node --import tsx --test tests/auditoria-estoque-referencias.test.ts`

Cobre consolidação do print, precisão decimal, unidades/materiais distintos,
paginação, isolamento do aplicativo, payload inválido, falhas sem resultado parcial,
prazo, mensagens longas e identidade idempotente das notificações.
A integração autenticada Olist, a inserção concorrente no banco e a entrega real
por WhatsApp precisam de validação no ambiente publicado.
