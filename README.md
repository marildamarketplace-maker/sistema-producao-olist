# ERP Shop (Olist + Supabase)

## Worker de estampas

O consumidor de jobs `AI_ANALYSIS` roda como um processo Node separado do servidor Next.js:

```bash
npm run worker:estampas
```

Para executar a análise visual e persistir os metadados no catálogo, habilite explicitamente o modo real:

```bash
ESTAMPA_AI_PROCESSOR_MODE=live npm run worker:estampas
```

Escolha o provedor em cada execução:

```bash
# OpenAI Responses API (usa OPENAI_API_KEY)
ESTAMPA_AI_PROCESSOR_MODE=live npm run worker:estampas -- --provider=openai

# Codex CLI local (usa login ChatGPT)
ESTAMPA_AI_PROCESSOR_MODE=live npm run worker:estampas -- --provider=codex-local

# Ajuda, sem iniciar o processamento
npm run worker:estampas -- --help
```

`--provider` prevalece sobre `IMAGE_ANALYSIS_PROVIDER` no ambiente ou `.env`. Sem ambos, o padrão continua sendo `openai`. Argumentos desconhecidos e provedores inválidos encerram o processo antes de assumir jobs.

### Codex CLI local

Instale/atualize o Codex CLI e execute `codex login` com sua conta ChatGPT no mesmo usuário do sistema que executará o worker. Confira com `codex login status`. Este modo exige login ChatGPT e não aceita autenticação por API key. Usa os limites de uso do Codex da conta; a análise continua sendo realizada na nuvem, portanto a máquina precisa permanecer ligada e conectada.

O worker verifica o executável, as opções necessárias e o login antes de assumir jobs. `CODEX_CLI_PATH` pode apontar para um executável absoluto quando `codex` não estiver no PATH. O CLI precisa oferecer `--image`, `--output-schema`, `--output-last-message`, `--json`, `--ephemeral` e `--ignore-user-config`.

Configuração exclusiva deste provedor:

- `CODEX_CLI_PATH`: executável, padrão `codex`; informe somente o caminho, sem argumentos de shell.
- `CODEX_CLI_PRIMARY_MODEL`: modelo primário, padrão `gpt-5.4-mini`.
- `CODEX_CLI_FALLBACK_MODEL`: modelo de fallback, padrão `gpt-5.4`; deve ser diferente do primário. Ambos precisam estar disponíveis na sua conta Codex.
- `CODEX_CLI_TIMEOUT_MS`: timeout por execução, padrão `180000` (3 minutos).

O fallback permanece no provedor selecionado: `codex-local` nunca troca automaticamente para a API. `AI_PRIMARY_MODEL`, `AI_FALLBACK_MODEL`, `AI_*_IMAGE_DETAIL` e `AI_MAX_OUTPUT_TOKENS` continuam configurando as chamadas da API, não o CLI. As regras de confiança e validação do catálogo são compartilhadas. Tokens reportados pelo CLI ficam nos metadados; `estimated_cost_usd` fica `null`, pois os preços da API não representam o uso da assinatura.

Cada análise usa um diretório temporário privado, recebe o preview e o mesmo JSON Schema e tem a resposta novamente validada pela aplicação. O subprocesso é iniciado sem shell, com prompt por stdin, sandbox `read-only`, sem aprovação interativa e com shell, apps/plugins, memórias e subagentes desabilitados. A configuração pessoal `config.toml` não é carregada; o login salvo continua disponível. Chaves do banco, Olist e API não são herdadas no ambiente. Os temporários são removidos após sucesso ou erro; no macOS/Linux, timeout encerra também o grupo de subprocessos. Encerramento forçado do próprio worker pode deixar temporários no diretório temporário do sistema.

Erros de limite de uso, timeout e falha temporária seguem o retry/backoff já existente. Erros de autenticação/configuração durante uma análise falham sem retry automático; corrija a causa e use o fluxo de reprocessamento. A validação inicial não faz inferência nem confirma acesso a cada modelo. Para validar sua conta e os modelos, comece com uma fila de teste isolada; iniciar o worker consome os jobs pendentes existentes. `batch:estampas` continua sendo exclusivo da Batch API.

