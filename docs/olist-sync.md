# Sincronização multiempresa Olist

O módulo audita contas Olist vinculadas a aplicativos filhos do mesmo pai e mantém um estado compartilhado por grupo. O aplicativo pai administra configuração, autorizações e histórico; não fornece nem recebe cadastros da Olist. A interface fica em `/olist/sincronizacao` e a API em `/api/olist/sincronizacao`.

A entrega prepara código, migration e testes locais. A migration não foi aplicada em produção e nenhuma sincronização real foi executada. Os novos jobs são criados pausados e a configuração inicial permanece desativada.

O [planejamento de desempenho e custos](olist-sync-desempenho-custos.md) revisa as próximas melhorias, incluindo persistência em lote, auditoria incremental e acompanhamento mais leve. As propostas desse planejamento ainda não alteram o comportamento descrito neste guia.

## Grupo inicial

| Aplicativo | Papel |
| --- | --- |
| MV Tecidos, ID terminado em `002` | Administração do grupo |
| MV PRINTS FILIAL, ID terminado em `004` | Participante habilitado na configuração inicial |
| SEU OLHAR, ID terminado em `005` | Participante habilitado na configuração inicial |
| MV PRINTS MATRIZ, ID terminado em `003` | Excluído da sincronização, mesmo sendo filho do pai |
| Meury Shop, ID terminado em `001` | Fora do grupo |

Novos filhos precisam ser selecionados explicitamente. A API, o consumidor e os controles do banco exigem pertencimento ao grupo. Um participante habilitado não pode ser transferido para outro pai. A exclusão da matriz não impede declarar sua origem histórica; essa declaração não autoriza consultar suas credenciais ou sua conta Olist.

### Elegibilidade e participação

O módulo puro `src/lib/olist-sync/elegibilidade.ts` determina se um aplicativo pode participar: deve ser filho direto, distinto do pai e ausente da lista `olist_sync_configuracao.aplicativos_bloqueados`. A seleção efetiva continua em `olist_sync_participante.habilitado`; um filho elegível desabilitado pode ser selecionado, enquanto um filho bloqueado não pode ser habilitado pela tela. O antigo `escopo.ts` foi substituído, e os IDs do piloto ficam apenas nos dados iniciais da migration.

A API relê a política dentro da transação de configuração e antes de aprovar ou vincular cadastros. Aceite, reserva SQL e consumidor consultam a mesma política persistida; o banco recusa inserir ou habilitar participantes bloqueados. A lista não é editável pela API comum de configuração. A MATRIZ permanece bloqueada no seed e disponível para declaração de origem histórica.

Alterações administrativas da política no banco devem ocorrer em transação: bloquear/desabilitar os participantes afetados e incrementar a versão da configuração para exigir nova auditoria. Os gates de execução verificam o bloqueio vigente mesmo sem incremento de versão. Execuções que perderam a elegibilidade são encerradas com pendências após liberação ou expiração das reservas vigentes, sem deixar o grupo preso. O bloqueio não desfaz uma requisição externa já enviada. Atualizações apenas da janela de chamadas continuam permitidas para liberar uma conta em processamento após revogação.

O custo adicional é a pequena lista de UUIDs nas leituras já existentes de configuração e uma releitura transacional dessa política ao salvar. A validação dos IDs selecionados projeta somente ID e pai, com no máximo 20 participantes. Decisões manuais também relêem os participantes com projeção mínima. A recuperação verifica elegibilidade no banco e continua limitada a 20 execuções por lote. Não acrescenta chamadas à Olist, polling ou infraestrutura; bytes e custo financeiro não foram medidos.

Validação após esta alteração: **259 cenários aprovados, nenhum ignorado**. O relatório do Node conta também os agrupadores e mostra 152 testes sem banco + 115 com PostgreSQL local. A cobertura inclui políticas em grupos com UUIDs arbitrários, manutenção do bloqueio da MATRIZ, revogação após reserva e durante `/info`, recuperação após lease e decisões manuais. TypeScript, validação Prisma, lint dos arquivos alterados e build passaram; permanecem os avisos preexistentes do build. Migração e integrações foram exercitadas somente em bancos descartáveis e com Olist simulada.

## Dados e regras de correspondência

