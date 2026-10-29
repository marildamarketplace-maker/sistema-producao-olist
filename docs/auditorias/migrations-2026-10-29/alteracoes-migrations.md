# Reorganização das migrations — 29/10/2026

Solicitação executada somente em arquivos locais: excluir migrations atendidas/superadas e ajustar as parciais. Nenhum SQL foi executado no banco configurado, nenhum registro de `_prisma_migrations` foi alterado e nenhuma movimentação ou dado operacional foi modificado.

> Atualização posterior: as 8 migrations de seed também foram excluídas por solicitação explícita. O estado atual é **25 migrations: 19 corretivas, 5 de revisão de dados e kits**. Os números da primeira etapa abaixo são históricos; o manifesto registra o estado atual.

## Resultado da primeira etapa

| Ação | Quantidade |
|---|---:|
| Excluídas: atendidas | 58 |
| Excluídas: superadas | 7 |
| Ajustadas: correções parciais | 19 |
| Preservadas: revisão de dados | 13 |
| Preservada: kits registrada | 1 |
| Arquivos migration.sql restantes | **33** |

O mapa e as evidências da auditoria permanecem como fotografia histórica **anterior** às alterações dos arquivos. O manifesto `alteracoes-arquivos.json` associa cada classificação à ação realizada e contém SHA-256 antes/depois. O commit de origem é `2626b795cac1d096edad4ee76d4caa116447a6d9`.

## Mudanças nas 19 parciais

Foram removidos CREATE TABLEs já atendidos, backfills, renomeações, alterações de enums, funções antigas e ações de dados que não pertencem às lacunas auditadas. Foram mantidos somente índices ausentes, FKs, defaults, NOT NULL, CHECKs e restrições de acesso. O único CREATE TABLE recupera `turnos_producao`, que estava ausente.

- SQL com schema `public` explícito e transação delimitada; `lock_timeout=5s` e `statement_timeout=120s`.
- Índices IF NOT EXISTS e constraints com guarda por tabela/nome; execução repetida foi conferida no estado esperado. Isso não detecta automaticamente definições conflitantes que alguém crie sob o mesmo nome: reconferir o catálogo antes de aplicar.
- CHECKs/FKs são criados NOT VALID e validados na mesma transação. Falhas de integridade abortam a correção inteira; não apagam nem convertem dados para fazê-la passar.
- Não há CREATE INDEX CONCURRENTLY: índices e validações podem conter escritas durante sua transação. Os testes isolados não medem locks, concorrência ou duração em produção; planejar a aplicação.
- Segurança: RLS habilitada e privilégios revogados de PUBLIC, anon e authenticated nas tabelas servidoras afetadas. A busca de estampas perde somente o grant público/anon, preservando authenticated/service_role e a função atual.
- Preservados BIGINT do catálogo, estados WAITING_PROVIDER, funções de busca/processamento e movimentacao_id anulável para perdas na entrega.
- Defaults de tamanho/produto_olist aparecem em mais de um arquivo por sobreposição histórica; são operações repetíveis e seguras, sem reescrita de dados antigos.

O schema Prisma foi alinhado aos defaults, índices, relações e tabela preparados, incluindo índices únicos parciais. Checks/RLS permanecem no SQL, pois não são representados integralmente pelo schema Prisma. Não usar `db push` como substituto das correções de segurança.

### Exceção: turnos

A migration recupera as colunas utilizadas pela tela legada (`id`, aplicativo, horas, flags e datas), sem inventar horários ou vínculos com solicitações antigas. `aplicativo_id` é obrigatório e não usa o aplicativo padrão como fallback. A tabela fica fechada a acesso direto pelo navegador. O fluxo legado não passará a funcionar apenas aplicando essa estrutura: uma API autenticada deverá ser implementada em escopo próprio. Não foram criadas políticas permissivas ou modificações de interface para contornar essa lacuna.

## Validação

