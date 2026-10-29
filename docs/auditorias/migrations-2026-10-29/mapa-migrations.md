# Auditoria das migrations — 29/10/2026

## Resultado

Foram lidos os **98 arquivos migration.sql existentes no checkout atual** e comparados ao catálogo do banco PostgreSQL configurado por POSTGRES_DIRECT_URL. O histórico contém somente **1 registro concluído**, de kits, com checksum correspondente. As outras **97 estão pendentes no histórico**; isso não significa que as 97 devam ser executadas.

| Situação das pendentes | Quantidade | Orientação |
|---|---:|---|
| Atendidas no estado atual | 58 | Candidatas a reconciliar o histórico após revisão do mapa; não reaplicar o SQL. |
| Superadas por versões posteriores | 7 | Preservar o estado final, sem restaurar versão antiga. |
| Com correções parciais necessárias | 19 | Preparar correção específica das lacunas; não executar o arquivo inteiro. |
| Dependem de revisão de dados/escopo | 13 | Decidir por aplicativo e caso, preservando configurações atuais. |
| **Total de pendentes** | **97** | **Não executar migrate deploy globalmente neste estado.** |

A única registrada e conferida é **20261028170000_kits_estoque**. O mapa inclui essa linha como referência, totalizando 98.

**Nenhuma migration foi executada nesta auditoria.** Não houve resolve, db push, DDL, INSERT, UPDATE ou DELETE no banco. As sessões usaram `BEGIN READ ONLY`, consultas ao catálogo/contagens agregadas e `ROLLBACK`. SAVEPOINTs foram usados para recuperar eventuais falhas de consulta; todas as 33 sondagens de dados terminaram sem erro. Só foram criados os arquivos locais deste relatório.

## Escopo e qualidade da evidência

- Fotografia inicial do catálogo: **29/10/2026 às 11:27:24, America/Sao_Paulo** (14:27:24 UTC). Banco `postgres`, schema `public`, PostgreSQL 17.6.
- 48 tabelas, 556 colunas, 147 constraints, 160 índices, 37 rótulos de enum, 12 funções e 5 triggers inspecionados. “37” conta rótulos, não 37 tipos distintos.
- Foram conferidos presença, tipos/nulabilidade/defaults, índices/chaves equivalentes mesmo com nomes diferentes, restrições CHECK, alvos de FKs, enums finais, corpos de funções, triggers, RLS e privilégios.
- Os corpos normalizados das 8 funções relacionadas às migrations coincidem com suas versões finais no repositório. Versões antigas não foram tomadas como alvo quando uma posterior as substitui.
- Dados foram consultados como agregados, sem exportação de registros pessoais, tokens, conteúdo de pedidos ou credenciais. Nenhuma função com efeito de trigger foi invocada; as funções SQL de normalização usadas nas contagens são puras e tiveram seu corpo inspecionado.
- As sondagens representam o **estado atual**, não prova histórica de que um SQL específico foi executado. Depois de meses, diferenças podem resultar de edições legítimas ou aplicativos criados posteriormente.
- Nenhuma migration foi testada por execução, nem mesmo seguida de rollback. Não houve simulação DDL/DML no banco de produção. Zero linhas inválidas indica viabilidade inicial para uma constraint, não elimina concorrência ou a necessidade de reconferir antes de alterar.
- A instância continuou operacional durante a leitura; alterações posteriores podem mudar os resultados. Uma fotografia inicial e duas sessões adicionais de dados foram usadas; não se trata de um snapshot global único entre todas as sessões.

## Correções de segurança que faltam

Os SQLs de origem exigem acesso somente pelo servidor, mas foram observados RLS desabilitada e privilégios efetivos de leitura/inserção/alteração/exclusão para `anon` e `authenticated` em:

| Migration | Tabelas | Falta atual |
|---|---|---|
| 20261002120000_add_notification_queue | notification | RLS, revogações e CHECK tentativas >= 0 |
| 20261009150000_acesso_pagina_usuario | acesso_pagina_usuario | RLS, revogações e CHECK acessos > 0 |
| 20261016170000_pedido_fornecedor_queue | pedido_fornecedor_queue | RLS e revogações |
| 20261021013941_retorno_estoque_olist | retornos_estoque_olist; itens_retorno_estoque_olist | RLS, revogações e CHECK quantidade > 0 nos itens |