| Entidade | Correspondência | Operações |
| --- | --- | --- |
| Produtos | SKU exato, preservando zeros e caixa | Auditoria; criação e atualização de cadastros permitidos pelas políticas |
| Contatos | CPF/CNPJ validado ou equivalência manual dos IDs observados | Auditoria; criação e atualização quando identidade e dependências permitem |
| Formas de pagamento | Equivalência manual dos IDs locais | Auditoria e vínculo; API Olist somente leitura |
| Vendedores | Documento confiável ou equivalência manual dos IDs observados | Auditoria e vínculo; API Olist somente leitura |

Estoque, preços, custos, tributação, pedidos, notas fiscais e transações financeiras não entram no payload de sincronização. Os payloads são reconstruídos por listas explícitas de campos permitidos; respostas completas da Olist nunca são reenviadas como payload.

Nomes semelhantes servem apenas para levantar uma possível duplicidade. A busca usa `pg_trgm`, com limiar de similaridade de 0,85, e normalização auxiliar do SKU para revisão; ela não substitui o SKU como chave. Identidades duplicadas ficam preservadas como observações distintas, sem forçar uma associação incorreta.

Na primeira auditoria, diferenças exigem revisão. Depois de estabelecer uma base comum, alterações unilaterais podem ser propagadas; alterações em campos independentes podem ser combinadas. Divergências concorrentes no mesmo campo continuam bloqueadas. Endereços e estruturas são comparados como conjuntos. Datas remotas não determinam precedência. Exclusões e inativações não são propagadas automaticamente.

## Origem e rastreabilidade

Cada registro lógico guarda a origem separada da última fonte de alteração:

- `DESCONHECIDA`: o módulo não conseguiu atribuir uma origem confiável.
- `OBSERVADA_PELO_MODULO`: a primeira auditoria completa encontrou o registro em apenas um participante. Isso não comprova quem criou o cadastro originalmente no ERP.
- `DECLARADA_POR_USUARIO`: um usuário autorizado informou a origem, com justificativa, versão e evento de auditoria.

Replicar ou escolher um cadastro vencedor não redefine a origem. O aplicativo de origem, o ID remoto original, a justificativa e a última fonte sobrevivem à limpeza de execuções antigas. Declarar uma origem não cria prioridade automática sobre os outros participantes.

## Jobs e autorizações

| `configuracoes_jobs.chave` | Flag em `aplicativo.jobs` do pai |
| --- | --- |
| `agendar-sincronizacao-olist` | `AGENDAR_SINCRONIZACAO_OLIST` |
| `auditar-sincronizacao-olist` | `AUDITAR_SINCRONIZACAO_OLIST` |
| `aplicar-sincronizacao-olist` | `APLICAR_SINCRONIZACAO_OLIST` |
| `limpar-historico-sincronizacao-olist` | `LIMPAR_HISTORICO_SINCRONIZACAO_OLIST` |

A execução exige configuração global existente e não pausada, flag exata no pai, grupo ativo, participantes elegíveis e autorização vigente. Ausência de configuração bloqueia o processamento. Os seeds preservam jobs existentes e acrescentam somente as flags ausentes no pai; não concedem flags aos filhos nem permissões a usuários.

As permissões de usuário são `podeVisualizarSincronizacaoOlist`, `podeExecutarSincronizacaoOlist`, `podeResolverSincronizacaoOlist` e `podeConfigurarSincronizacaoOlist`. Devem ser concedidas a usuários do aplicativo pai conforme suas responsabilidades. A visibilidade do menu complementa a autorização do servidor.

Pausar o scheduler impede novos agendamentos automáticos, mas permite auditorias manuais quando o job de auditoria está liberado. Pausar aplicação impede novas escritas e conclui a execução na próxima fronteira segura, preservando propostas e liberando o grupo para novas auditorias. Respostas já recebidas ainda podem ser persistidas. Retomar uma aplicação exige revalidar dados e autorizações.

Retomar `AUDITAR_E_APLICAR` preserva esse modo e refaz a auditoria completa antes de aplicar; retomar `APLICAR` mantém apenas aplicação/reconciliação. A coleta completa na retomada aumenta chamadas, mas evita tomar decisões com cobertura parcial. Operações inconclusivas são consultadas novamente, sem retornar automaticamente à fila de POST/PUT.

