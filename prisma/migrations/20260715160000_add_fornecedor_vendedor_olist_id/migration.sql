alter table fornecedores
  add column if not exists vendedor_olist_id uuid references usuario(id) on delete set null;

create index if not exists idx_fornecedores_vendedor_olist_id
  on fornecedores(vendedor_olist_id);
