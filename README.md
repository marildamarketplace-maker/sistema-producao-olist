# Sistema de Produção e Estoque (Olist + Supabase)

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
- Se qualquer endpoint OAuth/API retornar HTML, o sistema falha com: `Endpoint incorreto: a Olist retornou HTML em vez de JSON. Verifique a URL da API.`