## Processamento durável

Um POST de execução responde HTTP 202 com o ID e a URL de consulta após persistir o trabalho. Aceite não significa sincronização concluída.

O cron autenticado `/api/cron/sincronizacao-olist` executa agendamento, consumo limitado e limpeza. A configuração em `vercel.json` chama esse endpoint a cada minuto; a configuração do grupo define o horário diário, inicialmente 02h em `America/Sao_Paulo`. Dias perdidos são agrupados em uma execução pendente, sem criar uma execução por dia atrasado.

As etapas de listagem, detalhamento, comparação e aplicação usam checkpoints, reservas de até 180 segundos e tentativas limitadas a cinco. A reserva é exclusiva, impede gravação de um consumidor antigo e permite até duas contas simultâneas por grupo, com uma chamada por conta. A auditoria (LISTAR/DETALHAR) usa intervalo mínimo de dois segundos, até 30 leituras/minuto por conta. Com headers válidos, limita-se também a metade da cota anunciada e espaça chamadas conforme o saldo e o reset, reservando 10% da cota. Saldo igual ou inferior à reserva aguarda o reset; 429 aguarda pelo menos 60 segundos e respeita também o reset e Retry-After. Aplicação, leituras protegidas e escritas mantêm seus intervalos anteriores. Outras integrações do sistema não estão abrangidas por esse controle local.

Leituras podem renovar o token uma vez após 401. Escritas não são repetidas cegamente. Timeout, queda do processo ou resposta incerta durante POST/PUT preservam o estado inconclusivo e exigem consulta/reconciliação. O módulo só confirma uma alteração depois de ler o cadastro no destino e comparar os campos esperados.

Na aplicação, as consultas de fonte/destino, a escrita e a confirmação vinculam `/info` e a chamada seguinte à mesma credencial mantida apenas em memória durante a etapa. Essas consultas protegidas não renovam o token entre a validação e o recurso. O consumidor espera seis segundos entre as duas chamadas e revalida autorização e lease; antes de escrever, também confere a revisão e registra o início do envio. Nenhuma espera ou chamada HTTP ocorre dentro da transação de banco.

Na aplicação, a janela da conta reserva 12 segundos para identidade + leitura e 18 segundos para identidade + escrita, mantendo os intervalos de seis segundos após leituras e doze após escritas. A validade das pré-condições é `max(120 segundos, (quantidade de fontes + 2) × 12 segundos)`, até 252 segundos em um grupo de 20 filhos. O destino é verificado por último. A janela cresce com o grupo para comportar as verificações; se expirar, a proposta fica obsoleta. Isso não elimina alterações externas concorrentes entre GET e PUT.

O limite configurável é de 1 a 100 alterações por entidade e destino. Um conjunto acima do limite é bloqueado para revisão. Operações com resultado inconclusivo permanecem protegidas contra uma nova tentativa de criação.

## Limitações deliberadas desta versão

O consumidor executa auditoria completa. O transporte conhece filtros incrementais, mas sua utilização permanece desabilitada até validar a semântica por conta. Marcar a prontidão de incremental não altera essa política do consumidor nesta versão.

Produtos com dependências internas, kits, fabricação, alterações estruturais de variação e imagens que exigem subrecursos são encaminhados para revisão. Há contratos explícitos para imagens e variações no cliente, mas o consumidor não executa esses subrecursos automaticamente. IDs de categoria, marca, embalagem, fornecedor, vendedor e tipos de contato não são copiados entre contas. A liberação dessas dependências exige mapeamento no destino e validação do contrato correspondente.

A aprovação humana escolhe um cadastro observado como fonte. A combinação automática de campos independentes usa a base comum; a interface não oferece edição arbitrária de payloads nem seleção manual campo a campo.

Vincular contatos sem documento resolve a equivalência para comparação. O contrato de criação/atualização continua exigindo CPF/CNPJ válido; o vínculo manual não remove essa exigência nem pendências de referências.

