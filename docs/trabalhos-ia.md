# Trabalhos Codex e relatório de SKUs

O primeiro consumidor do núcleo `src/lib/trabalhos-ia` é `anotar_sku.relatorio.v1`.
A aplicação aceita uma solicitação durável com HTTP 202; o processo
`scripts/trabalhos-ia-worker.ts` executa geração e revisão em chamadas separadas.
As rotinas antigas mantêm fila, worker, contratos e notificações existentes.

## Fluxo e contratos

1. `POST /api/olist/anotar-sku/:id/relatorio-ia`, corpo `{chave: UUID}`:
   autentica, autoriza leitura e escrita, verifica origem e consumidor compatível,
   congela os prompts fixos/personalizados e devolve `trabalho` e `statusUrl`.
2. `PREPARAR`: páginas de até 50 SKUs e 64 KiB. Agrega quantidades no banco,
   escolhe título do cadastro Olist, tipo de produto ou título salvo no pedido,
   nessa ordem. Não consulta a Olist nem envia dados de clientes ao Codex.
3. `GERAR`: worker recebe apenas contrato de saída, prompt composto e reserva.
   SKU, título e quantidade constituem a entrada; comandos presentes nos títulos
   são tratados como dados. O executor não recebe a credencial HTTP do worker.
4. `REVISAR`: nova chamada ao Codex recebe a entrada original, candidato e regras.
   O servidor valida novamente cardinalidade, unicidade, ids, limites de texto e
   presença literal da evidência no título. O modelo não devolve quantidades:
   elas são recompostas a partir da entrada original.
5. `PUBLICAR`: só após todos os lotes revisados. A interface oferece a versão
   concluída, ordenada por quantidade decrescente, produto e SKU. Uma geração nova
   não remove a anterior. Os downloads originais da busca continuam separados.

`GET /api/trabalhos-ia?tipo=...&origem=...` aceita até 50 origens e retorna somente
o último trabalho e o último concluído de cada origem. `GET /api/trabalhos-ia/:id`
consulta metadados; `PATCH` aceita `cancelar` ou `retomar` (apenas falhas).
O relatório é lido em páginas de 50: `GET /api/olist/anotar-sku/:id/relatorio-ia`,
com `trabalho` opcional e `offset`. Fixe `trabalho` durante a paginação/download.
CSV, XLSX e PDF usam `formato`; a exportação síncrona é limitada a 10.000 linhas
e 4 MB, com leitura de 500 linhas por consulta. Para volumes superiores, o
relatório continua consultável na tela; exportações maiores deverão ganhar
armazenamento e produção assíncrona antes de aumentar esses limites.

Configuração: `GET/PUT /api/olist/anotar-sku/configuracao-ia`. A engrenagem exige
leitura do módulo e `podeEditarConfiguracao`; escrita requer revisão otimista.
O texto livre tem até 8.000 caracteres e vale para novos trabalhos. Padrão:
Oxford → Oxford; Sedinha/Fourway → Fourway; Tricoline → Tricoline. Sem evidência
suficiente: `NÃO IDENTIFICADO`. O resumo preserva kit e medidas; Qtd é a quantidade
dos pedidos e nunca o número de peças multiplicado pelo kit. Revisão por IA e
evidência literal reduzem erros; não provam que um título comercial esteja correto.

## Concorrência, recuperação e segurança

- Um trabalho ativo por origem/tipo/aplicativo, até 20 ativos por aplicativo.
  Chave de idempotência por aplicativo e solicitante; duplo clique não duplica
  trabalho. A UI preserva a chave enquanto não recebe confirmação.
- Uma etapa em execução por aplicativo e por `grupo` de workers. Use o mesmo
  grupo em processos que compartilham capacidade. Adicione grupos/VMs conforme
  necessidade; a política por aplicativo permanece serial. O grupo não inclui
  o worker antigo de rotinas, portanto ambos podem executar simultaneamente.
- Reserva de 60 s, renovação a cada 15 s, chamada Codex limitada a 300 s.
  Perda de reserva, cancelamento ou encerramento do serviço abortam o subprocesso.
  Confirmação repetida da mesma reserva não repete a publicação.
- Até três tentativas por etapa/lote, com espera de 60/120/240 s. Expiração
  conta como tentativa. Erro de autenticação/configuração ou revogação de acesso
  encerra o trabalho com falha. Retomada explícita reutiliza prompts e progresso;
  para aplicar regras novas, gere outro relatório.
- Autorização revalidada no servidor antes de execução, renovação e conclusão.
  Tokens de worker delimitam aplicativo, tipos e grupo. URLs não são recebidas
  como destino do cliente; redirects HTTP do worker são recusados.
