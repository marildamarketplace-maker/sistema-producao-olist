create table if not exists tamanho_produto_fornecedor (
  id uuid primary key default gen_random_uuid(),
  tamanho_id uuid not null references tamanho(id) on delete cascade,
  produto_fornecedor_id uuid not null references produtos_fornecedor(id) on delete restrict,
  quantidade_usada numeric(10, 4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_tamanho_produto_fornecedor
  on tamanho_produto_fornecedor(tamanho_id, produto_fornecedor_id);

create index if not exists idx_tamanho_produto_fornecedor_produto_id
  on tamanho_produto_fornecedor(produto_fornecedor_id);
