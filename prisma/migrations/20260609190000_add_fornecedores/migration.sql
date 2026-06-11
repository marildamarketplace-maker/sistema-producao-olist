create table if not exists fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  endereco text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aplicativo_id uuid default '00000000-0000-0000-0000-000000000001' references aplicativo(id)
);

create index if not exists idx_fornecedores_aplicativo_id
  on fornecedores(aplicativo_id);

create index if not exists idx_fornecedores_nome
  on fornecedores(nome);
