alter table variante
  add column if not exists estampa_id uuid references estampa(id) on delete restrict;

drop index if exists uq_variante_codigo;

do $$
begin
  if exists (
    select 1
    from variante
    where estampa_id is not null
    group by estampa_id, codigo
    having count(*) > 1
  ) then
    raise exception 'Existem variantes duplicadas para a mesma estampa. Ajuste os codigos antes de criar o indice uq_variante_estampa_codigo.';
  end if;
end $$;

create unique index if not exists uq_variante_estampa_codigo
  on variante(estampa_id, codigo);

create index if not exists idx_variante_estampa_id
  on variante(estampa_id);
