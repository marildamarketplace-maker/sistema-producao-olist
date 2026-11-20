# Anotar SKU: processamento assíncrono

A tela registra uma solicitação durável e acompanha seu estado. O cron executa o trabalho sem depender do navegador. O histórico e as exportações CSV, Excel e PDF mantêm o contrato existente; resultados parciais não ficam disponíveis.

Ao abrir uma busca salva ou exportar CSV, Excel ou PDF, os SKUs aparecem pela quantidade total da maior para a menor, depois de somar os itens de todos os pedidos da busca. Empates preservam a ordenação por título e SKU (com comparação numérica e títulos ausentes por último). A regra também vale para buscas anteriores, sem executar novamente a consulta na Olist ou alterar os dados salvos. A ordenação usa os dados já carregados; não acrescenta consultas nem volume transferido.

As responsabilidades ficam separadas entre contrato/validação, cliente Olist, repositório transacional, serviço de processamento, endpoints e interface. O serviço recebe cliente e repositório por parâmetro, permitindo testar falhas sem serviços externos. As interfaces são específicas deste fluxo; não foi introduzida uma infraestrutura genérica de filas.

## Fluxo e garantias

1. `POST /api/olist/anotar-sku/jobs` valida sessão, permissão de escrita, situações e chave UUID; retorna `202` com o resumo. O aplicativo vem exclusivamente do usuário autenticado.
2. Uma chave identifica a mesma solicitação dentro de aplicativo/usuário. O navegador preserva essa chave se a resposta se perder. Reenviá-la não cria outro trabalho, mesmo após conclusão, cancelamento ou exclusão do resultado.
3. Há uma busca em aberto por aplicativo, inclusive quando está em `FALHOU`. É necessário retomar ou cancelar antes de iniciar outra. Usuários com apenas escrita acompanham e gerenciam somente suas próprias solicitações; leitura e escrita permitem gerenciar as do aplicativo.
4. O cron reserva atomicamente uma etapa por vez (`SKIP LOCKED`), com prazo de 180 segundos e identificador de reserva. Gravações de uma execução antiga ou cancelada são rejeitadas. Trabalho interrompido volta a ficar elegível após expirar.
5. A descoberta percorre páginas de 100 pedidos por situação, com uma segunda passagem de reconciliação. IDs são deduplicados e congelados antes do detalhamento. Cada página e cada pedido têm checkpoint transacional.
6. Pedidos que já têm qualquer item no histórico são ignorados por inteiro, preservando a regra anterior. Quantidades inteiras positivas são somadas por SKU. O título usa o produto final do catálogo, depois o tipo de produto e, na ausência desses, a descrição recebida no pedido da Olist. Esse título fica salvo no checkpoint e no resultado; consulta e exportações preservam o título salvo quando não há título atual no catálogo. Sem título em nenhuma fonte, a tela exibe —. Exclusão do histórico é bloqueada enquanto houver uma busca em aberto.
7. A consolidação publica histórico, itens, contagens e estado final na mesma transação. Uma busca sem novos SKUs e sem alertas conclui sem criar histórico vazio. Se houver pedidos fora do período, o resultado é salvo mesmo com zero SKUs, para permitir a conferência do alerta. Cancelamento e conclusão concorrem pelo mesmo bloqueio do aplicativo: um vence integralmente.

Não existe garantia de snapshot da Olist: pedidos podem mudar de situação durante a paginação. A segunda passagem reduz omissões por deslocamento de páginas, mas não elimina alterações concorrentes na origem. O resultado representa os pedidos encontrados nas duas passagens.

## Falhas e segurança