Isso comprova uma lacuna nas permissões SQL e nas proteções previstas. A exposição efetiva pela Data API depende também de suas configurações, que não foram verificadas; não houve tentativa de acesso anônimo aos dados. A correção futura deve considerar as APIs servidoras já existentes e reconferir permissões após aplicar.

`buscar_estampas_por_relevancia` também permite EXECUTE a `anon`, embora as migrations descrevam acesso de authenticated/service_role e revoguem PUBLIC. Revogar apenas PUBLIC não remove um grant direto para anon; esse caso exige ajuste de grant específico, não apenas repetir o SQL antigo. RLS de estampas está habilitada; a execução permitida por si só não comprova que a função retorne dados ao papel anon.

## Demais lacunas estruturais

- **20260520120000:** dois índices de devolução e FK do item para a solicitação; zero órfãos atuais.
- **20260520143000:** a tabela-base `turnos_producao` não existe. A migration apenas a altera, não a cria; a tela `src/app/turnos-producao/page.tsx` ainda a consulta. É preciso decidir manter/recuperar essa funcionalidade. As quatro colunas OAuth antigas ausentes não devem ser recriadas só para igualar um snapshot: `src/lib/aplicativo.ts` usa configuração por ambiente.
- **20260524210000 / 20260526122000 / 20260816120000:** defaults de updated_at ausentes em tipo_produto, estampa, variante, tamanho e produto_olist; a última migration é específica para produto_olist. Há sobreposição de lacunas, não cinco mudanças adicionais por arquivo.
- **20260604123000:** índice de produtos.id_cadastro_olist ausente.
- **20260720180000 / 20260722120000 / 20261028150000:** NOT NULL ausente em tarefas_midia.dias_semana, buscas_sku.situacoes e configuracoes_jobs.variantes_permitidas; contagens de nulos são zero.
- **20260827110000:** os dois índices únicos parciais da tabela legada estampa faltam; nenhum grupo duplicado atual. Essa tabela possui 260 registros e continua em uso pelo gerador CSV, portanto não deve ser descartada como se fosse apenas uma sobra do catálogo estampas.
- **20260828200000:** FK de estampa_jobs.estampa_id para estampas.id ausente; zero jobs órfãos. Há 56.755 jobs: o SQL original aborta se houver qualquer job. Apenas a FK deve ser reconciliada, mantendo BIGINT.
- **20260829010000:** faltam os índices de status/created_at, elementos_visuais GIN e ocasioes GIN. Existem pares redundantes de GIN de categorias e cores; preservar um índice equivalente por necessidade, sem criar outros duplicados ou remover nada nesta auditoria.
- **20260831190000:** índice único parcial provider_custom_id não nulo ausente; zero duplicatas atuais.
- **20261016160000 / 20261016190000:** checks de evidência completa, direcionamento completo e versão não negativa ausentes; nenhuma violação atual nas respectivas sondagens.

## Dados: efeitos ainda não atendidos e decisões necessárias

| Migration/grupo | Resultado observado | Decisão necessária |
|---|---|---|
| 20260615120000 | 12 produtos elegíveis à associação de produto fornecido ainda sem vínculo | Conferir tecido e quantidade por produto; não escolher fornecedor de forma implícita. |
| 20260716171000 | 155 vínculos ausentes conforme os IDs fixos do seed; já existem 74 vínculos de pagamento atuais | Verificar IDs Olist de cada integração e intenção por aplicativo; não tratar como ausência total de configuração. |
| Seeds de tarefas de julho | 84 inserções possíveis nos 3 aplicativos sem tarefas; 56 tarefas existentes nos outros 2 | Definir quais aplicativos devem ter essas tarefas. Não preencher fornecedores/filiais por suposição. |
| 20260721140000 | Estrutura convertida para arrays; colunas antigas já removidas | Não é possível provar preservação de todo conteúdo antigo sem backup anterior. Não repetir a conversão. |
| 20260831020000 | 868 candidatos do backfill poá v1: 328 sem padrão poá, 475 confiança < 0,9, 246 sem termo | Conferir metadados atuais e evitar sobrescrever classificações revistas pela IA/usuário. |
| 20260831021000 | 812 candidatos v1.1: 272 sem padrão poá, 425 confiança < 0,9, 190 sem termo | Sobrepõe-se ao v1; não somar candidatos ou faltas entre versões. |
| 20261017001000 | 1 fila PROCESSAR sem envio nem pedido registrado | Conferir se é um marcador legado antes de reabrir; não alterar estado operacional automaticamente. |

