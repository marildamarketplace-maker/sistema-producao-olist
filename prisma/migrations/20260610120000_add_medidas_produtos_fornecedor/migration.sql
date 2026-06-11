alter table produtos_fornecedor
  add column if not exists peso_liquido_metro numeric(10, 3),
  add column if not exists peso_bruto_metro numeric(10, 3),
  add column if not exists largura_embalagem_metro numeric(10, 2),
  add column if not exists altura_embalagem_metro numeric(10, 2),
  add column if not exists comprimento_embalagem_metro numeric(10, 2);
