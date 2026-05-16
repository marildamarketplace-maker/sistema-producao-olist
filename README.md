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
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OLIST_API_URL`
   - `OLIST_API_TOKEN`
3. Deploy.

## Observações de segurança
- `SUPABASE_SERVICE_ROLE_KEY` e `OLIST_API_TOKEN` devem ficar somente no servidor (Vercel), nunca no browser.
- A rota `POST /api/olist/gerar-solicitacao` usa credenciais server-side.

## API de importação Olist (implementado)

### Endpoint
- **POST** `/api/olist/gerar-solicitacao`

### Referência oficial (Swagger Olist/Tiny v3)
- Swagger: `https://erp.tiny.com.br/public-api/v3/swagger/index.html#`
- Base da API pública v3: `https://erp.tiny.com.br/public-api/v3`
- Observação: a implementação atual usa `OLIST_API_URL` configurável e tenta automaticamente `GET {OLIST_API_URL}/orders`; se receber `404`, tenta `GET {OLIST_API_URL}/pedidos` com o mesmo filtro e token Bearer.

### Payload
```json
{
  "data_limite": "2026-05-16",
  "turno_id": "uuid-do-turno",
  "filtro_data_base": "APROVACAO_PEDIDO",
  "periodo_inicio": "2026-05-15T16:59:00.000Z",
  "periodo_fim": "2026-05-16T11:00:00.000Z"
}
```

### Campos obrigatórios
- `data_limite` (string date)
- `turno_id` (uuid)
- `filtro_data_base` (`APROVACAO_PEDIDO` ou `CRIACAO_PEDIDO`)
- `periodo_inicio` (ISO datetime)
- `periodo_fim` (ISO datetime)

### Regras de negócio implementadas
1. Busca pedidos na API Olist/Tiny v3 (referência Swagger acima) com filtro `shipping_deadline_lte={data_limite}` e autenticação Bearer (`OLIST_API_TOKEN`), tentando nesta ordem:
   - `GET {OLIST_API_URL}/orders`
   - em caso de `404`, fallback para `GET {OLIST_API_URL}/pedidos`
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
   - `vw_estoque_atual`
   - `configuracoes_sistema` (`META_GERAL_ESTOQUE`)
7. Calcula `quantidade_solicitada` por SKU:
   - `max(0, demanda_pedidos + meta_estoque - estoque_atual)`
   - `meta_estoque` do produto tem prioridade; fallback para `META_GERAL_ESTOQUE`
8. Gera a solicitação em `solicitacoes_producao` com:
   - `status: em_producao`
   - `observacao_geral: Gerada automaticamente via Olist`
   - período e filtro usados na geração
9. Gera os itens em `itens_solicitacao_producao` com:
   - `tipo_corte: PADRAO`
   - `status_item: em_producao`
   - `observacao: Gerado por integração Olist`
10. Salva o rastreio dos itens novos em `pedidos_olist_processados` vinculando `solicitacao_producao_id`, `turno_id` e período da execução.

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
- `turno_id é obrigatório`
- `filtro_data_base inválido`
- `periodo_inicio e periodo_fim são obrigatórios`

### Erros de processamento (500)
- Falha de comunicação com Olist
- Falha de consulta/inserção no Supabase
- `Período inválido`
- `Nenhum item elegível encontrado nos pedidos da Olist.`
- `Não há necessidade de produção para os critérios informados.`
