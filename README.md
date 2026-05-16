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
1. Busca pedidos na Olist e mantém apenas status válidos:
   - Em aberto
   - Aprovado
   - Preparando envio
   - Faturado
2. Filtra pedidos pelo período calculado conforme `filtro_data_base`:
   - `APROVACAO_PEDIDO` usa `approved_at`
   - `CRIACAO_PEDIDO` usa `created_at`
3. Evita reprocessamento de item da Olist:
   - verifica `pedido_olist_id + item_olist_id` em `pedidos_olist_processados`
   - se já existir, ignora o item
   - se não existir, inclui no cálculo e salva no tracking
4. Calcula necessidade de produção por SKU e gera nova solicitação em `solicitacoes_producao`.
5. Salva os itens gerados em `itens_solicitacao_producao`.
6. Salva o rastreio dos itens processados em `pedidos_olist_processados`.

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
