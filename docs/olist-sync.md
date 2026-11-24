# Sincronização multiempresa Olist

O módulo audita contas Olist vinculadas a aplicativos filhos do mesmo pai e mantém um estado compartilhado por grupo. O aplicativo pai administra configuração, autorizações e histórico; não fornece nem recebe cadastros da Olist. A interface fica em `/olist/sincronizacao` e a API em `/api/olist/sincronizacao`.

A entrega prepara código, migration e testes locais. A migration não foi aplicada em produção e nenhuma sincronização real foi executada. Os novos jobs são criados pausados e a configuração inicial permanece desativada.

O [planejamento de desempenho e custos](olist-sync-desempenho-custos.md) distingue a coleta incremental implementada das melhorias ainda propostas, como persistência em lote, instrumentação de banco e acompanhamento mais leve.

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

Validação da alteração de elegibilidade, anterior à entrega incremental: **259 cenários aprovados, nenhum ignorado**. O relatório do Node conta também os agrupadores e mostra 152 testes sem banco + 115 com PostgreSQL local. A cobertura inclui políticas em grupos com UUIDs arbitrários, manutenção do bloqueio da MATRIZ, revogação após reserva e durante `/info`, recuperação após lease e decisões manuais. TypeScript, validação Prisma, lint dos arquivos alterados e build passaram; permanecem os avisos preexistentes do build. Migração e integrações foram exercitadas somente em bancos descartáveis e com Olist simulada.

## Dados e regras de correspondência

| Entidade | Correspondência | Operações |
| --- | --- | --- |
| Produtos | SKU exato, preservando zeros e caixa | Auditoria; criação e atualização de cadastros permitidos pelas políticas |
| Contatos | Documento preenchido normalizado, sem validação fiscal local; quando vazio, nome exato normalizado; equivalência manual dos IDs observados | Auditoria; criação e atualização quando identidade e dependências permitem |
| Formas de pagamento | Equivalência manual dos IDs locais | Auditoria e vínculo; API Olist somente leitura |
| Vendedores | Documento confiável ou equivalência manual dos IDs observados | Auditoria e vínculo; API Olist somente leitura |

Estoque, preços, custos, tributação, pedidos, notas fiscais e transações financeiras não entram no payload de sincronização. Os payloads são reconstruídos por listas explícitas de campos permitidos; respostas completas da Olist nunca são reenviadas como payload.

Nomes semelhantes servem apenas para levantar uma possível duplicidade. A busca usa `pg_trgm`, com limiar de similaridade de 0,85, e normalização auxiliar do SKU para revisão; ela não substitui o SKU como chave. Identidades duplicadas ficam preservadas como observações distintas, sem forçar uma associação incorreta.

Para contatos, documento ausente significa `null`, campo omitido ou texto vazio após remover espaços. Documento preenchido é utilizado sem validar dígitos verificadores, sequências repetidas, quantidade fiscal de dígitos ou compatibilidade com o tipo de pessoa. A aplicação apenas normaliza pontuação/espaços e caixa, preservando letras e zeros, com limite técnico de 32 caracteres na entrada. A Olist decide se aceita o documento no envio; rejeições reais continuam registradas como `OLIST_400`/`OLIST_422`, sem retry cego. A identidade da própria conta (`/info`) e vendedores mantêm a validação anterior, separada da sincronização dos contatos. A identificação alternativa usa `nome:` seguido do nome com normalização Unicode NFKC, espaços consecutivos reduzidos e caixa ignorada; preserva acentos e pontuação. Nomes mascarados com asteriscos, vazios, sem letras ou com caracteres de controle não recebem essa identidade. O nome original continua no cadastro e no payload; nenhum documento é inventado.

A identidade é protegida pelo HMAC do grupo, como o documento. Homônimos na mesma empresa bloqueiam a comparação. Antes de criar ou reconciliar uma escrita incerta, a busca da Olist usa o nome completo no filtro `nome`, limitado a 100 resultados, e exige igualdade normalizada local: nomes parciais não são vínculos. Resultado truncado, documento preenchido/omitido no candidato ou contato excluído impedem a criação automática. Uma identidade por CPF também não cria outro cadastro no destino onde a auditoria já observou o mesmo nome sem documento. Situações ambíguas continuam para revisão, sem mesclar pedidos ou notas.

A versão da identidade entra na assinatura de cobertura de contatos: depois de publicar esta regra, a próxima auditoria exige uma coleta completa antes de reutilizar a base incremental. A identificação resolvida encerra a antiga pendência individual de identificação, inclusive os bloqueios locais por dígitos verificadores; divergências de campos e duplicidades continuam sendo avaliadas separadamente. Contatos excluídos com situação `E`, ou ausência confirmada por 404, encerram a pendência individual e não são recriados. Se restaurados e ainda sem identificação válida, voltam a exigir revisão.

Egress: a busca por nome substitui a busca por documento no destino somente nesses contatos; não varre o catálogo no momento da escrita. Há também uma busca por nome por fonte, depois de reler seu detalhe, para impedir que um homônimo surgido após a auditoria libere uma escrita. O filtro usa o nome completo com espaços normalizados, sem recuar para sobrenome isolado: consultas amplas podem retornar timeout 400 da Olist. Continua limitado a 100 resultados, com bloqueio se truncado e comparação exata local. A verificação somente de leitura na conta afetada confirmou retorno 200 com o nome completo e com espaços repetidos; não foi uma validação exaustiva de todos os formatos de nome. Para propostas por CPF com destino ausente, uma consulta indexada de existência detecta colisão com nome sem documento, projetando somente um ID. A mudança de identidade exige uma coleta completa de contatos uma vez para reavaliar os bloqueios locais antigos; não foram medidos bytes faturados em produção.

Um HTTP 400 ao consultar um cadastro durante aplicação ou confirmação isola apenas a operação afetada como `CONSULTA_OLIST_400` e permite continuar a fila. Antes de enviar, a operação fica obsoleta para revisão; se já houve envio, permanece `RESULTADO_INCONCLUSIVO` e só pode ser confirmado por leitura, sem repetir POST. A origem do erro distingue recurso e identidade da conta (`/info`): falhas de conta, autenticação, autorização, cotas, lease e erros temporários mantêm seus controles anteriores. O corpo da resposta da Olist e os dados pessoais não entram no diagnóstico persistido. O ajuste não cria novas chamadas por contato, não muda a assinatura da coleta e não exige alterar os dados nem o formato dos checkpoints existentes; a fila já autorizada pode ser retomada com `APLICAR` após publicar, sem nova auditoria geral.

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

