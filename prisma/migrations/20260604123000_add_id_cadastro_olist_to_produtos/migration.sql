alter table produtos
  add column if not exists id_cadastro_olist text;

create index if not exists idx_produtos_id_cadastro_olist
  on produtos (id_cadastro_olist);
