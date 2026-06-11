alter table tamanho
  add column if not exists quantidade_produto_fornecedor numeric(10, 4);

update tamanho
set quantidade_produto_fornecedor = origem.quantidade_usada
from (
  select distinct on (tamanho_id)
    tamanho_id,
    quantidade_usada
  from tamanho_produto_fornecedor
  order by tamanho_id, created_at asc
) as origem
where tamanho.id = origem.tamanho_id
  and tamanho.quantidade_produto_fornecedor is null;