Antes de liberar escritas, um administrador deve confirmar compatibilidade da sincronização nativa Olist e a semântica de omissão de campos no PUT. A sincronização nativa precisa respeitar a exclusão da matriz e os campos protegidos. A API Olist não oferece neste contrato um mecanismo de atualização condicional que elimine a janela entre revalidação e gravação; permanece possível uma alteração externa concorrente nessa janela.

## Implantação

1. Revisar isoladamente `prisma/migrations/20261116000100_olist_sync_multiempresa/migration.sql`. O histórico deste repositório é parcial: seguir `prisma/migrations/README.md` e não executar `prisma migrate deploy` global. A migration cria as nove tabelas, índices e constraints, instala `pg_trgm`, restringe acesso público e adiciona permissões e seeds.
2. Confirmar que o servidor usa uma conexão PostgreSQL autorizada para as tabelas protegidas. As novas tabelas e `integracao_olist_tokens` ficam com RLS habilitado e sem grants a `PUBLIC`, `anon` e `authenticated`; o navegador não deve acessar esses dados diretamente.
3. Configurar os segredos somente no servidor: `OLIST_SYNC_DATA_KEY` e `OLIST_SYNC_HMAC_KEY`, independentes, cada um com 32 bytes em base64; `CRON_SECRET`; e `OLIST_OAUTH_STATE_SECRET` para o contexto OAuth assinado. `.env.example` documenta os nomes. A troca das chaves de dados exige recifrar os dados existentes; a troca de HMAC exige uma estratégia de atualização das identidades e hashes.
4. Aplicar somente a migration revisada no ambiente escolhido, gerar o Prisma Client e publicar a aplicação. A execução desta migration não renova tokens Olist nem executa uma sincronização.
5. Conceder as quatro permissões aos usuários responsáveis no pai. Conferir os participantes e os tokens dos filhos. Não usar o pai como conta de origem ou destino.
6. Liberar primeiro o job de auditoria e ativar o grupo. Executar uma auditoria manual, revisar contagem, identidades, duplicidades e origem. Formas de pagamento e vendedores permanecem somente leitura.
7. Validar prontidão e executar um piloto de escrita com limite reduzido, por exemplo dez alterações, conferindo cadastros no ERP. Somente depois ampliar o limite e liberar agendamento diário. Os controles globais são administrados na tabela `configuracoes_jobs`; esta entrega não cria uma tela de administração global nem concede esse privilégio aos administradores do grupo.

Para interromper a aplicação, pausar `aplicar-sincronizacao-olist`. O histórico e os estados são preservados. Não há reversão automática dos cadastros já confirmados na Olist.

## Retenção e egress

O armazenamento mantém um estado atual por registro e participante, sem duplicar um catálogo por par de empresas nem snapshots diários completos. Observações, propostas e detalhes sensíveis são cifrados com AES-256-GCM; documentos e hashes de comparação usam HMAC. Listagens da interface não incluem payloads cifrados nem documentos em texto aberto; comparações são carregadas sob demanda.

Pendências específicas de uma empresa armazenam `aplicativo_id` como metadado indexado, com FK composta ao participante do mesmo grupo. O filtro por empresa inclui pendências sem registro canônico e continua sendo paginado no banco, sem baixar/decifrar todas as pendências. A migration local ainda não publicada foi atualizada com essa coluna, FK e índice.

Eventos técnicos são retidos por 30 dias; decisões humanas e correções de origem, por 365 dias. Execuções e operações concluídas são elegíveis para limpeza após 90 dias; payloads de operações concluídas, após 30 dias. Pendências abertas, operações inconclusivas, estado atual e proveniência permanecem. A limpeza é limitada em lotes e pode rodar mesmo com a sincronização do grupo desabilitada, desde que o job e a flag de limpeza estejam liberados.

Listagens remotas têm até 100 itens por página; comparações processam até 25 registros por etapa. A interface pagina no servidor, com padrão de 25 e máximo de 100 itens. O polling consulta o resumo apenas durante uma execução ativa e com a página visível. Para K cadastros por conta, uma auditoria completa de produtos/contatos exige aproximadamente `ceil(K / 100)` consultas de listagem e K consultas de detalhe, além das verificações de identidade. O tráfego de detalhes cresce aproximadamente com `K × tamanho médio do detalhe × número de contas`; a aplicação adiciona revalidações e uma leitura posterior por operação. Por exemplo, duas contas com mil detalhes de 4 KB transfeririam cerca de 8 MB apenas nos detalhes de uma auditoria; é um cenário ilustrativo, não uma medição. Não foram medidos bytes de tráfego nem economia monetária em produção. Auditorias completas transferem dados proporcionais ao catálogo de cada conta; ativar o incremental futuramente exige validar cobertura, exclusões e sobreposição temporal antes de estimar redução de tráfego.