- RLS e revogação de acesso direto para `anon`/`authenticated` nas tabelas IA.
  O backend usa a conexão privilegiada existente com filtro explícito de escopo.
  FK composta impede associação cruzada de relatório e busca. Exclusão da busca
  recusa IA ativa e remove histórico/entradas/resultados associados após encerrar.
- Dados sensíveis, prompts, respostas brutas e credenciais não vão aos logs.
  CSV neutraliza fórmulas e XLSX grava textos como `inlineStr`. A tela usa texto
  React, sem HTML do modelo. Diretórios temporários do executor são removidos.

## Adicionar um tipo de trabalho

Implemente `TipoTrabalhoIa`, registre em `runtime.ts` e autorize o novo tipo na
credencial e no anúncio de capacidades do worker. O tipo define autorização,
origem, preparação paginada, contrato, prompts fixos, validação e publicação.
Crie a API/UI do domínio para preparar dados confiáveis: o browser nunca envia
um prompt de sistema, ferramentas ou comandos arbitrários para execução.

O núcleo sempre percorre geração → revisão → publicação, inclusive para novos
tipos. Versione a chave ao mudar entrada/saída ou semântica; mantenha a versão
anterior registrada enquanto houver trabalhos pendentes dela. `publicar` deve
alterar apenas o banco da transação e ser idempotente. Ações externas futuras
precisam de etapa/outbox própria e deduplicação de efeito antes de serem liberadas.
Este executor atende texto/dados fornecidos pela aplicação; pesquisas externas
exigem um adaptador com fontes e ferramentas explicitamente autorizadas.

Separação aplicada: núcleo orquestra; domínio monta/valida dados; executor chama
Codex; UI acompanha. SQL/executor injetáveis permitem testar sem provedor real.
O segundo tipo usado nos testes passa pelo mesmo contrato e pela revisão sem
alterar o núcleo. Essa separação atende SOLID com funções e interfaces pequenas.

## Implantação (não executada pelos testes)

Para a VM que já usa `bash iniciar-worker.sh`, mantenha esse comando. Depois de
preparar o backend e a credencial abaixo, acrescente `TRABALHOS_IA_WORKER_TOKEN`
ao `~/.config/meury-worker/worker.env`. O iniciador atualizado abre Rotinas e IA
no mesmo terminal, reaproveitando URL, versão, CLI e sessão existentes; Ctrl+C
encerra ambos. Sem a credencial, continua abrindo somente Rotinas. A preparação
da instalação e o lock do iniciador permanecem. Consulte também `worker.md`.
O supervisor apenas controla processos locais, sem egress adicional. O tráfego
do novo consumidor começa quando IA é habilitada, conforme os limites abaixo.

O arquivo de ambiente separado e o serviço systemd descritos nos passos 3 e 4
são uma alternativa para quem quiser iniciar IA automaticamente com a VM.
Não execute o consumidor IA pelo serviço e pelo iniciador ao mesmo tempo.

1. Conferir backup, migrations pendentes e tamanho de `itens_busca_sku` em
   homologação. A migration `20261120210023_trabalhos_ia` cria as tabelas, índices,
   RLS e proteção de exclusão. O índice da tabela existente não é concorrente:
   planejar janela se ela for grande; `lock_timeout=5s` evita espera prolongada.
   Aplicar a migration antes do novo backend. Não usar `db push` em produção.
2. Publicar o backend e configurar `TRABALHOS_IA_WORKERS` como JSON no servidor:

   ```json
   [{"id":"vm-ia-1","aplicativoId":"UUID_DO_APLICATIVO","tokenSha256":"SHA256_HEX_DA_CREDENCIAL","tipos":["anotar_sku.relatorio.v1"],"grupo":"vm-principal"}]
   ```

   Gere uma credencial aleatória de 256 bits por worker. Guarde somente seu hash
   no servidor e o valor bruto no arquivo privado da VM. A lista é separada de
   `AUTOMATIZACAO_WORKERS`, para permitir revogar IA sem interromper rotinas.
3. Atualizar o checkout e dependências da VM com `pnpm install --frozen-lockfile`.
   No arquivo `/home/operador/.config/meury-worker/trabalhos-ia.env`, modo 600:

   ```dotenv
   TRABALHOS_IA_ERP_URL=https://sistema.meuryshop.com.br
   TRABALHOS_IA_WORKER_TOKEN=CREDENCIAL_BRUTA
   AUTOMATIZACAO_CODEX_VERSION=VERSAO_EXATA_JA_VALIDADA
   CODEX_CLI_PATH=/CAMINHO/DO/codex
   # Opcional: mesmo CODEX_HOME privado usado pela conta do serviço.
   # CODEX_HOME=/home/operador/.codex
   TRABALHOS_IA_TIPOS=anotar_sku.relatorio.v1
   ```

   A URL também pode reutilizar `AUTOMATIZACAO_ERP_URL`. O token é sempre próprio
   de IA. O CLI é verificado contra a versão fixada antes de consumir a fila;
   sem configuração válida o serviço sai com erro. Login ChatGPT deve existir
   para o usuário do serviço (`codex login status`). O executor reaproveita a
   sessão, ignora configurações pessoais, desliga shell, busca web, apps, plugins,
   memória, múltiplos agentes e geração de imagem; não habilita browser/MCP.