- Rede, timeout, HTTP 408, 429 e 5xx: até cinco tentativas por **etapa**, com atrasos de 1, 2, 4 e 8 minutos, pequena variação aleatória e respeito a `Retry-After`. Etapas concluídas zeram o contador. Uma rodada de cron sem trabalho não consome tentativas.
- Autorização da integração e respostas inválidas exigem intervenção. Há no máximo uma renovação OAuth após HTTP 401 por operação; retries transitórios pertencem à fila.
- `FALHOU` preserva checkpoints; retomar zera tentativas da etapa. Cancelar invalida a reserva e não publica o staging.
- O worker revalida usuário ativo, aplicativo e permissão de escrita a cada etapa. Uma solicitação cujo autor perdeu acesso precisa ser cancelada e recriada por usuário autorizado.
- Novas tabelas com RLS e sem grants para `anon`/`authenticated`; acesso pelo servidor. A relação pedido/job inclui o aplicativo. Nenhum segredo OAuth, payload bruto da Olist ou dados pessoais entra no resumo do job.
- Cron exige `Authorization: Bearer <CRON_SECRET>`, inclusive rejeitando configuração ausente. Logs registram contagens e tipos de falha, sem credenciais.
- O endpoint síncrono antigo responde `409` pedindo atualização da página, evitando que abas antigas interpretem uma busca enfileirada como resultado vazio.

## Interface

- A tela consulta andamento a cada 10 segundos com busca aberta e a cada 30 segundos sem busca aberta, somente quando visível. Consultar não dispara processamento. O histórico recarrega na primeira leitura, em conclusão/remoção detectada ou por atualização manual.
- Estados de fila, processamento, retry, falha, cancelamento e conclusão são explícitos. A descoberta não apresenta uma porcentagem falsa; o detalhamento mostra pedidos conferidos/total e já registrados.
- No mobile, a busca em andamento aparece antes do formulário. Botões têm alvo mínimo de 44px; tabelas ficam em uma região com rolagem horizontal contida e acessível pelo teclado.
- Diálogos têm foco inicial, contenção, Escape e restauração de foco. Erros preservam situações selecionadas; resposta de criação incerta mantém a chave para confirmação sem duplicação.
- Critérios de aceite: iniciar com filtros válidos, recuperar envio incerto após recarregar, acompanhar após sair/voltar, retomar falha, cancelar com confirmação e acessar resultados/exportações em desktop e mobile, nos dois temas.

## Ativação e pausa pelo banco

Não há variável de ambiente para habilitar o recurso. São necessários dois controles:

- Permissão `ANOTAR_SKU` em `aplicativo.jobs` (lista separada por vírgulas, como os demais crons). Ausência da chave bloqueia criação/retomada e impede o worker de reservar trabalhos daquele aplicativo, inclusive reservas expiradas.
- Registro `chave = 'processar-anotar-sku'` em `configuracoes_jobs`, com `pausado = false`. Registro ausente ou pausado interrompe novas reservas em todos os aplicativos.

A pausa é conferida na entrada do cron e novamente a cada reserva. Uma etapa já reservada pode terminar; as seguintes aguardam a liberação, preservando checkpoints e tentativas. Histórico, acompanhamento, cancelamento e recuperação idempotente de uma solicitação existente permanecem disponíveis. A tela distingue pausa global de falta de permissão do aplicativo.

`CRON_SECRET` continua obrigatório apenas para autenticação do agendador. A antiga variável `ANOTAR_SKU_ASYNC_ENABLED` é ignorada e pode ser removida.

