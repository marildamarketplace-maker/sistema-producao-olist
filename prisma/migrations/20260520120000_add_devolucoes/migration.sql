create table if not exists solicitacoes_devolucao (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pendente',
  pedido_referencia text,
  observacao_geral text,
  created_at timestamptz not null default now(),
  confirmada_em timestamptz
);

create table if not exists itens_solicitacao_devolucao (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references solicitacoes_devolucao(id) on delete cascade,
  produto_id uuid not null,
  sku text not null,
  imagem_url text,
  quantidade_solicitada integer not null,
  quantidade_confirmada integer not null default 0,
  observacao text,
  status_item text not null default 'pendente',
  created_at timestamptz not null default now()
);

create index if not exists idx_solicitacoes_devolucao_status_created
  on solicitacoes_devolucao(status, created_at desc);

create index if not exists idx_itens_solicitacao_devolucao_solicitacao
  on itens_solicitacao_devolucao(solicitacao_id);
