# Anotar SKU: processamento assíncrono

A tela registra uma solicitação durável e acompanha seu estado. O cron executa o trabalho sem depender do navegador. O histórico e as exportações CSV, Excel e PDF mantêm o contrato existente; resultados parciais não ficam disponíveis.

As responsabilidades ficam separadas entre contrato/validação, cliente Olist, repositório transacional, serviço de processamento, endpoints e interface. O serviço recebe cliente e repositório por parâmetro, permitindo testar falhas sem serviços externos. As interfaces são específicas deste fluxo; não foi introduzida uma infraestrutura genérica de filas.

## Fluxo e garantias

1. `POST /api/olist/anotar-sku/jobs` valida sessão, permissão de escrita, situações e chave UUID; retorna `202` com o resumo. O aplicativo vem exclusivamente do usuário autenticado.
2. Uma chave identifica a mesma solicitação dentro de aplicativo/usuário. O navegador preserva essa chave se a resposta se perder. Reenviá-la não cria outro trabalho, mesmo após conclusão, cancelamento ou exclusão do resultado.
3. Há uma busca em aberto por aplicativo, inclusive quando está em `FALHOU`. É necessário retomar ou cancelar antes de iniciar outra. Usuários com apenas escrita acompanham e gerenciam somente suas próprias solicitações; leitura e escrita permitem gerenciar as do aplicativo.
4. O cron reserva atomicamente uma etapa por vez (`SKIP LOCKED`), com prazo de 180 segundos e identificador de reserva. Gravações de uma execução antiga ou cancelada são rejeitadas. Trabalho interrompido volta a ficar elegível após expirar.
5. A descoberta percorre páginas de 100 pedidos por situação, com uma segunda passagem de reconciliação. IDs são deduplicados e congelados antes do detalhamento. Cada página e cada pedido têm checkpoint transacional.
6. Pedidos que já têm qualquer item no histórico são ignorados por inteiro, preservando a regra anterior. Quantidades inteiras positivas são somadas por SKU. O título usa o produto final do catálogo, depois o tipo de produto e, na ausência desses, a descrição recebida no pedido da Olist. Esse título fica salvo no checkpoint e no resultado; consulta e exportações preservam o título salvo quando não há título atual no catálogo. Sem título em nenhuma fonte, a tela exibe —. Exclusão do histórico é bloqueada enquanto houver uma busca em aberto.
7. A consolidação publica histórico, itens, contagens e estado final na mesma transação. Uma busca sem novos SKUs conclui sem criar histórico vazio. Cancelamento e conclusão concorrem pelo mesmo bloqueio do aplicativo: um vence integralmente.

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

## Validação local

- `node --import tsx --test tests/anotar-sku.test.ts`: validação de entrada, quantidades, retries, perda de reserva e permissões revogadas.
- `node --import tsx --test tests/anotar-sku-olist.test.ts`: respostas inválidas, paginação, timeout, renovação limitada após 401, classificação HTTP e `Retry-After`, com transporte simulado.
- `ANOTAR_SKU_TEST_DATABASE_URL=postgresql://.../anotar_sku_test node --import tsx --test tests/anotar-sku-database.test.ts`: banco **local, vazio e descartável**; o teste recusa host remoto e nome inesperado. Aplica a migration sobre as tabelas mínimas do domínio e verifica concorrência com conexões reais, RLS/grants, checkpoints, publicação atômica, API e exportações. Sem a variável, esse teste fica explicitamente ignorado.
- A validação de interface usa o componente real e o CSS do projeto, com respostas sintéticas locais. Não equivale a integração com Olist, teste em dispositivo físico ou auditoria completa de acessibilidade.

Verificações realizadas em 16/11/2026: testes unitários e PostgreSQL nativo descartável passaram, incluindo rollback de publicação, disputa real entre conexões, pausa global, ausência de configuração, permissão por aplicativo, retomada após liberação e independência da antiga variável de ambiente. No navegador, foram verificadas larguras efetivas de 361, 389, 769, 1280 e 1440px, ausência de overflow da página, tema claro/escuro, áreas de toque, seleção por teclado, contenção/restauração de foco, Escape, retomada, cancelamento, recuperação após recarregar, falta de conexão, histórico vazio e permissões de leitura/escrita separadas. A prévia reservou no desktop a largura da sidebar; não incluiu uma sessão autenticada no shell completo.

O cron é disparado independentemente da tela. Testes com transporte simulado não comprovam os resultados de uma busca real na Olist.
