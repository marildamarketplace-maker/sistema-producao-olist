# Retorno de pedidos cancelados Olist

Acesso: **Pedidos → Retorno de cancelados Olist**, em `/retorno-estoque-olist`.

## Fluxo e regras

A busca consulta exclusivamente a situação `2` (Cancelado), usando data de atualização e janela padrão de sete dias, como a baixa atual. Não altera estoque nem os controles da busca de baixas.

Pedidos são separados entre elegíveis, sem baixa vinculada, integralmente retornados e pendentes de verificação. Um SKU baixado em outro pedido não torna o cancelado elegível. O retorno exige baixa do mesmo aplicativo, produto e saída compatíveis e SKU presente no detalhe do pedido.

Após selecionar os pedidos, informe quantidades inteiras entre zero e o saldo disponível. Zero exclui o item do envio. A revisão apresenta os itens antes da confirmação. Cada envio aceita até 500 itens; uma confirmação pode ser parcial, mantendo o saldo restante disponível.

O servidor revalida o cancelamento na Olist antes de gravar. Se a consulta falhar ou o status mudar, nenhuma entrada é criada. O registro de retorno e a entrada `RETORNO_CANCELAMENTO_OLIST` são gravados atomicamente, preservando a saída original. Há bloqueio das baixas em ordem estável e chave de idempotência por aplicativo; a mesma chave com outro conteúdo é rejeitada.

Uma tentativa com resultado incerto permanece bloqueada para edição e pode ser reenviada com a mesma chave. A aba guarda somente os identificadores e quantidades da tentativa em `sessionStorage`, separados por aplicativo e usuário, para recuperar o envio após recarga. Sessão expirada ou permissão revogada não descarta uma tentativa pendente. O histórico é paginado em grupos de 20 retornos e registra responsável, data, pedido, SKU e quantidade.

**Limite histórico:** devoluções manuais antigas não têm vínculo estruturado com a baixa e não são deduzidas automaticamente. A tela avisa o operador para conferir entradas anteriores. Não há retorno no ERP Olist, cron ou alteração do fluxo de devoluções existente.

## APIs e autorização

- `GET /api/olist/retorno-estoque/buscar`: data inicial padrão.
- `POST /api/olist/retorno-estoque/buscar`: `{ data_atualizacao?: "AAAA-MM-DD" }`.
- `POST /api/olist/retorno-estoque/confirmar`: `{ chave_idempotencia: UUID, itens: [{ item_baixa_id: UUID, quantidade: inteiro }] }`.
- `GET /api/olist/retorno-estoque/historico?pagina=1`: retornos e indicador `tem_mais`.

Todas as rotas exigem Bearer válido e usuário ativo. Leitura aceita `podeVisualizarDevolucao` ou `podeSolicitarDevolucao`; confirmação exige `podeSolicitarDevolucao`. O aplicativo vem da autenticação, nunca do payload. SKU, produto e movimentação são resolvidos no servidor. Mensagens internas de banco e respostas da integração não são expostas ao cliente.

## Banco e publicação

Migração: `prisma/migrations/20261021013941_retorno_estoque_olist/migration.sql`. Cria somente as duas tabelas de retorno, índices, vínculos, restrição de quantidade positiva e RLS. Retira os grants de `PUBLIC`, `anon` e `authenticated`; o navegador usa exclusivamente as APIs do servidor.

A migração foi aplicada e verificada em PostgreSQL nativo local descartável. **Não foi aplicada em produção.** Antes de disponibilizar a funcionalidade, aplicar essa migração pelo processo de publicação do projeto e regenerar o Prisma Client (`prisma generate`, também executado no postinstall). Não executar migrações antigas pendentes indiscriminadamente.

Após a publicação, validar com usuário autorizado: buscar um cancelado conhecido, conferir a saída original, confirmar uma quantidade parcial e verificar entrada, histórico e saldo. Repetir a mesma chave deve devolver o mesmo retorno. Esse aceite autenticado com pedidos reais ainda está pendente.

## Validação realizada

- Testes de domínio, serviço e APIs: calendário, entradas inválidas, permissão, isolamento, status alterado, saldo parcial/integral e idempotência.
- PostgreSQL nativo descartável: aplicação da migração, grants/RLS, histórico, preservação da saída, rollback forçado, reenvios simultâneos e confirmações concorrentes com chaves diferentes sem ultrapassar o saldo.
- Build de produção, TypeScript e lint dos arquivos alterados.
- Componente real no Chrome headless com autenticação e respostas fictícias: 360, 390, 768, 1280 e 1440px, temas claro/escuro, texto longo, foco, teclado, toque emulado, quantidades inválidas, seleção, revisão, confirmação, leitura sem escrita e recuperação após erro/recarga. Sem overflow horizontal ou erros JavaScript. O espaço da sidebar foi reproduzido no fixture.
- Não equivale a teste em dispositivo físico, auditoria completa de acessibilidade ou validação autenticada do shell/integrador em produção.

A suíte normal roda com `npm test`. O teste de banco é opcional e não usa as URLs da aplicação. Para executá-lo, forneça `RETORNO_OLIST_TEST_DATABASE_URL` apontando para um PostgreSQL **local, vazio e descartável**, com nome iniciado por `retorno_olist_test`, e rode:

```sh
node --import tsx --test tests/retorno-estoque-olist-database.test.ts
```

O teste cria estrutura e dados fictícios e exige privilégios de criação de tabelas/funções e dos roles de teste caso ainda não existam. Descarte o banco após a execução.
