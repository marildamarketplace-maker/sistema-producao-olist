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

Para validar somente a infraestrutura do worker em um ambiente de teste, use o stub:

```bash
ESTAMPA_AI_PROCESSOR_MODE=stub ESTAMPA_ALLOW_STUB_COMPLETION=true npm run worker:estampas
```

O stub altera status e `ai_processed_hash`; por segurança ele exige a confirmação acima e deve ser usado somente contra um banco isolado. Para o catálogo real, use sempre `live`.

Configurações opcionais:

- `ESTAMPA_WORKER_ID`: identificação da instância; por padrão é gerada com hostname, PID e UUID.
- `ESTAMPA_WORKER_CONCURRENCY`: quantidade máxima de jobs simultâneos; padrão `2` e limite `8`.
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

A mesma chamada multimodal também pode sugerir `publicos_sugeridos`, `contextos_uso` e `afinidades_visuais`. Cada sugestão inclui confiança e evidências visuais em `ai_metadata.response.segmentacaoBusca`. Somente termos com confiança igual ou superior a `AI_MIN_SEGMENTATION_CONFIDENCE` são materializados nas colunas pesquisáveis.

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
- `GET /api/cron/renovar-tokens-olist`: diariamente às 03:05 UTC, renova integrações conectadas cujo token expire nas próximas 25 horas. A rota exige `Authorization: Bearer <CRON_SECRET>`.
- Se qualquer endpoint OAuth/API retornar HTML, o sistema falha com: `Endpoint incorreto: a Olist retornou HTML em vez de JSON. Verifique a URL da API.`

### Cobrança diária de confirmação de produção via WhatsApp

O cron da Vercel chama `GET /api/cron/cobrar-confirmacao-producao` diariamente às 20:00 UTC, equivalente a 17:00 em `America/Sao_Paulo`. A mensagem é enviada somente quando existem solicitações com status `em_producao`.

Variáveis obrigatórias:

- `CRON_SECRET`: segredo usado pela Vercel no header `Authorization: Bearer ...`.
- `ZAPI_INSTANCE_ID`: ID da instância Z-API.
- `ZAPI_TOKEN`: token da instância Z-API.
- `ZAPI_CLIENT_TOKEN`: token de segurança da conta Z-API.
- `WHATSAPP_CONFIRMACAO_PRODUCAO_NUMEROS`: um ou mais números separados por vírgula, no formato DDI + DDD + número, somente dígitos.
- `APP_URL`: URL pública do sistema, usada no link para a tela de confirmação (opcional na Vercel).
