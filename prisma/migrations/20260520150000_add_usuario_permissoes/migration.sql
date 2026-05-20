create table if not exists usuario (
  id uuid primary key default gen_random_uuid(),
  aplicativo_id uuid not null references aplicativo(id) on delete cascade,
  nome text not null,
  email text not null,
  ativo boolean not null default true,
  pode_visualizar_estoque boolean not null default false,
  pode_editar_estoque boolean not null default false,
  pode_visualizar_baixa boolean not null default false,
  pode_solicitar_baixa boolean not null default false,
  pode_visualizar_devolucao boolean not null default false,
  pode_solicitar_devolucao boolean not null default false,
  pode_solicitar_producao boolean not null default false,
  pode_visualizar_producao boolean not null default false,
  pode_confirmar_producao boolean not null default false,
  pode_visualizar_configuracao boolean not null default false,
  pode_editar_configuracao boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_usuario_aplicativo_email
  on usuario(aplicativo_id, email);

create index if not exists idx_usuario_aplicativo_id
  on usuario(aplicativo_id);