- As **19 correções foram executadas duas vezes somente em PostgreSQL WASM descartável em memória (PGlite já disponível na dependência travada do Prisma)**, sobre fixture que reproduz as lacunas. Nenhuma URL de ambiente é usada por esses testes.
- Conferidos preservação de dados e corpo da função existente, repetibilidade, índices únicos, FKs, CHECKs, NOT NULL, RLS e permissões reais dos papéis de teste.
- Dados inválidos, duplicados e nulos foram injetados apenas na fixture: as correções abortaram e preservaram esses dados, sem efeitos parciais de permissões/RLS.
- Testes antigos passaram a usar fixtures explícitas para estruturas cujas migrations foram excluídas; o teste de direcionamento foi isolado em memória e já não depende de URL externa.
- Suíte completa: **515 testes; 511 aprovados, 4 ignorados por dependerem de bancos externos opcionais; zero falhas**.
- `prisma validate`, `prisma generate`, TypeScript, ESLint dos testes afetados e `git diff --check` sem erros.
- Manifesto conferido: 65 caminhos removidos, 19 hashes atuais de correção, 13 arquivos de dados e kits com os hashes anteriores intactos.

Não houve teste de aplicação no PostgreSQL real, validação de carga, teste de produção nem reconciliação do histórico. **Não executar `migrate deploy` global:** as 13 migrations de revisão continuam pendentes de decisão e algumas não são compatíveis com o schema atual.

## Arquivos ajustados

