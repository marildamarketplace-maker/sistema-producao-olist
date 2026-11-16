# Anotar SKU: processamento assíncrono

A tela registra uma solicitação durável e acompanha seu estado. O cron executa o trabalho sem depender do navegador. O histórico e as exportações CSV, Excel e PDF mantêm o contrato existente; resultados parciais não ficam disponíveis.

## Fluxo e garantias

1. `POST /api/olist/anotar-sku/jobs` valida sessão, permissão de escrita, situações e chave UUID; retorna `202` com o resumo. O aplicativo vem exclusivamente do usuário autenticado.
2. Uma chave identifica a mesma solicitação dentro de aplicativo/usuário. O navegador preserva essa chave se a resposta se perder. Reenviá-la não cria outro trabalho, mesmo após conclusão, cancelamento ou exclusão do resultado.
3. Há uma busca em aberto por aplicativo, inclusive quando está em `FALHOU`. É necessário retomar ou cancelar antes de iniciar outra. Usuários com apenas escrita acompanham e gerenciam somente suas próprias solicitações; leitura e escrita permitem gerenciar as do aplicativo.
4. O cron reserva atomicamente uma etapa por vez (`SKIP LOCKED`), com prazo de 180 segundos e identificador de reserva. Gravações de uma execução antiga ou cancelada são rejeitadas. Trabalho interrompido volta a ficar elegível após expirar.
5. A descoberta percorre páginas de 100 pedidos por situação, com uma segunda passagem de reconciliação. IDs são deduplicados e congelados antes do detalhamento. Cada página e cada pedido têm checkpoint transacional.
6. Pedidos que já têm qualquer item no histórico são ignorados por inteiro, preservando a regra anterior. Quantidades inteiras positivas são somadas por SKU. Exclusão do histórico é bloqueada enquanto houver uma busca em aberto.
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

## Ativação

A implementação vem com `ANOTAR_SKU_ASYNC_ENABLED=false` por padrão. Isto pausa criação, retomada e novas rodadas do worker. Histórico, acompanhamento e cancelamento continuam disponíveis após a migration. Rodadas já em execução não são interrompidas por uma mudança de variável.

1. Revisar e aplicar **somente** `prisma/migrations/20261116214414_anotar_sku_async/migration.sql` no banco de destino, usando o fluxo de migrations aprovado para o ambiente. A migration é aditiva; não modifica buscas anteriores. Não executar `prisma migrate deploy` global: consultar `prisma/migrations/README.md` sobre o histórico parcial do projeto.
2. Publicar a aplicação com o cliente Prisma regenerado (`prisma generate`) e configurar `CRON_SECRET` no servidor.
3. Confirmar suporte e execução do cron `/api/cron/processar-anotar-sku` a cada minuto, já declarado em `vercel.json`. Em infraestrutura diferente, um agendador externo deve chamar esse endpoint com o mesmo segredo. Não é suficiente abrir a tela.
4. Definir `ANOTAR_SKU_ASYNC_ENABLED=true` e publicar essa configuração. Validar uma busca controlada, fechar a tela e verificar a conclusão e o conteúdo exportado.
5. Para pausar, voltar a variável para `false`. Não remover tabelas ou staging. Se for necessário reverter o código, primeiro pausar e encerrar/drenar trabalhos para não executar os caminhos síncrono e assíncrono simultaneamente.

Monitorar respostas do cron, jobs `FALHOU`, reservas expiradas, `proxima_tentativa_em` atrasada e `updated_at` sem progresso. O processamento depende do agendador: a fila sobrevive a indisponibilidade, mas só avança quando ele volta. Nenhum resultado histórico é recriado automaticamente após exclusão.

## Validação local

- `node --import tsx --test tests/anotar-sku.test.ts`: validação de entrada, quantidades, retries, perda de reserva e permissões revogadas.
- `ANOTAR_SKU_TEST_DATABASE_URL=postgresql://.../anotar_sku_test node --import tsx --test tests/anotar-sku-database.test.ts`: banco **local, vazio e descartável**; o teste recusa host remoto e nome inesperado. Aplica a migration sobre as tabelas mínimas do domínio e verifica concorrência com conexões reais, RLS/grants, checkpoints, publicação atômica, API e exportações. Sem a variável, esse teste fica explicitamente ignorado.
- A validação de interface usa o componente real e o CSS do projeto, com respostas sintéticas locais. Não equivale a integração com Olist, teste em dispositivo físico ou auditoria completa de acessibilidade.

Migration, ativação, deploy e validação com Olist de produção são etapas operacionais separadas da implementação local.