Os seeds antigos de tarefas 20260721100000, 20260721110000, 20260721120000 e 20260721130000 ainda escrevem `link_apoio`, coluna removida depois. Assim, mesmo que se decida completar tarefas, esses arquivos **não devem rodar literalmente** no schema atual.

## Mapa completo por arquivo

“Atendida” significa que o efeito relevante está presente ou atendido por uma evolução compatível; não afirma que o arquivo rodou. As notas abaixo explicitam equivalências, substituições e limitações. “Correção parcial” indica trechos a preparar, **não autorização para executar a migration original**.

| Migration | Histórico | Classificação | Evidência e orientação |
|---|---|---|---|
| `20260519212000_add_minimo_estoque_to_produtos` | Pendente | ATENDIDA | minimo_estoque existe, integer e anulável, conforme o SQL. |
| `20260520120000_add_devolucoes` | Pendente | CORREÇÃO PARCIAL | Tabelas presentes, mas faltam os dois índices de devolução e a FK itens_solicitacao_devolucao.solicitacao_id → solicitacoes_devolucao.id. Nenhum item órfão observado. Corrigir apenas essas lacunas. |
| `20260520143000_add_aplicativo_whitelabel` | Pendente | CORREÇÃO PARCIAL | Aplicativo padrão e backfill dos 12 conjuntos de registros existentes conferidos (zero aplicativo_id nulo); índices/defaults presentes nesses conjuntos. A tabela base turnos_producao não existe, embora ainda haja uma tela que a consulta. Quatro colunas OAuth antigas não existem; a configuração atual usa ambiente. Não reaplicar o SQL inteiro nem recriar colunas antigas sem definir o contrato desejado. |
| `20260520150000_add_usuario_permissoes` | Pendente | ATENDIDA | Tabela usuario, campos de permissão, defaults, FK e índices presentes. |
| `20260524210000_add_gerador_csv_olist` | Pendente | CORREÇÃO PARCIAL | Tabelas, FKs e índices relevantes existem, alguns com nomes gerados pelo Prisma. Faltam defaults de updated_at em tipo_produto, estampa, variante, tamanho e produto_olist. Unicidades antigas de variante e estampa foram substituídas por regras posteriores; não recriar as regras antigas. |
| `20260526110000_associate_variante_estampa` | Pendente | SUPERADA | Associação variante.estampa_id e FK presentes; unicidade por estampa/código foi substituída pela unicidade por estampa/tamanho/código de 20260823120000. Não recriar o índice antigo. |
| `20260526113000_add_estampa_extra` | Pendente | ATENDIDA | estampa.extra existe como text anulável. |
| `20260526122000_add_tamanho_olist` | Pendente | CORREÇÃO PARCIAL | Tabela tamanho, relação com produto_olist e índices existentes (unicidades com nomes equivalentes). O default de tamanho.updated_at está ausente. CREATE TABLE IF NOT EXISTS não repararia esse default numa tabela já existente. |
| `20260526124000_associate_variante_tamanho` | Pendente | ATENDIDA | variante.tamanho_id, FK ON DELETE SET NULL e índice já existem. |
| `20260527120000_add_tipo_produto_prompt_ia` | Pendente | ATENDIDA | tipo_produto.detalhes_prompt_ia presente como text anulável. |
| `20260604120000_add_produto_relation_to_produto_olist` | Pendente | ATENDIDA | produto_olist.produto_id, índice e FK para produtos com ON DELETE SET NULL presentes. |
| `20260604123000_add_id_cadastro_olist_to_produtos` | Pendente | CORREÇÃO PARCIAL | produtos.id_cadastro_olist existe, mas idx_produtos_id_cadastro_olist não existe e não há índice equivalente sobre essa coluna. |
| `20260609190000_add_fornecedores` | Pendente | ATENDIDA | Tabela fornecedores, campos originais, FK e índices presentes. |
| `20260609193000_add_produtos_fornecedor` | Pendente | ATENDIDA | Tabela produtos_fornecedor, campos, FKs e índices presentes. |
| `20260609194500_add_tipo_produto_produtos_fornecedor` | Pendente | ATENDIDA | Tabela tipo_produto_produto_fornecedor, colunas, FKs e unicidade presentes. |
| `20260609200000_add_tamanho_produtos_fornecedor` | Pendente | ATENDIDA | Tabela tamanho_produto_fornecedor, colunas, FKs e unicidade presentes. |
| `20260610103000_add_tamanho_quantidade_produto_fornecedor` | Pendente | ATENDIDA | Campo tamanho.quantidade_produto_fornecedor presente. Zero tamanhos atualmente elegíveis ao backfill com destino nulo. |
| `20260610120000_add_medidas_produtos_fornecedor` | Pendente | ATENDIDA | Cinco campos de peso/embalagem por metro presentes nos tipos numéricos esperados. |
| `20260615120000_add_produto_olist_produtos_fornecedor` | Pendente | REVISÃO DE DADOS | Tabela de associação, índices e FKs existem; 12 produtos atualmente elegíveis ao SELECT de origem não têm associação. Revisar qual tecido/quantidade é correto antes de um backfill dedicado; o SQL original começa por CREATE TABLE sem IF NOT EXISTS. |
| `20260621120000_add_estampa_imagem_url` | Pendente | ATENDIDA | estampa.imagem_url e imagem_url_2 presentes. |
| `20260713120000_add_tipo_produto_corte_laser_tecido_corrido` | Pendente | ATENDIDA | tipo_produto.corte_laser e tecido_corrido presentes, boolean NOT NULL DEFAULT false. |
| `20260714120000_add_controle_midia` | Pendente | ATENDIDA | categorias_olist e midias, respectivos campos, FKs e índices presentes. |
| `20260715120000_add_usuario_permissoes_telas` | Pendente | ATENDIDA | Quatro permissões de telas presentes, boolean NOT NULL DEFAULT false. |
| `20260715130000_scope_olist_token_by_aplicativo` | Pendente | ATENDIDA | Tokens já usam aplicativo_id NOT NULL sem default, sem tokens nulos, e unicidade aplicativo/provider. Índices únicos globais anteriores não existem; não repetir DELETE histórico. |
| `20260715140000_add_usuario_vendedor_olist_id` | Pendente | ATENDIDA | usuario.vendedor_olist_id presente como integer anulável. |
| `20260715141000_add_usuario_permissoes_olist` | Pendente | ATENDIDA | Cinco permissões Olist presentes, boolean NOT NULL DEFAULT false. |
| `20260715160000_add_fornecedor_vendedor_olist_id` | Pendente | ATENDIDA | fornecedores.vendedor_olist_id, FK para usuario com SET NULL e índice presentes. |
| `20260715161000_add_fornecedor_meu_cliente_olist_id` | Pendente | ATENDIDA | fornecedores.meu_cliente_olist_id presente como integer anulável. |
| `20260715162000_add_pedido_fornecedor_solicitacao` | Pendente | ATENDIDA | Tabela pedido_fornecedor_solicitacao, FKs, unicidade e índices presentes. |
| `20260715230000_add_usuario_permissoes_tipos_produto` | Pendente | ATENDIDA | As duas permissões específicas estão presentes, boolean NOT NULL DEFAULT false. |
| `20260715231000_add_usuario_permissoes_tamanhos` | Pendente | ATENDIDA | As duas permissões específicas estão presentes, boolean NOT NULL DEFAULT false. |
| `20260715232000_add_usuario_permissoes_estampas` | Pendente | ATENDIDA | As duas permissões específicas estão presentes, boolean NOT NULL DEFAULT false. |
| `20260715233000_add_usuario_permissoes_variantes` | Pendente | ATENDIDA | As duas permissões específicas estão presentes, boolean NOT NULL DEFAULT false. |
| `20260716120000_add_tipo_servico_produto_fornecedor` | Pendente | ATENDIDA | Enum tipo_servico_produto_fornecedor contém CORTE_LASER; campo e unicidade fornecedor/tipo_servico presentes. |
| `20260716150000_add_usuario_permissoes_formas_pagamento_recebimento` | Pendente | ATENDIDA | Permissões de formas de pagamento/recebimento presentes com tipo/default esperados. |
| `20260716170000_add_planos_pagamento_olist` | Pendente | ATENDIDA | Três tabelas, índices/FKs e unicidades por índices equivalentes presentes. Os 11 planos originais já existem. Não repetir os INSERTs sem proteção contra duplicatas. |
| `20260716171000_seed_formas_pagamento_planos` | Pendente | REVISÃO DE DADOS | O SELECT do seed produziria 155 vínculos ausentes em 5 aplicativos. Há 74 vínculos de pagamento atuais com configuração diferente. Os IDs Olist são fixos no SQL; validar integração e intenção comercial por aplicativo, sem preencher automaticamente todos eles. |
| `20260716172000_add_tipo_venda_enum` | Pendente | ATENDIDA | Enum tipo_venda contém venda, venda g e venda pc, conforme o SQL. |
| `20260716173000_add_fornecedor_meu_forma_pagamento_olist_id` | Pendente | ATENDIDA | fornecedores.meu_forma_pagamento_olist_id presente como integer anulável. |
| `20260716174000_add_fornecedor_tipo_venda_plano_pagamento` | Pendente | ATENDIDA | Campos de tipo de venda/plano, FK de plano com SET NULL e índice presentes. |
| `20260720180000_add_gestao_tarefas_midia` | Pendente | CORREÇÃO PARCIAL | Tabelas, enums, permissões, FKs e índices presentes; nenhum usuário com categorias habilitadas está sem tarefas habilitadas. dias_semana tem default mas aceita NULL (o SQL exige NOT NULL); zero nulos observados. Colunas link_apoio/link_relacionado foram substituídas por arrays depois. Ajustar apenas a nulabilidade, preservando a evolução dos links. |
| `20260720210000_add_controle_midia_produtos` | Pendente | ATENDIDA | produtos.tem_foto e tem_video presentes como boolean NOT NULL DEFAULT false. |
| `20260721100000_seed_tarefas_midia_operacao` | Pendente | REVISÃO DE DADOS | O seed encontraria 36 tarefas ausentes nos 3 aplicativos sem tarefas (12 tarefas operacionais por aplicativo; SQL antigo usa link_apoio já removido). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260721110000_seed_tarefa_semanal_oferta_relampago` | Pendente | REVISÃO DE DADOS | O seed encontraria 3 tarefas ausentes nos 3 aplicativos sem tarefas (oferta relâmpago semanal; SQL antigo usa link_apoio já removido). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260721120000_seed_tarefa_quinzenal_google_storage` | Pendente | REVISÃO DE DADOS | O seed encontraria 3 tarefas ausentes nos 3 aplicativos sem tarefas (custo Google Storage; SQL antigo usa link_apoio já removido). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260721130000_seed_tarefas_mensais_financeiro` | Pendente | REVISÃO DE DADOS | O seed encontraria 30 tarefas ausentes nos 3 aplicativos sem tarefas (10 tarefas financeiras mensais; SQL antigo usa link_apoio já removido e atualiza agendas existentes). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260721140000_add_multiplos_links_tarefas` | Pendente | REVISÃO DE DADOS | Estrutura final de links já atendida: arrays presentes e colunas escalares antigas removidas. A conversão histórica de links/descritivos não pode ser reconstituída sem snapshot anterior; não reaplicar, pois ADDs e referências às colunas removidas conflitam com o estado atual. Revisão de conteúdo apenas se houver suspeita de perda. |
| `20260721150000_seed_tarefa_quinzenal_novos_produtos` | Pendente | REVISÃO DE DADOS | O seed encontraria 3 tarefas ausentes nos 3 aplicativos sem tarefas (cadastro quinzenal de produtos). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260721160000_seed_tarefa_semanal_devolucoes` | Pendente | REVISÃO DE DADOS | O seed encontraria 3 tarefas ausentes nos 3 aplicativos sem tarefas (devoluções semanais). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260721170000_seed_tarefas_mensais_cancelamento_notas` | Pendente | REVISÃO DE DADOS | O seed encontraria 6 tarefas ausentes nos 3 aplicativos sem tarefas (duas tarefas mensais de notas fiscais). Os outros 2 aplicativos possuem as 56 tarefas ao todo. Pode ser escopo intencional; só completar após decidir quais aplicativos devem receber tarefas. Não executar o seed global indiscriminadamente. |
| `20260722120000_add_historico_buscas_sku` | Pendente | CORREÇÃO PARCIAL | Tabelas, FKs e índices presentes. buscas_sku.situacoes tem default mas aceita NULL; a migration exige NOT NULL. Zero nulos observados. Ajuste pontual de nulabilidade, sem recriar as tabelas. |
| `20260722130000_add_titulo_produto_itens_busca_sku` | Pendente | ATENDIDA | itens_busca_sku.titulo_produto presente como text anulável. |
| `20260722140000_add_permissoes_anotar_sku` | Pendente | ATENDIDA | Permissões de escrita/visualização de Anotar SKU presentes com tipo/default esperados. |
| `20260816120000_restore_produto_olist_updated_at_default` | Pendente | CORREÇÃO PARCIAL | produto_olist.updated_at segue sem default. É uma alteração específica ainda necessária se preservado o contrato declarado pela migration. |
| `20260823120000_allow_cor_por_tamanho` | Pendente | ATENDIDA | Índice único estampa/tamanho/código presente; índice anterior estampa/código ausente, como esperado. |
| `20260827110000_add_estampa_ai_catalog_fields` | Pendente | CORREÇÃO PARCIAL | Campos IA, check de status e índices auxiliares presentes na tabela legada estampa, ainda usada pelo gerador CSV. Faltam os dois índices únicos parciais de código/variante; zero grupos duplicados observados. Não criar o índice antigo global de código. |
| `20260827120000_add_estampa_jobs` | Pendente | SUPERADA | Modelo inicial UUID com FK para estampa foi substituído por BIGINT ligado ao catálogo estampas. Tabela/controles de job presentes. Não voltar ao modelo UUID; a lacuna de FK no modelo final é tratada em 20260828200000. |
| `20260827130000_prevent_duplicate_active_estampa_jobs` | Pendente | SUPERADA | Índice único apenas para jobs ativos foi substituído pela unicidade permanente estampa_id/tipo em 20260830010000. Índice permanente existe e não há grupos duplicados. Não recriar o índice antigo. |
| `20260828120000_add_estampa_job_retry_backoff` | Pendente | ATENDIDA | next_attempt_at NOT NULL DEFAULT CURRENT_TIMESTAMP e índice status/próxima tentativa presentes. |
| `20260828130000_add_manual_estampa_reprocessing` | Pendente | ATENDIDA | Campos de solicitação manual e estampa_jobs_manual_request_check presentes. |
| `20260828140000_add_estampa_full_text_search` | Pendente | SUPERADA | Busca inicial baseada em estampa/search_vector foi substituída pelo catálogo estampas e funções posteriores. Função atual consulta estampas, com vetor/GIN presentes. Não recriar a coluna ou o índice da busca antiga. Rever permissões da função na versão final. |
| `20260828200000_align_jobs_with_estampas_catalog` | Pendente | CORREÇÃO PARCIAL | BIGINT e busca no catálogo estampas já atendidos; corpo da função atual coincide com esta versão. Falta FK estampa_jobs.estampa_id → estampas.id (zero órfãos). A rotina inteira abortaria porque há 56.755 jobs; corrigir apenas a FK. EXECUTE da busca está concedido a anon; o SQL só revoga PUBLIC e exige ajuste específico para eliminar grant explícito a anon. |
| `20260829010000_add_estampas_admin_search_indexes` | Pendente | CORREÇÃO PARCIAL | Cinco dos oito índices estão presentes. Faltam idx_estampas_status_created_at, idx_estampas_elementos_visuais_gin e idx_estampas_ocasioes_gin. Há índices GIN redundantes de categorias/cores sob nomes diferentes; não criar mais duplicatas. |
| `20260829020000_fix_estampas_processing_status_trigger` | Pendente | SUPERADA | Trigger de preservação existe e sua função foi substituída pela versão com WAITING_PROVIDER de 20260831190000. A reconciliação de estados é histórica e não deve ser repetida com o algoritmo antigo em jobs atuais. |
| `20260829030000_fix_estampas_full_text_dictionary` | Pendente | ATENDIDA | unaccent instalado em extensions; função/trigger finais de busca usam simple+unaccent. Zero vetores divergentes da expressão final. Corpo antigo foi ampliado depois; não sobrescrever o sucessor. |
| `20260829040000_add_estampa_image_presentation` | Pendente | ATENDIDA | Cinco campos de apresentação, seis checks e três índices presentes. Constraints inspecionadas no catálogo. |
| `20260829050000_normalize_estampas_taxonomies` | Pendente | ATENDIDA | Funções de normalização coincidem com a fonte; função/trigger principal inclui campos acrescentados depois. Zero registros divergentes na normalização dos campos originais. |
| `20260830010000_reuse_single_estampa_job` | Pendente | ATENDIDA | Unicidade permanente estampa/tipo presente; índice parcial antigo ausente; zero grupos duplicados. Não repetir a remoção histórica de jobs. |
| `20260831010000_add_estampa_search_segmentation` | Pendente | ATENDIDA | Campos/checks/GIN de segmentação presentes. Funções e triggers finais incluem segmentação e padrões têxteis; vetor atual consistente (zero divergências). |
| `20260831020000_add_estampa_textile_taxonomy` | Pendente | REVISÃO DE DADOS | Estrutura, constraints, GIN e corpos finais de funções atendidos. No backfill v1 há 868 candidatos atuais: 328 sem poá, 475 com confiança menor que 0,9 e 246 sem termo de pesquisa. Reavaliar o backfill com os metadados atuais; não sobrescrever dados de IA em bloco sem revisão. |
| `20260831021000_complete_poa_textile_backfill` | Pendente | REVISÃO DE DADOS | Backfill v1.1 encontra 812 candidatos atuais: 272 sem poá, 425 com confiança menor que 0,9 e 190 sem termo de pesquisa. Contagens se sobrepõem às da versão v1; não somar. Falta de estado atual não comprova que o backfill nunca rodou. |
| `20260831190000_add_estampa_ai_batches` | Pendente | CORREÇÃO PARCIAL | Batch, enum WAITING_PROVIDER e função final de preservação estão atendidos. Falta uq_estampa_jobs_provider_custom_id (parcial para não nulos); não há duplicatas não nulas observadas. Criar só o índice faltante, sem sobrescrever a função nem recriar a tabela. |
| `20261002120000_add_notification_queue` | Pendente | CORREÇÃO PARCIAL | Tabela e índices presentes. Faltam notification_tentativas_check, RLS e revogação de permissões anon/authenticated; ambos têm SELECT/INSERT/UPDATE/DELETE. Zero tentativas negativas observadas. Prioridade de segurança; não recriar a tabela. |
| `20261002130000_add_whatsapp_to_aplicativo` | Pendente | SUPERADA | Campo/default de WhatsApp presentes; o limite VARCHAR(15) foi intencionalmente ampliado para TEXT por 20261003160000. Não reduzir de volta. |
| `20261002140000_add_jobs_to_aplicativo` | Pendente | ATENDIDA | aplicativo.jobs presente como TEXT NOT NULL DEFAULT vazio. |
| `20261003160000_expand_aplicativo_whatsapp_list` | Pendente | ATENDIDA | aplicativo.whatsapp já é TEXT, preservando o default anterior. |
| `20261008120000_estampa_job_modelo_utilizado` | Pendente | ATENDIDA | estampa_jobs.modelo_utilizado presente como text anulável. |
| `20261008130000_configuracoes_jobs` | Pendente | ATENDIDA | Tabela configuracoes_jobs, PK, RLS, revogações e registro processar-estampas presentes. O registro está habilitado atualmente: não repetir o seed pausado=true nem reverter a configuração operacional. |
| `20261008140000_termos_ignorados_nome_arquivo` | Pendente | ATENDIDA | termos_ignorados_nome_arquivo e os termos originais -, . e MOCKUP presentes. Preservar termos adicionados posteriormente; não substituir o array inteiro. |
| `20261008150000_preservar_search_vector` | Pendente | ATENDIDA | estampas.search_vector e idx_estampas_search_vector_gin presentes; vetor consistente com a expressão final. |
| `20261008160000_adicionar_moclkup_exclusao` | Pendente | ATENDIDA | Termo MOCLKUP já presente na configuração processar-estampas; o predicado do append não selecionaria esse registro. |
| `20261009150000_acesso_pagina_usuario` | Pendente | CORREÇÃO PARCIAL | Tabela, PK e FK presentes; faltam CHECK acessos>0, RLS e revogações de anon/authenticated. Zero acessos não positivos observados. Prioridade de segurança. |
| `20261016160000_evidencia_confirmacao_producao` | Pendente | CORREÇÃO PARCIAL | Três colunas de evidência presentes, mas CHECK solicitacoes_producao_evidencia_completa ausente. Nenhuma linha parcialmente preenchida observada. |
| `20261016170000_pedido_fornecedor_queue` | Pendente | CORREÇÃO PARCIAL | Fila, FKs/índices e unicidade por índice equivalente presentes. RLS desabilitada e grants anon/authenticated continuam ativos. Prioridade de segurança; corrigir acesso sem recriar a fila. |
| `20261016180000_add_aplicativo_pai` | Pendente | ATENDIDA | Campo, índice, FK equivalente (nome diferente), CHECK contra autorreferência e vínculos esperados de matriz/filiais presentes. Zero vínculos divergentes no conjunto da migration. |
| `20261016190000_direcionamento_fila_fornecedor` | Pendente | CORREÇÃO PARCIAL | Campos/FKs/índices presentes, mas faltam os checks direcionamento_completo e versao_valida. Zero direcionamentos incompletos ou versões negativas observados. |
| `20261016200000_fornecedor_aplicativo_pai` | Pendente | ATENDIDA | Campo obrigatório, FK, índice, duas funções e triggers presentes; corpos conferem com a fonte. Execução revogada de anon/authenticated; nenhum fornecedor nulo ou associado a filial observado. |
| `20261016210000_permissao_fila_pedidos` | Pendente | ATENDIDA | usuario.pode_gerenciar_fila_pedidos presente com tipo/default esperados. |
| `20261016220000_status_fila_fornecedor` | Pendente | SUPERADA | Coluna de status e CHECK presentes no modelo final; valores PROCESSANDO/ENVIADO/COM_FALHA foram renomeados pela migration seguinte. Não recriar o enum antigo. |
| `20261016230000_renomear_status_fila_fornecedor` | Pendente | ATENDIDA | Enum contém PROCESSAR, CONCLUIDO e FALHADO; valores antigos não existem. CHECK atual usa os rótulos novos. |
| `20261017000000_add_aplicativo_descricao` | Pendente | ATENDIDA | aplicativo.descricao presente como text anulável. |
| `20261017000000_envio_manual_fila_fornecedor` | Pendente | ATENDIDA | Tabelas, FKs, índice de expiração, CHECK de estado, RLS e revogações das três tabelas de envio manual presentes. |
| `20261017001000_reabrir_fila_sem_envio_olist` | Pendente | REVISÃO DE DADOS | O predicado de reabertura encontra 1 fila PROCESSAR sem envio nem pedido registrado. Conferir o caso operacional antes de reabrir; o estado atual não prova que esse marcador é anterior ao novo fluxo. |
| `20261017010000_permissao_selecionar_filial_fornecedor` | Pendente | ATENDIDA | usuario.pode_selecionar_filial_fornecedor presente como boolean NOT NULL DEFAULT false. |
| `20261021013941_retorno_estoque_olist` | Pendente | CORREÇÃO PARCIAL | Tabelas, FKs e índices de retorno presentes. Faltam CHECK quantidade>0, RLS e revogações em ambas; anon/authenticated têm grants ativos. Zero quantidades não positivas observadas. Não reaplicar CREATE TABLE; corrigir apenas proteções faltantes. movimentacao_id anulável é evolução posterior intencional. |
| `20261021140000_retorno_perdido_entrega` | Pendente | ATENDIDA | itens_retorno_estoque_olist.movimentacao_id aceita NULL, como exige o retorno perdido sem entrada de estoque. |
| `20261028150000_variantes_permitidas_jobs` | Pendente | CORREÇÃO PARCIAL | variantes_permitidas existe com default array vazio, mas aceita NULL, enquanto a migration exige NOT NULL. Zero nulos observados; ajustar apenas a nulabilidade. |
| `20261028170000_kits_estoque` | Registrada; checksum OK | REGISTRADA E CONFERIDA | Única registrada no Prisma; checksum confere. Tabela, PK/FK/checks, RLS/revogações, sku_origem e unicidade pedido/item/SKU conferidos. Não executar novamente. |

## Como usar este mapa depois

1. Rever e corrigir primeiro as lacunas de acesso e integridade em mudanças dedicadas, após nova autorização.
2. Resolver o escopo dos seeds e backfills com impacto comercial/operacional. Ausência nos 3 aplicativos sem tarefas não é, isoladamente, um defeito.
3. Reconciliar o histórico de migrations cujos efeitos foram conferidos como atendidos/superados, mantendo evidência da decisão e sem executar versões antigas.
4. Só depois adotar deploy de migrations pendentes como rotina. `resolve --applied` muda o histórico e não aplica SQL; não foi executado nesta auditoria.

Arquivos de apoio:

- `evidencias.json`: catálogo observado, checks por migration, checksum dos arquivos, contagens de dados e classificação revisada.
- `consultas-somente-leitura.sql`: as 33 consultas SELECT/WITH de dados/permissões, dentro de BEGIN READ ONLY/ROLLBACK, para reprodução futura. Não contém comandos de migration.

Nenhuma mudança de produção, de configuração, de permissões, de estoque ou de histórico foi feita por este trabalho.
