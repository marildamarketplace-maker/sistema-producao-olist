alter table usuario
  add column if not exists pode_visualizar_dashboard boolean not null default false,
  add column if not exists pode_visualizar_fornecedores boolean not null default false,
  add column if not exists pode_visualizar_produtos_fornecedor boolean not null default false,
  add column if not exists pode_visualizar_categorias_midia boolean not null default false;