## Validação

Os testes usam `node:test` e `tsx`, com domínio puro, cliente HTTP simulado, PostgreSQL local descartável e a página React real em Chrome headless com API simulada. Não utilizam contas Olist reais.

```sh
# Domínio, HTTP, API simulada, OAuth, sessão, validação e navegador
npm run test:olist-sync

# Quatro bancos locais vazios configurados pelas variáveis abaixo
npm run test:olist-sync:database

# Todos os cenários; exige os mesmos bancos e executa os arquivos em série
npm run test:olist-sync:all

./node_modules/.bin/tsc --noEmit
```

Configure as URLs PostgreSQL somente no ambiente local, com usuário autorizado a criar tabelas, roles e a extensão `pg_trgm` nos bancos descartáveis:

| Variável | Banco local sugerido | Cobertura |
| --- | --- | --- |
| `OLIST_SYNC_TEST_DATABASE_URL` | `olist_sync_test` | Repositório, gates, leases e retenção |
| `OLIST_SYNC_API_TEST_DATABASE_URL` | `olist_sync_test_api` | Rotas, decisões e isolamento |
| `OLIST_SYNC_SERVICE_TEST_DATABASE_URL` | `olist_sync_test_service` | Consumidor completo com provedor simulado |
| `OLIST_SYNC_CONCURRENCY_TEST_DATABASE_URL` | `olist_sync_test_concurrency` | Interleavings de transações PostgreSQL reais |

Os comandos `:database` e `:all` falham antes de iniciar se faltar qualquer URL, se o host não for `localhost`/`127.0.0.1`, houver parâmetros adicionais ou dois destinos apontarem para o mesmo banco. As fixtures também exigem banco vazio e criam o baseline mínimo com a migration real. O runner não cria nem remove bancos: recrie apenas esses bancos descartáveis antes de cada execução. Os arquivos são executados em série porque as fixtures também criam roles compartilhadas pelo cluster. Ao executar um arquivo diretamente com `node --import tsx --test`, a ausência de sua variável ainda resulta em `skip` explícito.

O teste de navegador procura Chrome/Chromium instalado ou usa `OLIST_SYNC_TEST_CHROME_PATH`. Exige Node com `fetch`/`WebSocket` globais e permissão para iniciar Chrome headless e sua porta local. Usa perfil temporário, remove-o ao terminar e intercepta todas as chamadas da aplicação. Só é ignorado quando não há navegador instalado; falha ao iniciar não é convertida em sucesso. O `esbuild` foi declarado como dependência de desenvolvimento na mesma versão já usada pelo `tsx`, para o bundle da fixture funcionar também em instalações isoladas do pnpm.

A cobertura de persistência inclui seeds/RLS, exclusão da matriz, bloqueio de reparent, idempotência concorrente, uma execução ativa, limites de conta, lease vencido, pausa sem consumir tentativas, cancelamento em andamento, configuração alterada, escrita inconclusiva e retenção de origem. A cobertura da API exercita isolamento do pai, declaração de origem, versões obsoletas, rejeição de aprovação sem auditoria completa e atomicidade entre decisão e reauditoria.

A interface foi verificada no navegador com dados simulados, em larguras de 389 px e 1279 px, nos temas claro e escuro. Foram exercitados abertura e fechamento dos diálogos, navegação por Tab, contenção do foco, Escape e restauração de foco. Essa verificação cobre o fluxo em viewport emulado; não é teste em dispositivo móvel real nem validação de integração com produção.

### Correções após a revisão de 16/11/2026