Referências: [execução automatizada](https://learn.chatgpt.com/docs/non-interactive-mode), [autenticação](https://learn.chatgpt.com/docs/auth) e [configuração do Codex](https://learn.chatgpt.com/docs/config-file/config-reference).

Para validar somente a infraestrutura do worker em um ambiente de teste, use o stub:

```bash
ESTAMPA_AI_PROCESSOR_MODE=stub ESTAMPA_ALLOW_STUB_COMPLETION=true npm run worker:estampas
```

O stub altera status e `ai_processed_hash`; por segurança ele exige a confirmação acima e deve ser usado somente contra um banco isolado. Para o catálogo real, use sempre `live`.

Configurações opcionais:

- `ESTAMPA_WORKER_ID`: identificação da instância; por padrão é gerada com hostname, PID e UUID.
- `ESTAMPA_WORKER_CONCURRENCY`: quantidade máxima de jobs simultâneos; padrão `2` para API ou `1` para Codex CLI, limite `8`. Um valor explícito no ambiente/`.env` prevalece sobre esses padrões.
- `ESTAMPA_WORKER_POLL_MS`: intervalo sem trabalho antes de uma nova consulta; padrão `5000`.
- `ESTAMPA_WORKER_LOCK_TIMEOUT_MS`: tempo para considerar abandonado um lock sem heartbeat; padrão `900000` (15 minutos).
- `ESTAMPA_DETECTOR_INTERVAL_MS`: intervalo entre varreduras de estampas `PENDING`; padrão `60000` (1 minuto).

Em produção, execute esse comando em um serviço de processo contínuo separado da aplicação web. Encerrar com `SIGINT` ou `SIGTERM` interrompe novas aquisições e aguarda o lote atual terminar. Jobs interrompidos abruptamente são recuperados por outra instância após o timeout do lock.

Durante o processamento, cada job renova `locked_at` a cada terço do timeout configurado. A recuperação considera travado apenas um job `PROCESSING` cujo `locked_at` — ou `started_at` quando o lock não estiver preenchido — tenha expirado. O job volta para `PENDING` se ainda possuir tentativas; caso contrário, termina em `FAILED`. A seleção e a recuperação usam locks do PostgreSQL com `SKIP LOCKED`, permitindo que várias instâncias executem a manutenção sem recuperar o mesmo job duas vezes.

### Reprocessamento manual de IA

Usuários autenticados com `podeEditarEstampas` podem solicitar um novo processamento por:

```text
POST /api/estampas/{id}/reprocessar-ia
Authorization: Bearer {token}
```

O job é registrado como solicitação manual e ignora a comparação entre `content_hash` e `ai_processed_hash`. Existe uma única linha de `estampa_jobs` por estampa e tipo. Uma nova versão ou solicitação manual reutiliza essa linha, reinicia `tentativas` em zero e mantém a proteção transacional contra dois processamentos simultâneos. `tentativas` representa a tentativa atual e é incrementada somente quando um worker assume o job.

### Classificação da apresentação da imagem

A análise visual `estampa-visual-v5-vocabulario-textil` persiste, além dos metadados da arte:

- `tipo_imagem`: `ESTAMPA`, `LAYOUT`, `APLICACAO_PRODUTO` ou `INDEFINIDO`;
- `conteudos_imagem`: conteúdos reconhecidos na composição, incluindo arte plana, aplicação, texto, variantes, modelo real e manequim;
- `suporte_aplicacao`: `MODELO_REAL`, `MANEQUIM`, `PRODUTO_ISOLADO`, `AMBIENTE`, `MISTO`, `OUTRO` ou `NAO_APLICAVEL`;
- `descricao_aplicacao` e `confianca_tipo_imagem`.

Layouts mistos permanecem classificados como `LAYOUT`, enquanto `conteudos_imagem` registra todas as partes presentes. A classificação não identifica pessoas nem infere atributos pessoais, material, tecido ou dimensões. Registros processados com versões anteriores do prompt permanecem `INDEFINIDO` até um reprocessamento manual explícito, evitando novas chamadas de IA apenas por mudança do prompt.

Objetos fotografados ou renderizados com dobra, volume, sombra, perspectiva, fixação ou cenário são tratados como aplicação. Por exemplo, uma bandeira pendurada em uma parede é `APLICACAO_PRODUTO`; somente a arte digital plana da bandeira é `ESTAMPA`. As evidências usadas nessa decisão ficam registradas na resposta estruturada dentro de `ai_metadata`.

### Segmentação sugerida para pesquisa

A mesma chamada multimodal também pode sugerir `publicos_sugeridos`, `contextos_uso` e `afinidades_visuais`. Cada sugestão inclui confiança e pode incluir até duas evidências visuais em `ai_metadata.response.segmentacaoBusca`. Somente termos com confiança igual ou superior a `AI_MIN_SEGMENTATION_CONFIDENCE` são materializados nas colunas pesquisáveis.

As listas podem ficar vazias e isso não aciona fallback, retry ou uma nova chamada de IA. Os termos entram no Full Text Search com peso inferior a código, título, tema, descrição e demais fatos visuais. A classificação não infere gênero, religião, nacionalidade, condição de saúde ou outros atributos pessoais do comprador; ela representa apenas afinidades visuais úteis para busca.

### Vocabulário têxtil

`padroes_texteis` armazena termos canônicos usados por profissionais de tecidos e estampas, como `poá`, `vichy`, `paisley`, `pied-de-poule`, `animal print`, `listrado` e `xadrez`. A confiança e as evidências permanecem em `ai_metadata.response.classificacaoTextil`.

A busca expande sinônimos sem chamar IA. Por exemplo, `poá`, `poa`, `bolinhas`, `pontos` e `polka dot` consultam o mesmo grupo. A migration faz um backfill conservador de `poá` usando títulos, descrições e palavras-chave já existentes; ela não reprocessa imagens.

### Custo e segurança dos previews

- O modelo primário usa `AI_PRIMARY_IMAGE_DETAIL=low`; o fallback de maior capacidade usa `AI_FALLBACK_IMAGE_DETAIL=high` somente quando necessário.
- `AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS` é `1` por padrão para não repetir uma resposta inválida antes do fallback.
- O prefixo estável do prompt usa cache do provider e a quantidade de tokens em cache é registrada em `ai_metadata.usage.cached_input_tokens`.
- `ESTAMPA_PREVIEW_ALLOWED_HOSTS` limita as origens permitidas (atualmente `storage.googleapis.com`), incluindo todos os redirects, reduzindo risco de SSRF.
- `ESTAMPA_PREVIEW_MAX_BYTES` limita o preview em memória; padrão `10485760` bytes.

## Batch econômico de estampas

O envio em lote fica desativado por padrão e nunca é iniciado pelo servidor HTTP ou pelo worker síncrono. Depois de aplicar a migration `20260831190000_add_estampa_ai_batches`, habilite explicitamente:

```bash
AI_BATCH_ENABLED=true npm run batch:estampas -- submit
npm run batch:estampas -- sync
```

O primeiro comando reserva no máximo `AI_BATCH_MAX_JOBS` jobs, envia um JSONL à Batch API e os deixa em `WAITING_PROVIDER`. O segundo reconcilia lotes enviados e importa os resultados no mesmo registro de `estampas`. Ambos podem ser executados novamente: locks, `custom_id`, `content_hash` e estados persistentes impedem processamento concorrente ou aplicação de resultado sobre uma versão diferente da imagem.

- `AI_MAX_OUTPUT_TOKENS`: proteção de saída por análise; padrão `700`.
- `AI_BATCH_ENABLED`: autorização explícita para envio; padrão `false`.
- `AI_BATCH_MAX_JOBS`: limite por lote; padrão `500`, máximo `5000`.
- Baixa confiança mesmo após o fallback é falha definitiva: repetir os mesmos dois modelos não consome novas tentativas automaticamente.

## Deploy em Produção

### 1) Supabase
1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL Editor.
3. Copie:
   - `Project URL`
   - `anon public key`
   - `service_role key`

### 2) Vercel
1. Importe o repositório na Vercel.
2. Configure as variáveis de ambiente (Production):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `POSTGRES_PRISMA_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OLIST_CLIENT_ID`
   - `OLIST_CLIENT_SECRET`
   - `OLIST_REDIRECT_URI` (opcional; use somente se precisar bater exatamente com o cadastro da Tiny/Olist)
   - `OLIST_API_BASE_URL` (opcional)
   - `OLIST_OAUTH_URL` (opcional)
3. Deploy.

O callback OAuth da Olist usa automaticamente o dominio atual em `/api/olist/callback?`, a menos que `OLIST_REDIRECT_URI` esteja configurada.

## Observações de segurança
- `SUPABASE_SERVICE_ROLE_KEY`, `OLIST_CLIENT_ID` e `OLIST_CLIENT_SECRET` devem ficar somente no servidor (Vercel), nunca no browser.
- A rota `POST /api/olist/gerar-solicitacao` usa credenciais server-side.

## API de importação Olist (implementado)

### Endpoint
- **POST** `/api/olist/gerar-solicitacao`

### Prisma ORM + Supabase
- O acesso server-side ao banco usa Prisma ORM conectado ao Postgres do Supabase.
- Configure `POSTGRES_PRISMA_URL` no ambiente para o Prisma Client.
- O Prisma Client e gerado automaticamente no `postinstall` via `prisma generate`.
- O Supabase client continua disponivel nas telas client-side, onde Prisma nao roda no browser.

### HTTP com Axios
- As chamadas server-side para OAuth/API Olist usam `axios`.
- As chamadas client-side para as APIs internas de integracao Olist tambem usam `axios`.

### Referência oficial (Swagger Olist/Tiny v3)
- Swagger: `https://erp.tiny.com.br/public-api/v3/swagger/index.html#`
- Base da API pública v3: `https://erp.olist.com/public-api/v3`
- A implementação usa exclusivamente a API pública v3 da Olist/Tiny em `https://erp.olist.com/public-api/v3`.
- Opcional: sobrescreva via `OLIST_API_BASE_URL` (ex.: homologação).

### Payload
```json
{
  "data_limite": "2026-05-16",
  "filtro_data_base": "APROVACAO_PEDIDO",
  "periodo_inicio": "2026-05-15T16:59:00.000Z",
  "periodo_fim": "2026-05-16T11:00:00.000Z",
  "situacoes": ["3", "4", "1"]
}
```

### Campos obrigatórios
- `data_limite` (string date)
- `filtro_data_base` (`APROVACAO_PEDIDO` ou `CRIACAO_PEDIDO`)
- `periodo_inicio` (ISO datetime)
- `periodo_fim` (ISO datetime)
- `situacoes` (array opcional; padrao: `["3", "4", "1"]`)

### Regras de negócio implementadas
1. Busca pedidos na API Olist/Tiny v3 (referência Swagger acima) via `GET /pedidos` com filtros `dataInicial`, `dataFinal`, `limit`, `offset` e `orderBy`, com autenticação OAuth2 (Client Credentials) usando `OLIST_CLIENT_ID` e `OLIST_CLIENT_SECRET`
2. Mantém apenas pedidos com status válidos:
   - Em aberto
   - Aprovado
   - Preparando envio
   - Faturado
3. Filtra pedidos pelo período informado conforme `filtro_data_base`:
   - `APROVACAO_PEDIDO` usa `approved_at`
   - `CRIACAO_PEDIDO` usa `created_at`
   - pedidos sem data-base válida ficam fora
4. Evita reprocessamento item a item usando `pedidos_olist_processados`:
   - chave de deduplicação: `pedido_olist_id + item_olist_id`
   - quando o item não vem com `id` na Olist, usa fallback `${pedido.id}:${item.sku}:${index}`
   - item já processado é ignorado e contabilizado em `itens_ja_processados`
5. Agrega a demanda por SKU somando `quantity` dos itens novos.
6. Busca dados internos para cálculo:
   - `produtos` (somente ativos)
   - estoque atual assumido como zero quando nao houver tabela/view de estoque no banco
   - `configuracoes_sistema` (`META_GERAL_ESTOQUE` e `MINIMO_GERAL_ESTOQUE`)
7. Calcula `quantidade_solicitada` por SKU:
   - primeiro calcula `estoque_projetado = estoque_atual - demanda_pedidos`
   - gera item somente quando `estoque_projetado <= MINIMO_GERAL_ESTOQUE`
   - quantidade gerada: `max(0, meta_estoque - estoque_projetado)`
   - `meta_estoque` do produto tem prioridade; fallback para `META_GERAL_ESTOQUE`
8. Gera a solicitação em `solicitacoes_producao` com:
   - `status: em_producao`
   - `observacao_geral: Gerada automaticamente via Olist`
   - período e filtro usados na geração
9. Gera os itens em `itens_solicitacao_producao` com:
   - `tipo_corte: PADRAO`
   - `status_item: em_producao`
   - `observacao: Gerado por integração Olist`
10. Salva o rastreio dos itens novos em `pedidos_olist_processados` vinculando `solicitacao_producao_id` e período da execução.

### Resposta de sucesso (exemplo)
```json
{
  "solicitacao_id": "uuid-da-solicitacao",
  "itens": 12,
  "itens_ja_processados": 4,
  "pedidos_encontrados": 10,
  "pedidos_adicionados": 7,
  "pedidos_ignorados": 3,
  "motivo_pedidos_ignorados": "Pedido já processado anteriormente."
}
```

### Erros de validação (400)
- `data_limite é obrigatório`
- `filtro_data_base inválido`
- `periodo_inicio e periodo_fim são obrigatórios`

### Erros de processamento (500)
- Falha de comunicação com Olist
- Falha de consulta/inserção no Supabase
- `Período inválido`
- `Nenhum item elegível encontrado nos pedidos da Olist.`
- `Não há necessidade de produção para os critérios informados.`


### OAuth de autenticação (v3)
- `GET /api/olist/login`: inicia OAuth2 (authorization code).
- `GET /api/olist/callback`: recebe `code`, troca por `access_token`/`refresh_token`.
- A coluna `aplicativo.jobs` controla quais jobs podem atuar em cada aplicação. Informe as chaves separadas por vírgula, por exemplo: `BAIXA_ESTOQUE,NOTIFICAR,RENOVAR_TOKENS,VALIDADOR_ESTOQUE,CONFIRMACAO_ENTREGA_PRODUCAO`. Espaços e diferenças entre maiúsculas/minúsculas são normalizados; a comparação da chave é exata. Valor vazio desabilita todos os jobs para a aplicação.
- `GET /api/cron/renovar-tokens-olist`: diariamente às 03:05 UTC, renova somente integrações conectadas com `RENOVAR_TOKENS` cujo token expire nas próximas 25 horas. A rota exige `Authorization: Bearer <CRON_SECRET>`.
- `GET /api/cron/baixa-estoque-olist`: diariamente às 02:50 UTC (23:50 em `America/Sao_Paulo`), executa a mesma busca da tela de baixa Olist para cada aplicação conectada com `BAIXA_ESTOQUE`, usando somente `dataAtualizacao`, com janela móvel padrão dos últimos 7 dias, e confirma automaticamente todos os pedidos com detalhes disponíveis. A rota exige `Authorization: Bearer <CRON_SECRET>`.
- `GET /api/cron/processar-notifications`: processa qualquer notificação pendente destinada ao WhatsApp de aplicações com `NOTIFICAR`, independentemente do job que a criou.
- `GET /api/cron/validador-estoque`: executa diariamente às 08:00, 13:00 e 22:00 em `America/Sao_Paulo` (11:00, 16:00 e 01:00 UTC) para aplicações conectadas com `VALIDADOR_ESTOQUE`. Consulta as situações 0, 3, 4 e 1 usando o mesmo cálculo da tela “Gerar solicitação automaticamente”; se houver itens para “Nova solicitação”, enfileira um alerta no WhatsApp do aplicativo. Qualquer falha de processamento também é enfileirada como alerta. A chave `NOTIFICAR` deve estar habilitada no aplicativo para o worker consumir e enviar essas notificações. A rota exige `Authorization: Bearer <CRON_SECRET>`.
- `OLIST_BAIXA_AUTOMATICA_APLICATIVO_ID` pode restringir a baixa automática a uma aplicação específica; a chave `BAIXA_ESTOQUE` continua obrigatória.
- `WHATSAPP_ERROR_NOTIFICATION_NUMBER=5537988031061`: destinatário server-side de todas as notificações de erro registradas pelo sistema.
- Se qualquer endpoint OAuth/API retornar HTML, o sistema falha com: `Endpoint incorreto: a Olist retornou HTML em vez de JSON. Verifique a URL da API.`

### Cobrança diária de confirmação de produção via WhatsApp

O cron da Vercel chama `GET /api/cron/cobrar-confirmacao-producao` diariamente às 19:00 UTC, equivalente a 16:00 em `America/Sao_Paulo`. Para cada aplicação com a chave `CONFIRMACAO_ENTREGA_PRODUCAO`, o job enfileira uma notificação separada para `aplicativo.whatsapp` por solicitação com status `em_producao` criada há mais de 48 horas. Cada mensagem inclui um link público assinado, válido por sete dias, para `/confirmar-entrega-producao`. O token fica no fragmento do link, é removido da barra após a abertura e segue para a API somente pelo header `Authorization`, evitando exposição em logs e referrers. Nessa tela é possível revisar e editar as quantidades antes de confirmar com uma das senhas autorizadas. Falhas por aplicação também são enfileiradas para o WhatsApp; falhas gerais usam o destinatário de erros do sistema.

Variáveis obrigatórias:

- `CRON_SECRET`: segredo usado pela Vercel no header `Authorization: Bearer ...`.
- `ZAPI_INSTANCE_API`: URL completa da API da instância Z-API, sem o sufixo `/send-text`.
- `ZAPI_CLIENT_TOKEN`: token de segurança da conta Z-API.
- `CONFIRMACAO_PRODUCAO_PUBLIC_SECRET`: segredo aleatório de pelo menos 32 caracteres usado exclusivamente para assinar os links públicos. Não use `CRON_SECRET` nem exponha a variável com prefixo `NEXT_PUBLIC_`.
- `APP_URL`: URL pública do sistema, usada no link para a tela de confirmação (opcional na Vercel).

A API pública valida a assinatura e a expiração do link, restringe todas as consultas ao aplicativo do token, limita tentativas incorretas de senha e executa a confirmação dentro da mesma transação serializável usada pela tela autenticada. As senhas nunca são enviadas no link nem persistidas no banco.