| Migration | Correção preparada |
|---|---|
| `20260520120000_add_devolucoes` | Tabelas presentes, mas faltam os dois índices de devolução e a FK itens_solicitacao_devolucao.solicitacao_id → solicitacoes_devolucao.id. Nenhum item órfão observado. Corrigir apenas essas lacunas. |
| `20260520143000_add_aplicativo_whitelabel` | Recupera turnos_producao com aplicativo obrigatório, FK/índice e RLS/grants fechados. Não recria as quatro colunas OAuth. Tela legada exige API autenticada em escopo próprio. |
| `20260524210000_add_gerador_csv_olist` | Tabelas, FKs e índices relevantes existem, alguns com nomes gerados pelo Prisma. Faltam defaults de updated_at em tipo_produto, estampa, variante, tamanho e produto_olist. Unicidades antigas de variante e estampa foram substituídas por regras posteriores; não recriar as regras antigas. |
| `20260526122000_add_tamanho_olist` | Tabela tamanho, relação com produto_olist e índices existentes (unicidades com nomes equivalentes). O default de tamanho.updated_at está ausente. CREATE TABLE IF NOT EXISTS não repararia esse default numa tabela já existente. |
| `20260604123000_add_id_cadastro_olist_to_produtos` | produtos.id_cadastro_olist existe, mas idx_produtos_id_cadastro_olist não existe e não há índice equivalente sobre essa coluna. |
| `20260720180000_add_gestao_tarefas_midia` | Tabelas, enums, permissões, FKs e índices presentes; nenhum usuário com categorias habilitadas está sem tarefas habilitadas. dias_semana tem default mas aceita NULL (o SQL exige NOT NULL); zero nulos observados. Colunas link_apoio/link_relacionado foram substituídas por arrays depois. Ajustar apenas a nulabilidade, preservando a evolução dos links. |
| `20260722120000_add_historico_buscas_sku` | Tabelas, FKs e índices presentes. buscas_sku.situacoes tem default mas aceita NULL; a migration exige NOT NULL. Zero nulos observados. Ajuste pontual de nulabilidade, sem recriar as tabelas. |
| `20260816120000_restore_produto_olist_updated_at_default` | produto_olist.updated_at segue sem default. É uma alteração específica ainda necessária se preservado o contrato declarado pela migration. |
| `20260827110000_add_estampa_ai_catalog_fields` | Campos IA, check de status e índices auxiliares presentes na tabela legada estampa, ainda usada pelo gerador CSV. Faltam os dois índices únicos parciais de código/variante; zero grupos duplicados observados. Não criar o índice antigo global de código. |
| `20260828200000_align_jobs_with_estampas_catalog` | BIGINT e busca no catálogo estampas já atendidos; corpo da função atual coincide com esta versão. Falta FK estampa_jobs.estampa_id → estampas.id (zero órfãos). A rotina inteira abortaria porque há 56.755 jobs; corrigir apenas a FK. EXECUTE da busca está concedido a anon; o SQL só revoga PUBLIC e exige ajuste específico para eliminar grant explícito a anon. |
| `20260829010000_add_estampas_admin_search_indexes` | Cinco dos oito índices estão presentes. Faltam idx_estampas_status_created_at, idx_estampas_elementos_visuais_gin e idx_estampas_ocasioes_gin. Há índices GIN redundantes de categorias/cores sob nomes diferentes; não criar mais duplicatas. |
| `20260831190000_add_estampa_ai_batches` | Batch, enum WAITING_PROVIDER e função final de preservação estão atendidos. Falta uq_estampa_jobs_provider_custom_id (parcial para não nulos); não há duplicatas não nulas observadas. Criar só o índice faltante, sem sobrescrever a função nem recriar a tabela. |
| `20261002120000_add_notification_queue` | Tabela e índices presentes. Faltam notification_tentativas_check, RLS e revogação de permissões anon/authenticated; ambos têm SELECT/INSERT/UPDATE/DELETE. Zero tentativas negativas observadas. Prioridade de segurança; não recriar a tabela. |
| `20261009150000_acesso_pagina_usuario` | Tabela, PK e FK presentes; faltam CHECK acessos>0, RLS e revogações de anon/authenticated. Zero acessos não positivos observados. Prioridade de segurança. |
| `20261016160000_evidencia_confirmacao_producao` | Três colunas de evidência presentes, mas CHECK solicitacoes_producao_evidencia_completa ausente. Nenhuma linha parcialmente preenchida observada. |
| `20261016170000_pedido_fornecedor_queue` | Fila, FKs/índices e unicidade por índice equivalente presentes. RLS desabilitada e grants anon/authenticated continuam ativos. Prioridade de segurança; corrigir acesso sem recriar a fila. |
| `20261016190000_direcionamento_fila_fornecedor` | Campos/FKs/índices presentes, mas faltam os checks direcionamento_completo e versao_valida. Zero direcionamentos incompletos ou versões negativas observados. |
| `20261021013941_retorno_estoque_olist` | Tabelas, FKs e índices de retorno presentes. Faltam CHECK quantidade>0, RLS e revogações em ambas; anon/authenticated têm grants ativos. Zero quantidades não positivas observadas. Não reaplicar CREATE TABLE; corrigir apenas proteções faltantes. movimentacao_id anulável é evolução posterior intencional. |
| `20261028150000_variantes_permitidas_jobs` | variantes_permitidas existe com default array vazio, mas aceita NULL, enquanto a migration exige NOT NULL. Zero nulos observados; ajustar apenas a nulabilidade. |

## Migrations excluídas