- Toda decisão de auditoria invalida propostas não enviadas e avança a revisão, inclusive em conflitos ou equivalência. Reconciliações antigas confirmam o efeito já enviado sem sobrescrever uma decisão posterior.
- A revalidação aceita o snapshot original ou o alvo exato da revisão, permitindo convergência entre três contas e merge sem aceitar um terceiro valor divergente. A última fonte considera somente campos efetivamente alterados; a origem histórica é preservada.
- Locks curtos na ordem execução → etapa serializam checkpoint, cancelamento e encerramento do detalhamento. A recuperação trata pausas/leases vencidas e esgotamento sem manter grupos bloqueados; a escolha de grupo considera a elegibilidade completa.
- Retomada recupera escritas pendentes de confirmação. Ao convergir, fonte e destinos equivalentes ficam sincronizados. Página curta com total maior continua sendo coletada; página vazia inconsistente falha sem afirmar cobertura completa.
- Credenciais vinculadas e guards finais protegem contra troca de conta, revogação, cancelamento, lease vencida e revisão alterada durante `/info`.
- O filtro por empresa inclui identidades ainda não vinculadas; equivalência manual preserva os demais bloqueios. O polling conclui a leitura final antes de atualizar o resumo que controla seu próprio ciclo.

As 19 regressões identificadas anteriormente passaram após as correções, e foram acrescentados 30 cenários de proteção. A rodada dessas correções executou **239 cenários, todos aprovados, sem ignorados**: 139 sem banco e 100 com PostgreSQL local. O relatório nativo do Node inclui agrupadores e mostra 142 + 105 = 247 testes aprovados. TypeScript, Prisma validate, lint das áreas alteradas e build de produção também passaram; o build mantém avisos preexistentes fora deste módulo. O cenário com 20 filhos confirmou a convergência de um destino após revalidar 19 fontes. Chrome verificou o comportamento de conclusão em 390 e 1280 px com API simulada, sem CSS de produção e sem teste em dispositivo real.

A validação usa PostgreSQL descartável e Olist simulada; o build recebeu URLs/credenciais fictícias de banco e Supabase. Não houve migração ou publicação em produção, nem comprovação de aceite em uma conta Olist real.

Impacto operacional: no caminho normal de uma atualização com N participantes, as leituras vinculadas acrescentam duas consultas `/info` por destino em relação à versão original: aproximadamente `2N + 4` chamadas por destino, sem retries. A etapa separada de verificação de contas foi substituída pelas consultas vinculadas. Respostas incertas podem exigir buscas adicionais. As transações e consultas mantêm projeções limitadas; não foi medido faturamento ou redução de bytes. Retomar coleta refaz a auditoria, e a janela de validação maior em grupos grandes mantém o risco residual de edição externa concorrente explicitado acima.

### Ampliação dos testes em 16/11/2026 (histórico antes das correções)

Foram acrescentados **97 cenários**, preservando os existentes. A contagem abaixo considera casos finais, sem contar novamente os testes que apenas agrupam subtestes.

| Execução | Cenários | Passaram | Falharam | Ignorados |
| --- | ---: | ---: | ---: | ---: |
| Domínio, transporte, OAuth, API simulada, UI e runner | 124 | 122 | 2 | 0 |
| PostgreSQL local descartável | 85 | 68 | 17 | 0 |
| Total | **209** | **190** | **19** | **0** |

O relatório nativo do Node inclui os agrupadores: 127 testes/124 passes/3 falhas na primeira execução e 90 testes/68 passes/22 falhas na execução PostgreSQL. São os mesmos resultados, com agrupadores incluídos. TypeScript e lint dos arquivos de teste/runner passaram. Não foi necessário repetir o build da aplicação para esta alteração restrita aos testes e à sua infraestrutura local.

Naquele momento, 19 cenários falharam exigindo o comportamento correto, sem `todo` ou `skip`. Eles reproduziram:

- Proposta antiga aplicada depois de nova duplicidade; convergência interrompida entre três contas e no merge com ordem de aplicação controlada.
- Corrida ao encerrar os últimos detalhamentos e corrida entre cancelamento e checkpoint.
- Quinta lease expirada, pausa/cancelamento após lease vencida, retomada que perde a coleta ou deixa operação sem reconciliação e grupo em espera bloqueando outro grupo.
- Última fonte incorreta, página remota curta tratada como cobertura completa e troca da identidade remota entre as precondições e a escrita.
- Filtro por empresa omitindo pendências sem registro canônico e equivalência manual de contatos mantendo o bloqueio de identidade.
- Polling abortando o detalhe final da execução em 390 e 1280 px. Esses dois testes verificam comportamento em viewports emulados, sem CSS de produção; não constituem validação visual, de acessibilidade ou em dispositivo móvel real.