Retomar `AUDITAR_E_APLICAR` preserva esse modo e refaz a coleta antes de aplicar, mantendo a escolha automática ou completa da solicitação original; retomar `APLICAR` mantém apenas aplicação/reconciliação. Registros afetados de comparações interrompidas são transferidos para a execução seguinte, inclusive os já processados em um lote quando a comparação não terminou. Operações inconclusivas são consultadas novamente, sem retornar automaticamente à fila de POST/PUT.

## Processamento durável

Um POST de execução responde HTTP 202 com o ID e a URL de consulta após persistir o trabalho. Aceite não significa sincronização concluída.

O cron autenticado `/api/cron/sincronizacao-olist` executa agendamento, consumo limitado e limpeza. A configuração em `vercel.json` chama esse endpoint a cada minuto; a configuração do grupo define o horário diário, inicialmente 02h em `America/Sao_Paulo`. Dias perdidos são agrupados em uma execução pendente, sem criar uma execução por dia atrasado.

As etapas de listagem, detalhamento, comparação e aplicação usam checkpoints, reservas de até 180 segundos e tentativas limitadas a cinco. A reserva é exclusiva, impede gravação de um consumidor antigo e permite até duas contas simultâneas por grupo, com uma chamada por conta. A auditoria (LISTAR/DETALHAR) usa intervalo mínimo de dois segundos, até 30 leituras/minuto por conta. Com headers válidos, limita-se também a metade da cota anunciada e espaça chamadas conforme o saldo e o reset, reservando 10% da cota. Saldo igual ou inferior à reserva aguarda o reset; 429 aguarda pelo menos 60 segundos e respeita também o reset e Retry-After. Aplicação, leituras protegidas e escritas mantêm seus intervalos anteriores. Outras integrações do sistema não estão abrangidas por esse controle local.

Leituras podem renovar o token uma vez após 401. Escritas não são repetidas cegamente. Timeout, queda do processo ou resposta incerta durante POST/PUT preservam o estado inconclusivo e exigem consulta/reconciliação. O módulo só confirma uma alteração depois de ler o cadastro no destino e comparar os campos esperados.

Na aplicação, as consultas de fonte/destino, a escrita e a confirmação vinculam `/info` e a chamada seguinte à mesma credencial mantida apenas em memória durante a etapa. Essas consultas protegidas não renovam o token entre a validação e o recurso. O consumidor espera seis segundos entre as duas chamadas e revalida autorização e lease; antes de escrever, também confere a revisão e registra o início do envio. Nenhuma espera ou chamada HTTP ocorre dentro da transação de banco.

Na aplicação, a janela da conta reserva 12 segundos para identidade + leitura e 18 segundos para identidade + escrita, mantendo os intervalos de seis segundos após leituras e doze após escritas. A validade das pré-condições é `max(120 segundos, (quantidade de fontes + 2) × 12 segundos)`, até 252 segundos em um grupo de 20 filhos. O destino é verificado por último. A janela cresce com o grupo para comportar as verificações; se expirar, a proposta fica obsoleta. Isso não elimina alterações externas concorrentes entre GET e PUT.

O limite configurável é de 1 a 100 tentativas de escrita por lote, entidade e destino. O consumidor continua na mesma execução após um intervalo mínimo de um minuto entre lotes, sem nova coleta nem aprovação por volume. Operações com resultado inconclusivo permanecem protegidas contra uma nova tentativa de criação.

## Coleta automática e cobertura incremental

A primeira coleta de cada conta/entidade é completa. Nas seguintes, o modo automático usa incremental somente para produtos e contatos com validação vigente vinculada à identidade da conta, ao fuso interpretado pela API e à versão do contrato. O sinal global antigo `prontidao.incrementalValidado` não autoriza incremental por si só. Sem essa validação, a coleta continua completa; formas de pagamento e vendedores mantêm coleta completa.

A estratégia é escolhida por conta e entidade e persistida no checkpoint. Uma execução pode combinar participantes completos e incrementais. A coleta completa é forçada quando solicitada manualmente, quando faltar baseline compatível, quando mudar o conjunto de participantes ou o contrato, ou após **15 dias** desde a última completa bem-sucedida. Alterações de horário ou limite de escrita não mudam o significado dos snapshots.

O incremental consulta desde o watermark confirmado com **24 horas de sobreposição**. O watermark avança no máximo até o início daquela coleta e somente após concluir a cobertura e a comparação na transação de fechamento. Não avança por página nem após coleta incompleta, cancelamento ou falha. Paginação sem total, total inconsistente, página vazia prematura e IDs repetidos impedem certificar a cobertura. Retomadas reutilizam checkpoints e não presumem que uma resposta parcial cobriu a janela.

Os resumos atualizam presença na listagem e necessidade de detalhe. O último conteúdo completo continua armazenado até receber outro detalhe válido. O fingerprint considera conteúdo e condições relevantes para a decisão; mudar somente a data remota não recifra um snapshot idêntico. A fila `olist_sync_afetado` mantém os registros que precisam de comparação, incluindo chaves anterior/nova, duplicidades e trabalho interrompido. Comparações usam lotes de até 25 registros afetados e suas réplicas completas. Uma execução sem alterações não incrementa revisões nem lê os payloads de todo o catálogo para comparar.

Não aparecer no delta significa apenas não ter sido retornado naquela janela. O snapshot anterior permanece disponível; isso não autoriza considerar o registro removido. Na completa, ausência de uma observação anterior exige consulta de detalhe: somente um 404 confirma a ausência. Entidades sem detalhe individual mantêm pendência de ausência não confirmada. Exclusões e inativações continuam sem propagação automática. A origem histórica não é inferida a partir de uma janela incremental.

O intervalo de 15 dias reduz varreduras, mas ausências sem sinal incremental confiável podem levar esse prazo, mais atrasos/falhas, para ser detectadas. Se um campo relevante não for coberto pelo filtro validado, manter a conta/entidade em coleta completa. A sobreposição não corrige um contrato que omita alterações; o operador precisa validar fuso, precisão, limites inclusivos, paginação e cobertura de campos/subrecursos antes de liberar o incremental. A interface apresenta a última completa, a última incremental e o watermark separadamente.

Uma completa anterior à migration incremental pode ser adotada como baseline somente quando suas etapas, participantes, versão e snapshots ainda comprovam a coleta, sem processamento posterior incompatível. Observações antigas ou incompletas impedem a adoção daquela conta. Essa compatibilidade não concede validação do filtro: o certificado por conta/entidade continua necessário.

Conflitos nascidos em um delta podem ser aprovados usando as réplicas completas preservadas, desde que a cobertura certificada e os fingerprints observados continuem válidos. Mudança de conteúdo, presença ou fingerprint após a comparação exige nova auditoria. Pendências antigas sem essa prova continuam exigindo auditoria completa íntegra.

## Limitações deliberadas desta versão

