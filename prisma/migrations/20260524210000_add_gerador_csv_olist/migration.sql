create table if not exists tipo_produto (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  sku text not null,
  descricao text,
  descricao_seo text,
  palavras_chave text,
  slug text,
  categoria text,
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

create table if not exists estampa (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  descricao text,
  palavras_chave text,
  extra text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists variante (
  id uuid primary key default gen_random_uuid(),
  tamanho_id uuid,
  codigo text not null,
  descricao text,
  palavras_chave text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists produto_olist (
  id uuid primary key default gen_random_uuid(),
  tipo_produto_id uuid not null references tipo_produto(id) on delete restrict,
  estampa_id uuid not null references estampa(id) on delete restrict,
  variante_id uuid references variante(id) on delete set null,
  tamanho_id uuid references tamanho(id) on delete set null,
  sku_final text not null,
  titulo_final text not null,
  descricao_final text,
  descricao_seo_final text,
  palavras_chave_final text,
  slug_final text,
  categoria text,
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

create unique index if not exists uq_tipo_produto_sku
  on tipo_produto(sku);

create unique index if not exists uq_estampa_codigo
  on estampa(codigo);

create unique index if not exists uq_variante_codigo
  on variante(codigo);

alter table variante
  add constraint fk_variante_tamanho
  foreign key (tamanho_id) references tamanho(id) on delete set null;

create unique index if not exists uq_tamanho_sku
  on tamanho(sku);

create unique index if not exists uq_tamanho_slug
  on tamanho(slug);

create unique index if not exists uq_produto_olist_sku_final
  on produto_olist(sku_final);

create index if not exists idx_produto_olist_tipo_produto_id
  on produto_olist(tipo_produto_id);

create index if not exists idx_produto_olist_estampa_id
  on produto_olist(estampa_id);

create index if not exists idx_produto_olist_variante_id
  on produto_olist(variante_id);

create index if not exists idx_produto_olist_tamanho_id
  on produto_olist(tamanho_id);

create index if not exists idx_variante_tamanho_id
  on variante(tamanho_id);