Os controles positivos cobrem permissões por ação e revogação, isolamento entre grupos, origem preservada, decisões concorrentes, idempotência, rollback, limite de tentativas, paginação de 101 cadastros por conta, quarentena de POST incerto e reconciliação de PUT sem repetição. Há verificações de projeção das consultas e de quantidade de chamadas; não há benchmark nem medição de economia monetária. Todo tráfego de banco desta validação foi local e as chamadas Olist foram simuladas.

Essa primeira ampliação alterou somente testes e sua infraestrutura. A rodada posterior de correções de código/schema está descrita acima; os resultados vermelhos desta seção são históricos.

### Validação da primeira entrega (histórico anterior à ampliação)

Os resultados abaixo registram a cobertura disponível na primeira entrega; não substituem o resultado atual da suíte ampliada acima.

- Build de produção, validação Prisma, TypeScript e lint das áreas alteradas passaram. O lint global mantém avisos preexistentes fora do módulo.
- 80 testes de domínio, transporte HTTP, API simulada, sessão, validação e OAuth passaram.
- 41 testes de integração passaram em PostgreSQL descartável: 13 de persistência, 8 de API e 20 do consumidor, usando Olist simulada.
- O consumidor foi verificado do aceite à confirmação, incluindo POST incerto sem repetição, 429 com backoff, troca de conta, revogação de autorização, perda de lease e confirmação parcial.
- A suíte geral encontrou duas falhas anteriores em testes de kits/estampas e um teste de Blob que não encerra; os três comportamentos foram reproduzidos no HEAD original. Esses módulos não foram alterados.
- Não houve aplicação da migration, publicação da aplicação, consulta de contas Olist ou sincronização em produção. A confirmação funcional no ERP depende do piloto após implantação.


## Ajuste de auditoria para 30 leituras/minuto

A alteração é independente da sincronização incremental e não modifica schema, versão da configuração, identidade, offset, conteúdo observado ou contadores existentes. O consumidor aceita os checkpoints anteriores: estados completos continuam fora da seleção de detalhamento e a listagem não é reiniciada. Uma janela de espera já gravada pela versão anterior continua sendo respeitada.

O transporte captura somente números de `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`, sem chamadas adicionais. Headers ausentes ou inválidos usam o teto local de 30/minuto. A próxima chamada é persistida em `proximaChamadaEm`, compartilhada pelos consumidores deste módulo. A última cota válida é registrada no checkpoint como `cotaLeitura` com instante de observação, preservada ao atualizar o cursor. Ela é uma amostra histórica, não uma garantia de saldo futuro; nunca integra hashes/ciphertext dos cadastros nem substitui autorização. As demais integrações continuam podendo consumir a cota compartilhada. O comportamento é baseado na [documentação oficial de limites](https://api-docs.erp.olist.com/documentacao/comecando/limites-de-consulta).

A mudança mantém a quantidade de leituras necessárias à auditoria completa e seu volume aproximado Olist→servidor, executando-as mais rapidamente. O checkpoint acrescenta uma pequena escrita de metadados por resposta com headers válidos; não há gravação de corpos HTTP ou credenciais. Não foi medido egress faturado ou ganho de duração em produção. Para publicar durante uma auditoria, aguardar o término das invocações antigas antes de liberar o novo consumidor; não alterar a configuração do grupo nem cancelar a execução para essa troca.

Validação local deste ajuste: 157 testes sem banco e 118 testes com PostgreSQL descartável aprovados, sem ignorados (contagem Node inclui agrupadores). Inclui retomada de checkpoint antigo após detalhe persistido, ritmo de dois segundos, preservação da cota no checkpoint, atraso por saldo baixo e 429/Retry-After, além das regressões de autorização, concorrência e escrita incerta. Build, TypeScript e lint passaram; os avisos do build são preexistentes. Nenhuma chamada real à Olist ou publicação foi executada.
