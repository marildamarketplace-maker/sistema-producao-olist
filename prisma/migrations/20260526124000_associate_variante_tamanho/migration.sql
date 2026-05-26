alter table variante
  add column if not exists tamanho_id uuid references tamanho(id) on delete set null;

create index if not exists idx_variante_tamanho_id
  on variante(tamanho_id);