1. Revisar e aplicar **somente** `prisma/migrations/20261116214414_anotar_sku_async/migration.sql` no banco de destino, usando o fluxo de migrations aprovado para o ambiente. A migration é aditiva; não modifica buscas anteriores. Não executar `prisma migrate deploy` global: consultar `prisma/migrations/README.md` sobre o histórico parcial do projeto.
2. Publicar a aplicação com o cliente Prisma regenerado (`prisma generate`) e configurar `CRON_SECRET` no servidor.
3. Confirmar suporte e execução do cron `/api/cron/processar-anotar-sku` a cada minuto, já declarado em `vercel.json`. Em infraestrutura diferente, um agendador externo deve chamar esse endpoint com o mesmo segredo. Não é suficiente abrir a tela.
4. Criar o registro de controle e liberar somente os aplicativos desejados. Essas alterações passam a valer no próximo ciclo, sem novo deploy:

   ```sql
   INSERT INTO configuracoes_jobs (chave, pausado)
   VALUES ('processar-anotar-sku', false)
   ON CONFLICT (chave) DO NOTHING;
   ```

   Acrescentar `ANOTAR_SKU` à lista `aplicativo.jobs` do aplicativo autorizado, preservando as outras permissões e evitando duplicação. Cada aplicativo depende de sua própria liberação explícita; a pausa global não concede permissões.
5. Para pausar todos os aplicativos, definir `pausado = true` no registro `processar-anotar-sku`. Para suspender apenas um aplicativo, retirar sua permissão `ANOTAR_SKU`. Não remover tabelas ou staging. Ao reativar, os trabalhos pendentes seguem do último checkpoint, sem retomada manual. `FALHOU` continua exigindo retomada explícita.
6. Validar uma busca controlada, fechar a tela e verificar a conclusão e o conteúdo exportado. Se for necessário reverter para código anterior a esse controle, primeiro pausar e encerrar/drenar trabalhos para não executar os caminhos síncrono e assíncrono simultaneamente.

Monitorar respostas do cron, jobs `FALHOU`, reservas expiradas, `proxima_tentativa_em` atrasada e `updated_at` sem progresso. O processamento depende do agendador: a fila sobrevive a indisponibilidade, mas só avança quando ele volta. Nenhum resultado histórico é recriado automaticamente após exclusão.

### Tabelas e ordenação por coluna

**Ver SKUs** e **Relatório IA** usam `TabelaSkus`, com cabeçalhos clicáveis,
indicador de direção, `aria-sort`, foco visível e rolagem horizontal contida no
celular. Ambos abrem por quantidade decrescente. Colunas textuais começam em ordem
crescente; clicar novamente inverte a direção. **Ver SKUs** mantém o acesso aos
pedidos de cada SKU e a ordenação ao voltar desses detalhes.

Em **Ver SKUs**, o contrato existente já entrega o resultado completo: ordenar
reaproveita esses dados sem outra consulta e sem alterar o array original. Os
arquivos da busca continuam no padrão de quantidade decrescente. No relatório IA,
a ordenação ocorre no banco antes da paginação, reinicia na primeira página ao
mudar o critério e também vale para os arquivos exportados. Reabrir qualquer uma
das tabelas restaura o padrão. Esta mudança não requer migration adicional.

Egress: zero requisições adicionais ao ordenar os SKUs já carregados. No relatório
IA, cada clique consulta somente a página de até 50 linhas, com as mesmas projeções
e verificações de autorização; não busca todos os lotes no servidor da aplicação
nem cria polling. A consulta SQL ordena os resultados dentro do banco. O volume
adicional depende dos cliques e do tamanho dos textos; não foi medido faturamento.

Validação da ordenação: 55 testes aprovados (46 de regras/API/SQL em PostgreSQL
WASM e 9 de navegador), TypeScript, lint do escopo e build. No Chrome com dados
fictícios, foram conferidas 360/390/1280/1440px em claro/escuro, todas as colunas,
direções, paginação global, teclado/toque emulado, erro/retry, navegação para os
pedidos e ausência de novas consultas ao ordenar os SKUs completos. Capturas de
390px escuro e 1440px claro foram inspecionadas. Sem teste em dispositivo físico
ou publicação em produção; o build mantém avisos preexistentes fora do escopo.

### Relatório IA automático (opcional)