Produtos com dependências internas, kits, fabricação, alterações estruturais de variação e imagens que exigem subrecursos são encaminhados para revisão. Há contratos explícitos para imagens e variações no cliente, mas o consumidor não executa esses subrecursos automaticamente. IDs de categoria, marca, embalagem, fornecedor, vendedor e tipos de contato não são copiados entre contas. A liberação dessas dependências exige mapeamento no destino e validação do contrato correspondente.

A aprovação humana escolhe um cadastro observado como fonte. A combinação automática de campos independentes usa a base comum; a interface não oferece edição arbitrária de payloads nem seleção manual campo a campo.

Vincular contatos sem documento resolve a equivalência para comparação. O contrato de criação/atualização continua exigindo CPF/CNPJ válido; o vínculo manual não remove essa exigência nem pendências de referências.

Antes de liberar escritas, um administrador deve confirmar compatibilidade da sincronização nativa Olist e a semântica de omissão de campos no PUT. A sincronização nativa precisa respeitar a exclusão da matriz e os campos protegidos. A API Olist não oferece neste contrato um mecanismo de atualização condicional que elimine a janela entre revalidação e gravação; permanece possível uma alteração externa concorrente nessa janela.

## Implantação

1. Revisar isoladamente `prisma/migrations/20261116000100_olist_sync_multiempresa/migration.sql` e `prisma/migrations/20261117000100_olist_sync_incremental/migration.sql`, nesta ordem. O histórico deste repositório é parcial: seguir `prisma/migrations/README.md` e não executar `prisma migrate deploy` global. A primeira cria as nove tabelas originais, índices e constraints, instala `pg_trgm`, restringe acesso público e adiciona permissões e seeds. A segunda adiciona cobertura por conta/entidade, fila de registros afetados e os metadados de observação necessários ao incremental, sem marcar validações como aprovadas.
2. Confirmar que o servidor usa uma conexão PostgreSQL autorizada para as tabelas protegidas. As novas tabelas e `integracao_olist_tokens` ficam com RLS habilitado e sem grants a `PUBLIC`, `anon` e `authenticated`; o navegador não deve acessar esses dados diretamente.
3. Configurar os segredos somente no servidor: `OLIST_SYNC_DATA_KEY` e `OLIST_SYNC_HMAC_KEY`, independentes, cada um com 32 bytes em base64; `CRON_SECRET`; e `OLIST_OAUTH_STATE_SECRET` para o contexto OAuth assinado. `.env.example` documenta os nomes. A troca das chaves de dados exige recifrar os dados existentes; a troca de HMAC exige uma estratégia de atualização das identidades e hashes.
4. Aplicar somente as migrations revisadas e ainda pendentes no ambiente escolhido, gerar o Prisma Client e publicar a aplicação. Essas migrations não renovam tokens Olist nem executam uma sincronização.
5. Conceder as quatro permissões aos usuários responsáveis no pai. Conferir os participantes e os tokens dos filhos. Não usar o pai como conta de origem ou destino.
6. Liberar primeiro o job de auditoria e ativar o grupo. Executar uma auditoria manual, revisar contagem, identidades, duplicidades e origem. Formas de pagamento e vendedores permanecem somente leitura.
7. Validar prontidão e executar um piloto de escrita com limite reduzido, por exemplo dez alterações, conferindo cadastros no ERP. Somente depois ampliar o limite e liberar agendamento diário. Os controles globais são administrados na tabela `configuracoes_jobs`; esta entrega não cria uma tela de administração global nem concede esse privilégio aos administradores do grupo.
8. Após confirmar o contrato de filtro de cada conta/entidade, registrar sua validação e fuso na configuração. Conferir uma execução automática sem alterações e outra com alteração conhecida contra a auditoria completa. Não habilitar a validação apenas porque a API aceita o parâmetro de data.

Para interromper a aplicação, pausar `aplicar-sincronizacao-olist`. O histórico e os estados são preservados. Não há reversão automática dos cadastros já confirmados na Olist.

## Retenção e egress

O armazenamento mantém um estado atual por registro e participante, sem duplicar um catálogo por par de empresas nem snapshots diários completos. Observações, propostas e detalhes sensíveis são cifrados com AES-256-GCM; documentos e hashes de comparação usam HMAC. Listagens da interface não incluem payloads cifrados nem documentos em texto aberto; comparações são carregadas sob demanda.

Pendências específicas de uma empresa armazenam `aplicativo_id` como metadado indexado, com FK composta ao participante do mesmo grupo. O filtro por empresa inclui pendências sem registro canônico e continua sendo paginado no banco, sem baixar/decifrar todas as pendências. A migration local ainda não publicada foi atualizada com essa coluna, FK e índice.

Eventos técnicos são retidos por 30 dias; decisões humanas e correções de origem, por 365 dias. Execuções e operações concluídas são elegíveis para limpeza após 90 dias; payloads de operações concluídas, após 30 dias. Pendências abertas, operações inconclusivas, estado atual e proveniência permanecem. A limpeza é limitada em lotes e pode rodar mesmo com a sincronização do grupo desabilitada, desde que o job e a flag de limpeza estejam liberados.

Listagens remotas têm até 100 itens por página; comparações processam até 25 registros afetados por etapa. A interface pagina no servidor, com padrão de 25 e máximo de 100 itens. O polling consulta o resumo apenas durante uma execução ativa e com a página visível. Para K cadastros por conta, uma auditoria completa de produtos/contatos exige aproximadamente `ceil(K / 100)` consultas de listagem e K consultas de detalhe, além das verificações de identidade e confirmações de ausência. No incremental, esse trabalho acompanha os itens efetivamente retornados na janela, incluindo a sobreposição; um delta vazio exige identidade e primeira página por conta. A aplicação mantém revalidações e leitura posterior por operação.

O teste local com duas contas e 100 produtos em cada observou 4 GETs no delta vazio, 6 com um produto alterado por conta e 204 com todos alterados. Os corpos JSON simulados somaram respectivamente 236, 870 e 64.998 bytes. Isso mede Olist → servidor em uma fixture, sem headers/compressão, não egress do banco nem custo faturado. Detalhes e metodologia estão no [documento de desempenho](olist-sync-desempenho-custos.md). Ainda não foram medidos bytes de rede, CPU, WAL ou economia monetária em produção; persistência em lote e projeções menores dos detalhes seguem oportunidades separadas.

## Validação

Os testes usam `node:test` e `tsx`, com domínio puro, cliente HTTP simulado, PostgreSQL local descartável e a página React real em Chrome headless com API simulada. Não utilizam contas Olist reais.

