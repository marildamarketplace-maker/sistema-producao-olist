alter table tipo_produto
  add column if not exists corte_laser boolean not null default false,
  add column if not exists tecido_corrido boolean not null default false;
