create table if not exists pedido_fornecedor_solicitacao (
  id uuid primary key default gen_random_uuid(),
  pedido_olist_id text not null,
  fornecedor_id uuid not null references fornecedores(id) on delete restrict,
  solicitacao_id uuid not null references solicitacoes_producao(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_pedido_fornecedor_solicitacao_pedido_fornecedor
  on pedido_fornecedor_solicitacao(pedido_olist_id, fornecedor_id);

create index if not exists idx_pedido_fornecedor_solicitacao_fornecedor_id
  on pedido_fornecedor_solicitacao(fornecedor_id);

create index if not exists idx_pedido_fornecedor_solicitacao_solicitacao_id
  on pedido_fornecedor_solicitacao(solicitacao_id);