```sh
# Domínio, HTTP, API simulada, OAuth, sessão, validação e navegador
npm run test:olist-sync

# Cinco bancos locais vazios configurados pelas variáveis abaixo
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
| `OLIST_SYNC_INCREMENTAL_TEST_DATABASE_URL` | `olist_sync_test_incremental` | Cobertura incremental, retomada, aprovação manual e custo de coleta |

Os comandos `:database` e `:all` falham antes de iniciar se faltar qualquer URL, se o host não for `localhost`/`127.0.0.1`, houver parâmetros adicionais ou dois destinos apontarem para o mesmo banco. As fixtures também exigem banco vazio e criam o baseline mínimo com as duas migrations reais, pela lista explícita de `tests/fixtures/olist-sync-migrations.ts`. O runner não cria nem remove bancos: recrie apenas esses bancos descartáveis antes de cada execução. Os arquivos são executados em série porque as fixtures também criam roles compartilhadas pelo cluster. Ao executar um arquivo diretamente com `node --import tsx --test`, a ausência de sua variável ainda resulta em `skip` explícito.

O teste de navegador procura Chrome/Chromium instalado ou usa `OLIST_SYNC_TEST_CHROME_PATH`. Exige Node com `fetch`/`WebSocket` globais e permissão para iniciar Chrome headless e sua porta local. Usa perfil temporário, remove-o ao terminar e intercepta todas as chamadas da aplicação. Só é ignorado quando não há navegador instalado; falha ao iniciar não é convertida em sucesso. O `esbuild` foi declarado como dependência de desenvolvimento na mesma versão já usada pelo `tsx`, para o bundle da fixture funcionar também em instalações isoladas do pnpm.

A cobertura de persistência inclui seeds/RLS, exclusão da matriz, bloqueio de reparent, idempotência concorrente, uma execução ativa, limites de conta, lease vencido, pausa sem consumir tentativas, cancelamento em andamento, configuração alterada, escrita inconclusiva e retenção de origem. A cobertura da API exercita isolamento do pai, declaração de origem, versões obsoletas, rejeição de aprovação sem cobertura suficiente e atomicidade entre decisão e reauditoria.

A suíte incremental acrescenta 32 cenários integrados, aprovados em PostgreSQL local com Olist simulada: baseline/delta vazio, conflitos, preservação de snapshots, identidade/situação/duplicidade, registros sem chave, ausência confirmada por 404, marcos temporais, fallback por conta, adoção legada conservadora, aprovação manual, falhas de paginação, recuperação de detalhes antigos, cancelamento, comparação parcialmente concluída, replanejamento de propostas e isolamento das novas tabelas. A execução final isolada dessa suíte apresentou 33 testes aprovados no relatório do Node, que inclui o agrupador, sem ignorados. A verificação final completa apresentou **172 testes sem banco e 148 com PostgreSQL nos cinco bancos locais**, sem falhas ou ignorados (o relatório do Node inclui agrupadores). Build, TypeScript, validação Prisma e lint dos arquivos alterados passaram. Os cinco testes de navegador usaram Chrome isolado, backend simulado, larguras de 390 e 1280 pixels e temas claro/escuro; isso não equivale a teste em dispositivo físico. O build mantém apenas os avisos preexistentes fora deste módulo. Isso não comprova o contrato dos filtros nas contas reais; a validação operacional permanece obrigatória.

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


## Previsão manual do término da leitura

O card da execução mostra a data/hora prevista em `America/Sao_Paulo`, a taxa de validações e o horário do cálculo. `GET /api/olist/sincronizacao/previsao` é chamado somente ao carregar a página e pelo botão Atualizar. Troca de aba, paginação, abertura de detalhes, polling e conclusão da execução não fazem essa consulta. O endpoint preserva a autorização do aplicativo pai e responde com `private, no-store`.

O ritmo é a quantidade de observações completas da execução nos últimos 30 minutos dividida pelo tempo da janela; para execuções novas, a janela começa no início da execução. Restante = listados − analisados. A previsão cobre o fim da leitura completa, sem prometer o horário final de comparação, aplicação ou resolução humana. Listagem incompleta, pausa, ausência de progresso ou amostra menor que cinco validações/um minuto exibem uma explicação em vez de uma data.

Aplicar `prisma/migrations/20261117000200_olist_sync_previsao/migration.sql` antes de publicar. Ela acrescenta somente um índice parcial sobre grupo, execução e horário, para observações completas. A consulta parametrizada retorna uma linha agregada, sem transferir payloads ou carregar o catálogo no servidor; usa UTC explícito nos parâmetros e funciona também em sessões PostgreSQL com fuso de São Paulo. Não exige nova tabela, histórico, job ou gravação de amostras, e aproveita timestamps já existentes da execução em andamento. O índice acrescenta manutenção às gravações das observações completas.

Validação local: 172 testes sem banco e 121 com PostgreSQL descartável aprovados, sem ignorados (incluem agrupadores). O plano usou o índice sem varredura sequencial em 50.060 observações; a agregação levou entre 0,01 e 0,03ms no banco local aquecido, sem medir latência total da API ou custos de produção. Chrome verificou 390/1280px nos temas claro/escuro com CSS da aplicação, sem overflow e sem consultas da previsão no polling. Viewport emulado não representa teste em dispositivo real. Build, TypeScript, lint e validação Prisma passaram. Nenhuma migration ou publicação em produção foi executada nesta validação.

Na revisão de desempenho de 17/11/2026, a previsão passou a ler somente ID, ativação e flags do pai na configuração, sem participantes, políticas ou prontidão. A contagem também é dispensada quando a leitura terminou ou a execução tem menos de um minuto, além dos casos já tratados de pausa/listagem. A verificação de autorização permanece compartilhada com as demais rotas. Não foram acrescentados cache, amostras, jobs, chamadas à Olist ou gravações de progresso; a redução de egress vem da projeção menor e das contagens evitadas, sem estimativa de economia monetária.

A inspeção somente de leitura confirmou que a migration do índice já estava aplicada em produção, com índice válido de 434.176 bytes (424 KiB). Uma consulta equivalente na execução em andamento usou `Index Only Scan` para 280 observações, com 132 verificações de visibilidade no heap, 3,466ms de execução e 29,153ms de planejamento. É uma amostra do banco, sem latência de rede, autenticação ou função, e não uma garantia de duração futura. Nenhuma configuração ou dado de produção foi alterado. O teste local também passou a verificar o plano com registros recém-gravados, antes de `VACUUM`. Regressões da revisão: 174 testes sem banco e 23 testes da API com PostgreSQL aprovados, sem ignorados. O polling existente do resumo continua independente da previsão; ele ainda agrega estados a cada dez segundos durante a execução e merece avaliação separada se aumentar a quantidade de usuários simultâneos.

## Ajuste de auditoria para 30 leituras/minuto

O controle de ritmo foi integrado à coleta completa e à incremental. Ele não modifica a janela congelada, offset, geração de cobertura, conteúdo observado ou contadores. O checkpoint mantém simultaneamente `plano`, `offset`, `total` e `cotaLeitura`, inclusive na transição LISTAR→DETALHAR e em retries. Uma janela de espera já gravada pela versão anterior continua sendo respeitada. A versão combinada exige a migration incremental: checkpoints anteriores à existência do plano de coleta ainda seguem o fallback conservador de reiniciar a coleta daquela conta; esta integração não introduz transição transparente de uma auditoria legada em andamento.

O transporte captura somente números de `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`, sem chamadas adicionais. Headers ausentes ou inválidos usam o teto local de 30/minuto. A próxima chamada é persistida em `proximaChamadaEm`, compartilhada pelos consumidores deste módulo. A última cota válida é registrada no checkpoint como `cotaLeitura` com instante de observação, preservada ao atualizar o cursor. Ela é uma amostra histórica, não uma garantia de saldo futuro; nunca integra hashes/ciphertext dos cadastros nem substitui autorização. As demais integrações continuam podendo consumir a cota compartilhada. O comportamento é baseado na [documentação oficial de limites](https://api-docs.erp.olist.com/documentacao/comecando/limites-de-consulta).

Com saldo disponível, a cadência é contada desde o início da chamada de auditoria, incluindo seu preparo e transporte: a latência deixa de se somar a mais dois segundos de espera após cada resposta. A conta continua serializada, sem sobrepor chamadas nem recuperar atraso em rajadas. O teto permanece em 30/minuto e até metade do limite anunciado. Saldo baixo, reserva de 10%, reset e 429 continuam impondo espera após a resposta; `Retry-After` também é contado após a resposta. Naquela entrega, leituras de confirmação e escritas mantiveram seus intervalos anteriores; a revisão de aplicação abaixo substitui essa política. Apenas a execução em produção pode confirmar a vazão efetiva, pois banco, autenticação, consumidor e latência ainda a limitam.

A mudança mantém a quantidade de leituras necessárias à auditoria completa e seu volume aproximado Olist→servidor, executando-as mais rapidamente. O checkpoint acrescenta uma pequena escrita de metadados por resposta com headers válidos; não há gravação de corpos HTTP ou credenciais. Não foi medido egress faturado ou ganho de duração em produção. Para publicar esta versão combinada, aguardar o encerramento da auditoria legada e das invocações antigas, aplicar a migration incremental isoladamente e então liberar o novo consumidor. Não alterar a configuração do grupo nem cancelar a execução apenas para essa troca.

Validação local anterior do ajuste isolado de ritmo: 157 testes sem banco e 118 testes com PostgreSQL descartável aprovados, sem ignorados (contagem Node inclui agrupadores). Na versão isolada, incluiu retomada de checkpoint antigo após detalhe persistido, ritmo de dois segundos, preservação da cota no checkpoint, atraso por saldo baixo e 429/Retry-After, além das regressões de autorização, concorrência e escrita incerta. Build, TypeScript e lint passaram; os avisos do build são preexistentes. Nenhuma chamada real à Olist ou publicação foi executada.


### Integração do stash incremental com o ritmo de leitura

O conflito no consumidor foi resolvido combinando os imports e o checkpoint de paginação. Completa e incremental usam o mesmo limite adaptativo; `cotaLeitura` nunca apaga `plano`, `offset` ou `total`. GET de ausência confirmada e GET de detalhe compartilham a proteção de conta, lease e ritmo. O controle de cota não avança o watermark nem altera a assinatura do conteúdo.

Validação da versão combinada: **177 testes sem banco e 155 com PostgreSQL descartável aprovados, sem ignorados**, incluindo quatro novas regressões de delta vazio, alterações a 30/minuto, paginação com headers e recuperação de 429 sem mudar a janela. Outros 38 testes de fila/cancelamento passaram. Build, TypeScript, lint e validação Prisma passaram; permanecem apenas avisos preexistentes do build. O stash original foi mantido como cópia e nenhuma configuração ou banco de produção foi alterado.

### Recuperação do stash em 18/11/2026

O stash incremental foi reaplicado preservando a previsão manual, suas consultas reduzidas, o índice existente e a cadência entre inícios das leituras. Foram combinados os testes e o helper de migrations, mantendo a sincronização incremental e o cancelamento da fila que já faziam parte do stash. Os dois stashes originais continuam disponíveis como cópia de segurança.

Validação final da recuperação: 196 testes sem banco, 158 com PostgreSQL descartável e 18 de fila/cancelamento aprovados, sem ignorados (contagens incluem agrupadores). Build, TypeScript, lint e validação Prisma passaram. Nenhuma migration, deploy ou sincronização real foi executada. A migration incremental ainda precisa ser implantada antes de publicar essa versão; recuperar o stash não implementa o mapeamento de tipos de contato nem resolve automaticamente `REFERENCIA_TIPOS_CONTATO`.

A revisão posterior da cadência isolada passou em 161 testes sem banco e 120 com PostgreSQL descartável, sem ignorados (contagens incluem agrupadores), além de build, TypeScript e lint das áreas alteradas. As regressões incluem respostas simuladas de 1,5s e 3,5s, retomada sem relistar ou baixar novamente detalhes completos e preservação dos contadores, dos bloqueios por cota e das janelas de aplicação. Com resposta de 1,5s e cota disponível, o intervalo simulado entre inícios caiu de 3,5s para 2s. Não houve medição de vazão nem publicação em produção nesta validação.

### Correções de mapeamento após a auditoria de contatos (18/11/2026)

A leitura dos resultados no Supabase identificou 15.796 pendências `REFERENCIA_TIPOS_CONTATO`, 1.365 de identificação, 13 de duplicidade e uma divergência inicial de celular. Esses totais descrevem o diagnóstico, não uma quantidade já corrigida em produção. Uma execução completa anterior terminou com 17.222 detalhes analisados; uma coleta posterior cancelada substituiu 16.188 snapshots por resumos na versão antiga. Os IDs e nomes dos tipos também não eram preservados no contrato anterior. Não é possível reconstruir essas informações com segurança apenas retirando o bloqueio.

O consumidor passa a consultar `GET /contatos/tipos` por conta, em páginas de até 100, com checkpoint e limite de 1.000 tipos. A observação detalhada resolve os IDs locais em uma representação canônica de **nome e perfil**. A escrita traduz essa representação para IDs do destino em `tipos: number[]`; nunca copia um ID da origem para outra conta. Nome/perfil ausentes ou ambíguos, referências incompatíveis e paginação inconsistente continuam bloqueados. Não são criados tipos de contato automaticamente.

As consultas de catálogo usam os controles existentes de cota, `Retry-After`, credencial vinculada à identidade da conta e revalidação das permissões. Durante a aplicação, o catálogo é compartilhado entre operações da etapa, com validade de 15 minutos, identidade da conta na chave e persistência no checkpoint. Leituras de confirmação e reconciliação usam a mesma tradução semântica. Propostas anteriores ao novo contrato de contato exigem reauditoria; operações de resultado incerto continuam sendo verificadas sem reenviar POST/PUT.

Telefones brasileiros reconhecíveis são comparados sem pontuação e sem o prefixo `55`; números diferentes, ramais, listas, prefixos de outros países e zeros significativos são conservados. Não há escolha automática por nome parecido, nem associação arbitrária de documentos duplicados. A validade fiscal do documento de contatos é decidida pela Olist. Pendências técnicas de tipos são encerradas quando uma comparação válida produz a proposta correspondente; conflitos reais permanecem protegidos.

**Limite de aplicação:** o campo `limiteAlteracoes` mantém o nome e o intervalo 1–100, mas passa a limitar o lote por entidade e destino. O contador fica no checkpoint e é incrementado na mesma transação que registra o envio; não se conta novamente o catálogo de operações em cada fase. O próximo lote é disponibilizado após cinco segundos, respeitando também as janelas da conta e os headers. A execução permanece ativa, impedindo concorrência com a agenda diária. O consumidor continua apenas nas invocações do cron já existente, sem timers em memória nem nova execução/coleta. Três confirmações consecutivas com diferenças reais pausam a etapa daquele destino, registrando `APLICACAO_REQUER_DIAGNOSTICO`; não se amplia uma falha sistemática para todo o catálogo. Uma confirmação válida zera essa sequência. Cancelamento, permissões, contrato e troca de conta continuam verificados.

**Reaproveitar a fila existente:** após publicar, `Visão geral → Processar fila existente` enfileira `APLICAR`, sem `LISTAR`, `DETALHAR` ou `COMPARAR` o catálogo. O consumidor primeiro consulta operações já enviadas, preserva IDs remotos e resolve suas pendências somente após confirmar o efeito. Propostas sem envio continuam revalidando fonte, destino, identidade da conta, revisão e autorização antes de escrever. A aplicação não resolve automaticamente rejeições da Olist, duplicidades ou conflitos reais. Não é necessário resetar a base nem aplicar migration para essa correção.

**Comparação do endereço de cobrança:** foi observado por GET que a Olist retorna cobrança ausente como objeto com todos os componentes vazios e `pais: "Brasil"`. Hashes e comparação tratam essa representação como equivalente a `null`, preservando o snapshot recebido. Qualquer componente preenchido ou país estrangeiro permanece significativo; não se ignora um endereço de cobrança real. Datas de criação/atualização não participam dessa equivalência.

**Resumo da interface:** os contadores legados da API continuam disponíveis. O novo campo `fila` agrega operações por destino (aguardando aplicação, em aplicação, aguardando confirmação, falhas e propostas). `revisaoNecessaria` separa pendências de decisão dos envios aguardando apuração. Os cards distinguem essas unidades das observações por empresa; "divergentes" deixa de parecer uma lista de milhares de aprovações. As consultas devolvem apenas totais agrupados, sem payloads, IDs de contatos ou novas consultas individuais; o polling mantém os intervalos existentes e a previsão segue restrita ao carregamento/Atualizar.

**Egress e custo:** não há consulta de catálogo por contato nem infraestrutura nova. Cada catálogo demanda `ceil(tipos/100)` páginas, além das leituras de identidade protegidas; a aplicação reaproveita as páginas dentro da validade. O checkpoint aumenta proporcionalmente ao tamanho do catálogo e é relido pelo consumidor, portanto há acréscimo de tráfego banco→servidor: a limitação de tipos impede crescimento ilimitado, mas isso não representa economia monetária medida. A API pública continua projetando somente os dados públicos do plano, sem devolver o catálogo/cursor ao navegador. Nos testes, 105 tipos e cinco contatos usam somente duas páginas de catálogo para a conta durante a coleta. Em duas auditorias mais uma aplicação, com um tipo por conta, foram seis consultas de catálogo, com IDs diferentes entre origem e destino.

**Implantação:** esta correção não adiciona migration própria. A migration incremental já recuperada ainda precisa existir no ambiente antes de publicar o conjunto. Publique o consumidor atualizado e faça uma execução automática de contatos (seleção de coleta automática), ou force completa; a assinatura da projeção de contatos foi alterada, então uma base antiga força nova coleta completa somente para contatos. Produtos mantêm sua assinatura. A antiga completa de contatos não é adotada como prova do novo contrato. Após coleta/comparação íntegras, o incremental pode ser usado onde o filtro da conta estiver validado. Jobs, prontidão para escrita e autorização do pai continuam obrigatórios. Nenhuma migration, deploy, coleta ou escrita Olist real foi executada nesta revisão.

Contratos consultados: [obter contato](https://api-docs.erp.olist.com/api-reference/contatos/obter-contato), [listar tipos](https://api-docs.erp.olist.com/api-reference/contatos/listar-tipos-de-contatos), [criar contato](https://api-docs.erp.olist.com/api-reference/contatos/criar-contato) e [atualizar contato](https://api-docs.erp.olist.com/api-reference/contatos/atualizar-contato).

Validação local desta revisão: 207 testes sem banco aprovados, incluindo navegador com backend simulado em 390 e 1280px e ambos os temas. A suíte completa de PostgreSQL descartável passou com 168 testes; após acrescentar a regressão para propostas legadas bloqueadas por volume, a suíte do consumidor foi novamente aprovada com 69 testes. Contagens incluem agrupadores e não devem ser somadas entre execuções. Build final, TypeScript, lint dos arquivos alterados e `git diff --check` passaram. O build mantém avisos preexistentes fora do escopo. Os testes verificam o contrato com respostas Olist simuladas; não comprovam a equivalência dos catálogos atualmente cadastrados nas contas reais nem a implantação em produção.

### Aplicação da migration incremental em produção (18/11/2026)

A migration `20261117000100_olist_sync_incremental` foi aplicada isoladamente no Supabase e registrada no histórico Prisma com o mesmo SHA-256 do arquivo (`a17928c919b9262668a0146880b2d8f95fb808a75695f668cde2485e879591ab`). Foram verificados cinco novos campos de estado, quatro índices, duas tabelas com RLS e sem leitura por `anon`/`authenticated`, e o trigger de isolamento da fila. Os 17.222 estados existentes e os 1.034 detalhes completos foram preservados. Não havia execução ativa e nenhuma coleta ou escrita Olist foi iniciada nesta operação.

### Contrato real de perfil de contato (18/11/2026)

A execução `c7547f6d-212d-49af-8e79-30155f5aabde` encerrou a listagem com `CONTRATO`, antes de coletar contatos. O diagnóstico limitado e somente de leitura confirmou quatro tipos em cada conta participante, com `perfilContato` serializado como string numérica (`"0"`, `"1"`, `"2"`, `"4"`). O exemplo da documentação usa números, mas o schema descreve um enum textual. O parser agora aceita os perfis documentados 0–5 tanto numéricos quanto textuais canônicos, normalizando-os para números internamente. Valores vazios, booleanos, nulos, frações e perfis desconhecidos continuam recusados; não foi adotada coerção genérica. A correção não muda a assinatura semântica, não exige migration e não remove observações existentes.

Regressões: 58 testes de domínio/cliente e 70 do consumidor com PostgreSQL local aprovados, incluindo catálogo textual nas duas contas, tradução para ID do destino e confirmação da escrita simulada. TypeScript, lint e build no ambiente pnpm isolado passaram. Nenhuma escrita Olist foi feita no diagnóstico. Após publicar a correção, o operador pode usar **Retomar trabalho pendente**; a coleta não depende de apagar a base.

## Continuação automática da fila e confirmação de contatos — 19/11/2026

A continuação descrita acima substitui o antigo orçamento por execução. Para a fila já autorizada, publique esta versão e use **Visão geral → Processar fila existente** uma vez. A ação inicia `APLICAR`, reconcilia primeiro os envios anteriores e continua os lotes na mesma execução, sem repetir a auditoria completa ou reinicializar a base. A reconciliação só confirma depois da leitura remota; esta revisão não marca operações inconclusivas como confirmadas no banco de produção.

Validação desta entrega: **217 testes sem banco** (incluindo Chrome com backend simulado) e **176 testes em PostgreSQL local descartável**, sem falhas ou ignorados; contagens incluem agrupadores. Foram exercitados retomada por ID sem POST, endereço de cobrança padrão, diferença real preservada, continuação na mesma execução, limite durável, 429, revogação entre lotes e pausa após falhas consecutivas. Chrome validou 390/1280px, temas claro/escuro, ausência de overflow e acionamento por teclado; não houve teste em dispositivo físico. TypeScript e build com pnpm 10.24.0, instalação isolada e lockfile congelado passaram, com avisos preexistentes fora do escopo. Nenhuma migration, configuração de produção ou escrita Olist real foi alterada por esta implementação.

Impacto de consumo: o resumo acrescenta uma agregação de operações e agrupa pendências por tipo, devolvendo somente totais; não baixa payloads de contatos. O orçamento de aplicação deixa de contar operações a cada fase e fica no checkpoint, com uma leitura de compatibilidade por etapa antiga. Os testes de continuação verificam que não há nova coleta do catálogo; confirmação, revalidação de segurança e intervalos das contas permanecem obrigatórios. Não foi medida economia monetária nem latência de produção.


## Cadência da aplicação e reutilização de identidade — 19/11/2026

A aplicação deixa de usar janelas fixas de 12/18 segundos por chamada composta. Cada HTTP protegido, inclusive `/info`, participa do controle de cadência, respeitando `X-RateLimit-Limit`, `Remaining`, `Reset` e `Retry-After`. Com headers válidos, usa até 80% da cota, com teto de 48 GET/min e 60 HTTP de escrita/min. Como todo POST/PUT exige um GET fresco de identidade com a mesma credencial, o teto efetivo de envios fica abaixo de 30/min mesmo nos planos maiores. Sem headers, assume 30/min e utiliza até 24 HTTP/min. O mutex persistido em `proximaChamadaEm` continua serializando as chamadas do módulo; integrações externas compartilham a cota da conta e podem reduzir o ritmo. A auditoria de catálogo mantém sua política anterior de até 30 leituras/min.

O cliente pode reaproveitar a identidade por até 60 segundos apenas nas leituras preparatórias protegidas. Confirmação final e reconciliação consultam `/info` novamente, inclusive quando a credencial permanece igual. O cache é opt-in, privado em memória, limitado a 100 aplicativos e vinculado ao SHA-256 da credencial. Troca de token/aplicativo, TTL expirado, relógio regressivo, identidade recusada e respostas 401/403 invalidam o reaproveitamento; hits não renovam o TTL. O callback que valida a conta esperada e o guard de autorização/lease continuam sendo executados. Cada escrita consulta `/info` novamente e usa exatamente a credencial consultada. Não são armazenados tokens ou identidades nos checkpoints, e dados dos cadastros não são reaproveitados como autoridade de escrita.

A espera pela cota ocorre antes dos guards de recurso e da marca durável de envio. Esperas superiores a 12 segundos devolvem a etapa à fila com a janela persistida, sem marcar um POST que ainda não foi enviado. Se a pausa ocorreu durante a validação de uma operação ainda não enviada, o cursor volta a FONTES e descarta o início anterior da janela, preservando operação, orçamento e catálogos; as pré-condições são refeitas após a pausa. Consultas de destino, confirmação remota, reconciliação de resultado incerto, locks, cancelamento e revisões permanecem. A pausa entre lotes cai para cinco segundos sem criar outra execução; a recuperação global roda no início de cada invocação e, enquanto houver trabalho, a cada 30 segundos. Gates e locks continuam em cada reserva/chamada. A finalização usa uma consulta de existência enquanto houver fases ativas e mantém a checagem final sob lock. Isso reduz consultas de manutenção repetidas a cada fase, sem adicionar infraestrutura ou migrations.

A mudança é compatível com a fila e checkpoints existentes: após publicar, o consumidor retoma a mesma execução. Não exige reset, nova coleta ou alteração de configuração do grupo. Invocações antigas ainda podem terminar com a cadência anterior. A meta de 24 horas depende da quantidade elegível, latência e cota compartilhada; simulações locais não comprovam vazão em produção. O volume por hora aumenta durante o processamento, enquanto a redução de `/info` e de consultas globais diminui chamadas totais e transferências de controle. Não foi medido egress faturado.

Validação inicial da cadência: 222 testes sem banco e 178 com PostgreSQL descartável, sem ignorados, mais TypeScript, lint e build. A medição inicial de 11,56/min e 207 HTTP para 40 contatos reutilizava identidade também na confirmação. A revisão de compatibilidade abaixo substitui essa medição.

### Revisão de compatibilidade com trabalho em andamento

Foram restauradas as leituras frescas de identidade na confirmação/reconciliação: uma mudança na conta precisa bloquear a confirmação mesmo sem troca de token. A espera longa por cota durante FONTES/DESTINO/ESCREVER agora reinicia apenas a validação daquela operação, sem perder sua autorização ou reaproveitar pré-condições vencidas. Não volta a AUTORIZADA uma operação com envio incerto.

Regressões locais cobrem retomada por um consumidor novo com cache vazio nas fases CONTAS, FONTES, DESTINO, ESCREVER e VERIFICAR, conservando a mesma execução e a janela persistida anterior; também cobrem uma reserva já ativa que o consumidor novo deve respeitar. Em todos esses cenários há uma única escrita e nenhuma nova coleta. O teste de mudança de identidade durante confirmação, sem mudar a credencial, permanece ativo.

Com confirmação fresca, a simulação revisada de 40 contatos usou aproximadamente 259 segundos virtuais, 248 HTTP e 86 consultas de identidade, sem duplicação ou extrapolação da cota: cerca de 9,27/min e 22% menos HTTP que a referência de 320 chamadas. Essa medição é inferior à inicial e não comprova a meta de 24 horas: para aproximadamente 15 mil pendentes, a projeção ideal fica perto de 27 horas, antes da latência real. A publicação deve preservar a execução atual, sem cancelar, recriar fila, alterar configuração ou resetar dados. O consumidor antigo pode terminar a reserva vigente; o novo respeita a lease e continua do checkpoint.

Validação final da revisão de compatibilidade: 222 testes sem banco e 184 de integração com PostgreSQL local aprovados, sem ignorados. TypeScript, lint dos arquivos alterados e build em instalação isolada com o mesmo lockfile passaram; o build mantém apenas avisos preexistentes. A inspeção de produção foi somente de leitura: a execução `4bf431fb-7184-454c-b4d1-13881c8e2e03` estava APLICANDO, com 632 criações e checkpoint ESCREVER às 19h13 de 19/11/2026 (America/Sao_Paulo). Não houve deploy ou alteração de estado em produção nesta revisão.

## Retomada de janela pronta e leituras de controle — 20/11/2026

O consumidor distingue fila sem próxima janela de uma janela que venceu enquanto o banco respondia. Quando o horário retornado já chegou, aguarda 100 ms e tenta reservar novamente na mesma invocação; limita a três novas tentativas sem etapa processada. Uma reserva bem-sucedida reinicia esse limite. Fila vazia, pausa/revogação, espera superior a 12 segundos e falta de orçamento continuam encerrando a passagem. Não há nova execução nem repetição automática de POST.

O despacho carrega os dados atuais da etapa uma única vez e os entrega ao handler; elimina a segunda leitura idêntica. O repositório mantém o contrato de `comReserva` e acrescenta uma projeção interna de controle contendo somente os campos necessários aos gates atuais. Checkpoints e falhas usam uma projeção ainda menor, com cursor, tentativas e cancelamento. A ordem dos locks de execução/etapa, o token e a validade da lease permanecem compartilhados entre essas projeções. Autorizações não são armazenadas em cache e continuam revalidadas antes dos recursos e da escrita.

**Egress:** remove uma chamada de leitura de dados por etapa normal e deixa de transferir políticas, agenda, contadores e outros metadados nas verificações que não os utilizam. Em fixture local com uma política artificial de 20 kB, a reserva completa serializada mediu 22.379 B e o controle 1.168 B. São tamanhos JSON da fixture, não bytes de protocolo PostgreSQL nem egress faturado ou medição da base de produção. A retomada adiciona até três tentativas limitadas de reserva quando há contenção sem progresso; durante trabalho útil, pode aumentar chamadas por minuto por eliminar tempo ocioso.

**Compatibilidade:** não há migration, alteração de cotas, paralelismo novo ou mudança no formato dos checkpoints. Depois de publicar, o cron existente continua a execução atual, respeitando reservas anteriores. Não é necessário cancelar, recriar a fila ou iniciar outra sincronização. Nenhuma configuração, execução ou escrita Olist de produção foi alterada nesta implementação.

**Validação local:** suíte completa com 418 testes aprovados, sem falhas ou ignorados, incluindo PostgreSQL descartável e Chrome com backend simulado. Após acrescentar a regressão da janela vencendo durante consulta SQL real, os 85 testes do consumidor foram aprovados novamente. Contagens incluem agrupadores e se sobrepõem; não devem ser somadas. TypeScript, lint dos arquivos alterados, build e revisão do diff passaram. O lint geral mantém avisos preexistentes fora do escopo. A simulação sem latência real continua em 9,27 criações/min; ela não mede o ganho desta correção, que depende das pausas e leituras do ambiente real. Commit, push e deploy não foram executados nesta entrega.

## Previsão do término da aplicação no card de execução

A consulta privada `GET previsao` também retorna `previsaoAplicacao` para uma execução em aplicação, preservando o campo `previsao` da leitura. O card mostra a data/hora em America/Sao_Paulo, horas/minutos restantes, operações pendentes, confirmações por minuto e o instante do cálculo. A estimativa é atualizada ao carregar a página ou clicar em Atualizar; não integra o polling de progresso nem a consulta do modal. A conclusão remove a previsão do card.

A taxa considera os eventos ESCRITA_CONFIRMADA da própria execução nos últimos 30 minutos, ou desde o início da aplicação quando mais recente. Exige ao menos cinco confirmações e um minuto decorrido. O numerador não usa os contadores acumulados desde a auditoria nem somente o tempo de chamadas HTTP; pausas ocorridas na janela fazem parte da taxa. O denominador conta operações consumíveis por destino e entidade desta execução, inclusive autorizadas em auditorias anteriores e reconciliação ainda pendente. Propostas sem autorização e falhas permanentes não entram no tempo restante; falhas/resultados inconclusivos sem retomada nesta passagem aparecem separadamente. Preparação incompleta, pausa/bloqueio, fila vazia e amostra insuficiente têm mensagens próprias, sem inventar uma data. Novas operações e mudanças de ritmo podem alterar o término previsto.

Egress: a consulta acrescenta no máximo duas agregações no banco (fila e confirmações recentes), retornando uma linha cada. Filtra por grupo/status e grupo/data, com índices já existentes; não transfere operações individuais, observações, payloads ou metadados de eventos para o servidor/navegador. Não há migration nem alteração do worker, das cotas ou da execução em andamento. O contrato é validado localmente com testes de cálculo, API, PostgreSQL descartável e Chrome em 390/1280px, temas claro/escuro, atualização por teclado e ausência de polling adicional. Não houve teste em dispositivo físico nem publicação em produção.

Validação final desta previsão: 431 testes da suíte Olist aprovados, sem falhas ou ignorados, incluindo PostgreSQL descartável e Chrome com backend simulado. TypeScript, lint dos arquivos alterados, build e diff-check passaram. Navegador validado em 390/1280px, nos dois temas, com atualização por teclado, ausência de overflow e remoção da previsão após conclusão; a aba de teste foi mantida visível para exercitar o polling. O build mantém avisos preexistentes fora do escopo. Não houve migration, commit, push ou deploy nesta entrega.
