# Alerta de pedidos Olist sem envio

O job identifica pedidos que continuam em **Faturada (1)** ou **Pronto para envio (7)**, criados há **mais de cinco dias corridos**, e enfileira um aviso para os números de WhatsApp configurados no aplicativo. A idade usa a data de criação no calendário de São Paulo. Em 18/11, entram pedidos criados até 12/11; pedidos de 13/11 ainda têm exatamente cinco dias.

A situação da Olist é o indicador disponível: o aviso pede conferir a expedição, pois um pedido enviado fisicamente pode continuar com situação desatualizada no ERP. Não há consulta de rastreamento ou alteração de pedidos, notas e estoque.

## Execução e envio

- Endpoint: `GET /api/cron/alertar-pedidos-sem-envio`, protegido por `CRON_SECRET`.
- Uma verificação diária por aplicativo, a partir das 08h de São Paulo. O consumidor é chamado a cada 15 minutos entre 08h e 19h45, todos os dias, para continuar páginas e repetir falhas transitórias. Depois de concluir o dia, não consulta novamente a Olist até o próximo dia.
- Situações e data final são filtradas na Olist, com páginas de até 100 pedidos, ordenação crescente e sem limite inicial de histórico. O servidor revalida data e situação retornadas.
- Uma linha durável em `pedido_sem_envio_jobs` guarda referência, cursor, totais, tentativas, reserva e erro. Rodadas abertas continuam antes de iniciar outro dia; dias perdidos não geram um relatório por dia acumulado.
- Cada mensagem contém aplicativo, referência, número e ID do pedido, criação, situação e idade. Blocos de até 3.500 caracteres incluem todos os pedidos elegíveis da página. Nenhum nome, endereço, telefone ou documento de cliente é persistido no job ou incluído no aviso.
- O mesmo pedido recebe no máximo um alerta por referência diária em cada aplicativo, mesmo que mude entre as duas situações. A pendência pode voltar no relatório seguinte. Destinatários repetidos são normalizados e deduplicados.
- O checkpoint, a deduplicação e todas as notificações dos destinatários são gravados na mesma transação. A fila `notification` e seu consumidor WhatsApp existentes cuidam da entrega; `PENDENTE` significa somente enfileirado. Como no consumidor atual, uma queda depois do envio externo e antes da confirmação local ainda pode repetir a entrega.

## Ativação

O código e a migration estão preparados localmente. A configuração nasce **pausada** e nenhuma permissão de aplicativo é alterada automaticamente.

1. Aplicar a migration `prisma/migrations/20261119002413_pedidos_sem_envio/migration.sql`, gerar o Prisma Client e publicar esta versão da aplicação com o cron de `vercel.json`. Revisar outras migrations pendentes antes de executar um deploy geral do banco.
2. No aplicativo desejado, acrescentar `ALERTAR_PEDIDOS_SEM_ENVIO` à lista `aplicativo.jobs`, preservando as chaves existentes. Também são necessários `NOTIFICAR`, integração Olist conectada e números válidos em `aplicativo.whatsapp`.
3. Confirmar que o consumidor existente de `notification` está ativo e autorizado para esses destinatários. Este job apenas produz mensagens; não cria um segundo consumidor de WhatsApp.
4. Definir `pausado = false` na configuração `alertar-pedidos-sem-envio` em `configuracoes_jobs`.
5. Conferir o avanço de `pedido_sem_envio_jobs` e a passagem das mensagens de `PENDENTE` para `SUCESSO`. A resposta do cron informa `notificacoesEnfileiradas`, sem afirmar entrega.

Para interromper novas consultas e enfileiramentos, pausar essa configuração ou retirar a chave do aplicativo. Mensagens já enfileiradas continuam sob controle do consumidor existente. Uma falha terminal fica em `FALHOU`, com código sanitizado; a rodada do próximo dia pode tentar novamente. A consulta administrativa de estado deve projetar somente `aplicativo_id`, `referencia`, `status`, `situacao_indice`, `pagina_offset`, `pedidos_alertados`, `notificacoes`, `tentativas`, `erro_codigo` e `updated_at`, com filtro por aplicativo.

## Limites e concorrência

Reservas de três minutos e `FOR UPDATE SKIP LOCKED` impedem consumidores concorrentes de assumir o mesmo aplicativo. O checkpoint exige a reserva vigente e revalida habilitação e conexão. Reservas expiradas são recuperadas; queda na quinta tentativa deixa falha terminal. Há até cinco tentativas por página, backoff exponencial e respeito a `Retry-After` de até 24 horas.

Cada chamada HTTP tem limite de 20 segundos e resposta de até 2 MiB, sem seguir redirecionamentos. Um 401 permite uma renovação OAuth pelo cliente compartilhado e uma repetição; demais retries pertencem à fila. Cada rodada admite até 100 páginas e orçamento de 240 segundos, com margem de 70 segundos antes de iniciar outra página, dentro da função de 300 segundos.

A paginação por offset da Olist não oferece snapshot consistente: mudanças simultâneas no conjunto podem deslocar pedidos entre páginas. A deduplicação evita avisos repetidos, mas um pedido deslocado pode aparecer somente na verificação diária seguinte. O status também pode mudar entre a leitura da Olist e a entrega do WhatsApp.

## Egress e armazenamento

Não há busca de detalhes por pedido, catálogo, itens, imagens ou histórico de clientes. Em situação estável, são `max(1, ceil(F/100)) + max(1, ceil(P/100))` listagens diárias por aplicativo, onde F e P são os pedidos até a data limite nas duas situações. Falhas, renovação de token e paginação menor que o limite podem aumentar esse número.

São 48 invocações programadas por dia. Pausado, o endpoint lê apenas o booleano da configuração. Ativo e sem trabalho, retorna apenas contagens e nenhum pedido. As respostas do banco durante o processamento contêm a reserva, nome/números do próprio aplicativo e IDs novos do lote; não recarregam o histórico de notificações. O estado mantém uma linha por aplicativo e um registro da última referência alertada por pedido. Registros antigos são removidos em lotes de até 500 após 30 dias, preservando a referência da execução atual.

Os testes verificam limites e projeções comportamentais; não foi medido tráfego real nem economia financeira. O limite HTTP controla memória/volume por resposta, não é uma estimativa de consumo médio.

## Validação

Testes de domínio e contrato cobrem corte estrito, fuso, ano bissexto, datas inválidas, situações excluídas, todos os pedidos em mensagens limitadas, filtros enviados, renovação, retries, prazo, cota de páginas e autenticação do cron. Testes em PostgreSQL temporário cobrem agendamento, RLS, autorização exata, concorrência, deduplicação, rollback, múltiplos destinatários, recuperação de reserva, revogação, paginação, tentativas esgotadas e isolamento entre aplicativos.

```sh
node --import tsx --test tests/pedidos-sem-envio.test.ts
PEDIDOS_SEM_ENVIO_TEST_DATABASE_URL=postgresql://usuario:senha@127.0.0.1:5432/pedidos_sem_envio_test \
  node --import tsx --test tests/pedidos-sem-envio-database.test.ts
```

O teste de banco exige uma base local vazia e exclusiva. O envio real ao WhatsApp e a consulta autenticada da Olist não são executados pelos testes.

Contrato consultado: [documentação oficial Olist API v3](https://erp.tiny.com.br/public-api/v3/swagger/index.html), operação `GET /pedidos`. O agendamento segue a [configuração de cron da Vercel](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).