A engrenagem do relatório IA permite salvar **Gerar relatório IA automaticamente**
por aplicativo. Ao concluir uma busca com SKUs, o servidor registra a solicitação
IA na mesma transação do resultado, mesmo com navegador fechado ou VM offline.
Buscas sem SKUs (incluindo resultados somente com alertas) não solicitam relatório;
buscas anteriores não são reprocessadas. As permissões do solicitante e a proteção
contra duplicidade continuam obrigatórias. A falha de gravação desfaz a conclusão
inteira para permitir sua retomada, sem deixar relatório órfão.

Para evitar inversão com a exclusão de resultados, a consolidação adquire o lock
IA do aplicativo antes do lock da linha do aplicativo e da reserva da busca.
Exige a migration aditiva `20261120222700_relatorio_ia_automatico` antes do backend;
não exige outro worker ou mudanças nas variáveis da VM. Ativação, limites da fila
automática e contratos estão em [Trabalhos IA](trabalhos-ia.md#solicitação-automática-após-a-busca).

## Validação local

- `node --import tsx --test tests/anotar-sku.test.ts`: validação de entrada, quantidades, retries, perda de reserva e permissões revogadas.
- `node --import tsx --test tests/anotar-sku-olist.test.ts`: respostas inválidas, paginação, timeout, renovação limitada após 401, classificação HTTP e `Retry-After`, com transporte simulado.
- `ANOTAR_SKU_TEST_DATABASE_URL=postgresql://.../anotar_sku_test node --import tsx --test tests/anotar-sku-database.test.ts`: banco **local, vazio e descartável**; o teste recusa host remoto e nome inesperado. Aplica a migration sobre as tabelas mínimas do domínio e verifica concorrência com conexões reais, RLS/grants, checkpoints, publicação atômica, API e exportações. Sem a variável, esse teste fica explicitamente ignorado.
- A validação de interface usa o componente real e o CSS do projeto, com respostas sintéticas locais. Não equivale a integração com Olist, teste em dispositivo físico ou auditoria completa de acessibilidade.

Verificações realizadas em 16/11/2026: testes unitários e PostgreSQL nativo descartável passaram, incluindo rollback de publicação, disputa real entre conexões, pausa global, ausência de configuração, permissão por aplicativo, retomada após liberação e independência da antiga variável de ambiente. No navegador, foram verificadas larguras efetivas de 361, 389, 769, 1280 e 1440px, ausência de overflow da página, tema claro/escuro, áreas de toque, seleção por teclado, contenção/restauração de foco, Escape, retomada, cancelamento, recuperação após recarregar, falta de conexão, histórico vazio e permissões de leitura/escrita separadas. A prévia reservou no desktop a largura da sidebar; não incluiu uma sessão autenticada no shell completo.

O cron é disparado independentemente da tela. Testes com transporte simulado não comprovam os resultados de uma busca real na Olist.

## Período dos SKUs e pedidos fora do período

Novas buscas consultam **todos** os pedidos de cada situação selecionada, sem enviar `dataInicial` ou `dataFinal` à Olist. A lista de situações e a seleção inicial Aberta permanecem iguais: o contrato de pedidos da Olist não contém situação ou parâmetro “ativo”. O período padrão inclui hoje e os 14 dias anteriores no calendário de São Paulo; a tela apresenta ambas as datas no início do formulário, sem botão de restauração. O servidor valida datas reais, ordem, limite de 366 dias e ausência de data final futura.

O período fica congelado no aceite durável da solicitação e permanece nas retomadas, reenvios da mesma chave e resultado salvo. Clientes anteriores que não enviam datas recebem o padrão no servidor. Jobs/históricos anteriores, com datas nulas, preservam o comportamento anterior e são identificados na tela como buscas sem corte por data.

A classificação usa exclusivamente `dataCriacao` da listagem, conforme o [contrato oficial da API V3](https://erp.tiny.com.br/public-api/v3/swagger/swagger.json). Não usa a data comercial do detalhe do pedido como substituta. As duas datas limite são inclusivas. Data de criação ausente/inválida em uma nova busca interrompe a etapa sem gravar uma página parcial, para não publicar quantidades com classificação incerta.

Pedidos fora do período ficam no staging com data e marcador de exclusão, já conferidos e sem baixar seus itens. O fim da paginação depende da página original de até 100 pedidos, mesmo quando todos são antigos. IDs repetidos entre situações/passagens contam uma vez. Pedidos dentro do período continuam sujeitos à regra existente de não repetir pedidos já anotados em outro resultado.

O resultado separa os totais de SKUs do alerta de pedidos excluídos. O alerta abre uma lista de IDs clicáveis na Olist com a data de criação, sem outro modal sobreposto. `GET /api/olist/anotar-sku/[id]/fora-periodo` exige sessão/permissão de leitura, valida aplicativo, busca e cursor, retorna no máximo 50 pedidos e só seleciona ID/data. A interface carrega mais páginas sob demanda e reaproveita páginas apenas enquanto aquele resultado estiver aberto na sessão. Exportações continuam contendo somente SKUs incluídos; botões de exportação ficam desabilitados em resultados sem SKUs.

Egress: a descoberta mantém as duas passagens existentes; esta mudança não reduz as páginas de listagem. Evita uma consulta de detalhe por pedido fora do período que seria detalhado anteriormente. Acrescenta datas/contadores pequenos aos resumos e ID/data somente quando o usuário abre o alerta. Não há estimativa monetária nem medição de faturamento do provedor.

Migração aditiva: `prisma/migrations/20261118001325_anotar_sku_periodo_alertas/migration.sql`. Aplicar somente essa migração em ambientes com a fila existente, antes de publicar o novo cliente Prisma. Não executar o histórico global de migrations. Ela preserva dados anteriores e não altera RLS, permissões ou a configuração do cron.

Testes adicionais: `tests/anotar-sku-periodo.test.ts` cobre calendário, virada de dia, ano bissexto, datas inválidas e limites; `tests/anotar-sku-database.test.ts` cobre paginação com página inteira antiga, limites inclusivos, exclusão dos SKUs/exportações, resultado só com alertas, retomada, idempotência do período, ausência de data e autorização/projeção do endpoint de alertas. Os clientes externos são simulados; não se executa uma busca real na Olist para validar o código.

Validação desta alteração em 17/11/2026: 37 testes passaram (27 com o fluxo de fila/banco/API e 10 de contratos, datas e consultas); TypeScript, lint do escopo e build passaram. O build mantém avisos preexistentes de imagens/variável não utilizada em outros módulos. Na prévia com componentes/CSS reais e dados fictícios, foram conferidos 361/389px e 1280/1440px, temas claro/escuro, ausência de overflow da página, edição/limpeza/restauração de datas, bloqueio de envio inválido, aceite e persistência após reload, alerta sem SKUs, links e datas, paginação 50+3, cache ao voltar, erro/retry, foco, Escape e contenção de tabulação. Não equivale a teste em dispositivo físico ou busca real na Olist.

No ambiente remoto, as novas colunas, constraints e índice foram confirmados presentes; não foi necessário reaplicar a migração. A produção foi confirmada READY no commit `25816159cd7faa47f9df84ddc9794586cb5ed192`. A busca que já estava em andamento continuava com período nulo, preservando o contrato anterior; o corte se aplica às novas solicitações.

Risco preexistente identificado na conferência de segurança do banco: `buscas_sku` e `itens_busca_sku` estão sem RLS e com SELECT concedido a `anon` e `authenticated`. A autorização dos endpoints não protege o acesso direto a essas tabelas pela Data API. As tabelas da fila, inclusive os IDs do novo alerta, têm RLS e não concedem acesso direto a esses papéis. A correção das permissões antigas precisa avaliar os consumidores diretos existentes; esta alteração não modificou esses grants. Referência: [RLS desabilitada em tabelas públicas](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