- `20260519212000_add_minimo_estoque_to_produtos`
- `20260520150000_add_usuario_permissoes`
- `20260526110000_associate_variante_estampa`
- `20260526113000_add_estampa_extra`
- `20260526124000_associate_variante_tamanho`
- `20260527120000_add_tipo_produto_prompt_ia`
- `20260604120000_add_produto_relation_to_produto_olist`
- `20260609190000_add_fornecedores`
- `20260609193000_add_produtos_fornecedor`
- `20260609194500_add_tipo_produto_produtos_fornecedor`
- `20260609200000_add_tamanho_produtos_fornecedor`
- `20260610103000_add_tamanho_quantidade_produto_fornecedor`
- `20260610120000_add_medidas_produtos_fornecedor`
- `20260621120000_add_estampa_imagem_url`
- `20260713120000_add_tipo_produto_corte_laser_tecido_corrido`
- `20260714120000_add_controle_midia`
- `20260715120000_add_usuario_permissoes_telas`
- `20260715130000_scope_olist_token_by_aplicativo`
- `20260715140000_add_usuario_vendedor_olist_id`
- `20260715141000_add_usuario_permissoes_olist`
- `20260715160000_add_fornecedor_vendedor_olist_id`
- `20260715161000_add_fornecedor_meu_cliente_olist_id`
- `20260715162000_add_pedido_fornecedor_solicitacao`
- `20260715230000_add_usuario_permissoes_tipos_produto`
- `20260715231000_add_usuario_permissoes_tamanhos`
- `20260715232000_add_usuario_permissoes_estampas`
- `20260715233000_add_usuario_permissoes_variantes`
- `20260716120000_add_tipo_servico_produto_fornecedor`
- `20260716150000_add_usuario_permissoes_formas_pagamento_recebimento`
- `20260716170000_add_planos_pagamento_olist`
- `20260716172000_add_tipo_venda_enum`
- `20260716173000_add_fornecedor_meu_forma_pagamento_olist_id`
- `20260716174000_add_fornecedor_tipo_venda_plano_pagamento`
- `20260720210000_add_controle_midia_produtos`
- `20260722130000_add_titulo_produto_itens_busca_sku`
- `20260722140000_add_permissoes_anotar_sku`
- `20260823120000_allow_cor_por_tamanho`
- `20260827120000_add_estampa_jobs`
- `20260827130000_prevent_duplicate_active_estampa_jobs`
- `20260828120000_add_estampa_job_retry_backoff`
- `20260828130000_add_manual_estampa_reprocessing`
- `20260828140000_add_estampa_full_text_search`
- `20260829020000_fix_estampas_processing_status_trigger`
- `20260829030000_fix_estampas_full_text_dictionary`
- `20260829040000_add_estampa_image_presentation`
- `20260829050000_normalize_estampas_taxonomies`
- `20260830010000_reuse_single_estampa_job`
- `20260831010000_add_estampa_search_segmentation`
- `20261002130000_add_whatsapp_to_aplicativo`
- `20261002140000_add_jobs_to_aplicativo`
- `20261003160000_expand_aplicativo_whatsapp_list`
- `20261008120000_estampa_job_modelo_utilizado`
- `20261008130000_configuracoes_jobs`
- `20261008140000_termos_ignorados_nome_arquivo`
- `20261008150000_preservar_search_vector`
- `20261008160000_adicionar_moclkup_exclusao`
- `20261016180000_add_aplicativo_pai`
- `20261016200000_fornecedor_aplicativo_pai`
- `20261016210000_permissao_fila_pedidos`
- `20261016220000_status_fila_fornecedor`
- `20261016230000_renomear_status_fila_fornecedor`
- `20261017000000_add_aplicativo_descricao`
- `20261017000000_envio_manual_fila_fornecedor`
- `20261017010000_permissao_selecionar_filial_fornecedor`
- `20261021140000_retorno_perdido_entrega`

## Referências técnicas

- [PostgreSQL 17 — ALTER TABLE, NOT VALID e validação de constraints](https://www.postgresql.org/docs/17/sql-altertable.html).
- [Prisma 7 — índices e índices parciais](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes).

## Segunda etapa: remoção dos seeds

Oito migrations de seed foram excluídas sem executar SQL e sem apagar dados já existentes. As outras cinco migrations de revisão foram preservadas. Total acumulado: 73 excluídas, 19 ajustadas, 5 de revisão preservadas e kits preservada; 25 arquivos ativos.

- `20260716171000_seed_formas_pagamento_planos`
- `20260721100000_seed_tarefas_midia_operacao`
- `20260721110000_seed_tarefa_semanal_oferta_relampago`
- `20260721120000_seed_tarefa_quinzenal_google_storage`
- `20260721130000_seed_tarefas_mensais_financeiro`
- `20260721150000_seed_tarefa_quinzenal_novos_produtos`
- `20260721160000_seed_tarefa_semanal_devolucoes`
- `20260721170000_seed_tarefas_mensais_cancelamento_notas`

As validações de 515 testes descritas acima referem-se à primeira etapa. Na segunda etapa foi conferida a integridade do manifesto e executada novamente a suíte isolada das correções, sem conexão ao banco de produção.
