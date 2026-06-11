create table if not exists produtos_fornecedor (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references fornecedores(id) on delete restrict,
  nome text not null,
  descricao text,
  referencia text,
  preco_unitario_metro numeric(10, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aplicativo_id uuid default '00000000-0000-0000-0000-000000000001' references aplicativo(id)
);

create index if not exists idx_produtos_fornecedor_aplicativo_id
  on produtos_fornecedor(aplicativo_id);

create index if not exists idx_produtos_fornecedor_fornecedor_id
  on produtos_fornecedor(fornecedor_id);

create index if not exists idx_produtos_fornecedor_nome
  on produtos_fornecedor(nome);
