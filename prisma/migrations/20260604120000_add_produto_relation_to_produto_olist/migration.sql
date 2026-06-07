alter table produto_olist
  add column if not exists produto_id uuid;

create index if not exists idx_produto_olist_produto_id
  on produto_olist (produto_id);

alter table produto_olist
  drop constraint if exists produto_olist_produto_id_fkey;

alter table produto_olist
  add constraint produto_olist_produto_id_fkey
  foreign key (produto_id)
  references produtos(id)
  on delete set null
  on update no action;