4. Adaptar usuário/caminhos em `docs/systemd/meury-trabalhos-ia.service` à VM.
   Depois de revisar o ambiente, instalar e iniciar o serviço novo:

   ```sh
   sudo install -m 644 docs/systemd/meury-trabalhos-ia.service /etc/systemd/system/meury-trabalhos-ia.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now meury-trabalhos-ia.service
   sudo systemctl status meury-trabalhos-ia.service --no-pager
   sudo journalctl -u meury-trabalhos-ia.service -n 50 --no-pager
   ```

   `pnpm worker:ia` é a alternativa de execução manual. Não reinicie o worker
   antigo nem altere a configuração do navegador para habilitar este serviço.
5. Confirmar heartbeat em `ia_worker` (até três minutos), gerar uma busca pequena
   autorizada e conferir as duas chamadas, revisão, Qtd, tela e downloads. Só
   essa validação comprova o funcionamento real do login/CLI na VM. Para pausar,
   parar o serviço e retirar sua credencial; jobs duráveis permanecem salvos.

## Egress, custos e observação

O preparo transfere apenas até 51 linhas agregadas por chamada e guarda lotes de
até 64 KiB. Cada lote vai duas vezes ao Codex (geração e revisão), mais candidato
na revisão; não se envia o CSV nem pedidos/clientes completos. Tentativas podem
repetir uma chamada paga cuja confirmação se perdeu: a proteção evita publicar
duas vezes, mas não garante cobrança única do provedor.

O acompanhamento consulta até 100 resumos por requisição (50 origens), sem JSON
de lotes/prompts. Polling a cada 10 s somente com IA ativa, interrompido em aba
oculta ou estado terminal; falhas têm backoff até 60 s. Foco/reabertura atualiza
o estado. Worker ocioso consulta a cada 60 s (até 1.440 chamadas/dia por processo),
com retorno vazio. Rodando, renova a cada 15 s. Um lote sem retry implica duas
chamadas Codex e duas confirmações, além de preparo/publicação/heartbeats.

Estimativa de tráfego deve usar: páginas de entrada × bytes medidos +
(geração + revisão + retries) × bytes dos prompts/respostas + resumos × consultas
de acompanhamento + downloads efetivos. Não há medição de egress faturado ou
economia monetária nesta implementação. Medir na homologação com dados reais
antes de aumentar concorrência. Monitorar fila mais antiga, contato do worker,
reservas expiradas e falhas em `ia_tentativa`; não usar enfileiramento como sucesso.
Histórico fica associado à busca até sua exclusão. Não há limpeza automática de
versões antigas; acompanhar crescimento antes de definir uma retenção de negócio.

## Validação local

- `tests/trabalhos-ia.test.ts`: migration em PostgreSQL WASM descartável, etapas,
  duplicidade, permissões, revisão, retomada, expiração, cancelamento, RLS,
  paginação e segundo tipo. Sem banco remoto ou chamadas reais ao Codex.
- `tests/trabalhos-ia-api.test.ts`: sessão, 202, escopo, contratos, exportações e
  autenticação interna com dependências simuladas.
- `tests/trabalhos-ia-browser.test.ts`: componentes reais em Chrome com APIs
  simuladas, 360/390/1280/1440px, temas claro/escuro, foco, Escape, paginação,
  clique repetido, revisão, retomada, erro de configuração e fim de polling.
- Testes de regressão de Anotar SKU e worker antigo; lint, TypeScript, Prisma e
  build. PostgreSQL WASM serializa transações no teste: não certifica disputa de
  locks em múltiplas conexões de produção. `tests/anotar-sku-database.test.ts`
  mantém a opção de teste em PostgreSQL local vazio com a nova migration.

Não representam validação em aparelho físico, produção ou VM real. A ativação
requer migration, configuração do backend, implantação e serviço na VM.

Conferência realizada nesta implementação: 53 testes locais aprovados (incluindo
9 do navegador), lint dos arquivos alterados, TypeScript, Prisma e build de
produção local. PDF renderizado para inspeção de colunas e SKU longo. O build
apresenta avisos preexistentes de imagens e variável não usada fora deste escopo.
O PDF reutiliza a fonte Latin-1 do exportador existente; CSV/XLSX preservam Unicode.
