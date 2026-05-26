create table if not exists tamanho (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  sku text not null,
  slug text,
  preco_custo numeric(10, 2),
  preco numeric(10, 2),
  peso_liquido numeric(10, 3),
  peso_bruto numeric(10, 3),
  largura_embalagem numeric(10, 2),
  altura_embalagem numeric(10, 2),
  comprimento_embalagem numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_tamanho_sku
  on tamanho(sku);

create unique index if not exists uq_tamanho_slug
  on tamanho(slug);

alter table produto_olist
  add column if not exists tamanho_id uuid references tamanho(id) on delete set null;

create index if not exists idx_produto_olist_tamanho_id
  on produto_olist(tamanho_id);
