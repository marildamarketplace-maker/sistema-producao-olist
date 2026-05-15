-- Schema inicial para controle de produção e estoque têxtil
-- Compatível com Supabase (PostgreSQL)

begin;

create extension if not exists pgcrypto;

-- =========================
-- Tabela: produtos
-- =========================
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  nome text not null,
  imagem_url text,
  meta_estoque integer check (meta_estoque >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_produtos_nome on public.produtos (nome);
create index if not exists idx_produtos_ativo on public.produtos (ativo);


-- =========================
-- Tabela: configuracoes_sistema
-- =========================
create table if not exists public.configuracoes_sistema (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  valor numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_configuracoes_chave on public.configuracoes_sistema (chave);

-- =========================
-- Tabela: solicitacoes_producao
-- =========================
create table if not exists public.solicitacoes_producao (
  id uuid primary key default gen_random_uuid(),
  data_entrega date not null,
  status text not null default 'pendente' check (status in ('pendente', 'em_producao', 'parcial', 'concluida', 'cancelada')),
  observacao_geral text,
  created_at timestamptz not null default now()
);

create index if not exists idx_solicitacoes_data_entrega on public.solicitacoes_producao (data_entrega);
create index if not exists idx_solicitacoes_status on public.solicitacoes_producao (status);

-- =========================
-- Tabela: itens_solicitacao_producao
-- =========================
create table if not exists public.itens_solicitacao_producao (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_producao(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  sku text not null,
  nome text not null,
  imagem_url text,
  quantidade_solicitada integer not null check (quantidade_solicitada > 0),
  quantidade_produzida integer not null default 0 check (quantidade_produzida >= 0),
  tipo_corte text,
  observacao text,
  status_item text not null default 'pendente' check (status_item in ('pendente', 'em_producao', 'concluido', 'cancelado')),
  created_at timestamptz not null default now(),
  check (quantidade_produzida <= quantidade_solicitada)
);

create index if not exists idx_itens_solicitacao_id on public.itens_solicitacao_producao (solicitacao_id);
create index if not exists idx_itens_produto_id on public.itens_solicitacao_producao (produto_id);
create index if not exists idx_itens_status_item on public.itens_solicitacao_producao (status_item);

-- =========================
-- Tabela: movimentacoes_estoque
-- =========================
create table if not exists public.movimentacoes_estoque (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  sku text not null,
  tipo_movimento text not null check (tipo_movimento in ('entrada', 'saida')),
  quantidade integer not null check (quantidade > 0),
  origem text not null,
  referencia_id uuid,
  observacao text,
  created_at timestamptz not null default now()
);

create index if not exists idx_movimentacoes_produto_id on public.movimentacoes_estoque (produto_id);
create index if not exists idx_movimentacoes_tipo on public.movimentacoes_estoque (tipo_movimento);
create index if not exists idx_movimentacoes_created_at on public.movimentacoes_estoque (created_at desc);
create index if not exists idx_movimentacoes_referencia_id on public.movimentacoes_estoque (referencia_id);

-- =========================
-- Regras de imutabilidade (append-only)
-- =========================
-- Nunca sobrescrever solicitação antiga:
create or replace function public.fn_block_update_delete_solicitacoes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Solicitações de produção são imutáveis. Crie uma nova solicitação em vez de alterar/remover.';
end;
$$;

drop trigger if exists trg_block_update_solicitacoes on public.solicitacoes_producao;
create trigger trg_block_update_solicitacoes
before update on public.solicitacoes_producao
for each row execute function public.fn_block_update_delete_solicitacoes();

drop trigger if exists trg_block_delete_solicitacoes on public.solicitacoes_producao;
create trigger trg_block_delete_solicitacoes
before delete on public.solicitacoes_producao
for each row execute function public.fn_block_update_delete_solicitacoes();

-- Nunca sobrescrever itens de solicitação antiga:
create or replace function public.fn_block_update_delete_itens_solicitacao()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Itens de solicitação são imutáveis. Insira novos registros para novas solicitações.';
end;
$$;

drop trigger if exists trg_block_update_itens_solicitacao on public.itens_solicitacao_producao;
create trigger trg_block_update_itens_solicitacao
before update on public.itens_solicitacao_producao
for each row execute function public.fn_block_update_delete_itens_solicitacao();

drop trigger if exists trg_block_delete_itens_solicitacao on public.itens_solicitacao_producao;
create trigger trg_block_delete_itens_solicitacao
before delete on public.itens_solicitacao_producao
for each row execute function public.fn_block_update_delete_itens_solicitacao();

-- Toda movimentação de estoque deve gerar novo registro (append-only):
create or replace function public.fn_block_update_delete_movimentacoes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Movimentações de estoque são imutáveis. Registre uma nova movimentação.';
end;
$$;

drop trigger if exists trg_block_update_movimentacoes on public.movimentacoes_estoque;
create trigger trg_block_update_movimentacoes
before update on public.movimentacoes_estoque
for each row execute function public.fn_block_update_delete_movimentacoes();

drop trigger if exists trg_block_delete_movimentacoes on public.movimentacoes_estoque;
create trigger trg_block_delete_movimentacoes
before delete on public.movimentacoes_estoque
for each row execute function public.fn_block_update_delete_movimentacoes();

-- =========================
-- Estoque atual calculado por entradas - saídas
-- =========================
create or replace view public.vw_estoque_atual as
select
  p.id as produto_id,
  p.sku,
  p.nome,
  coalesce(sum(
    case
      when m.tipo_movimento = 'entrada' then m.quantidade
      when m.tipo_movimento = 'saida' then -m.quantidade
      else 0
    end
  ), 0)::integer as estoque_atual,
  p.meta_estoque,
  p.ativo
from public.produtos p
left join public.movimentacoes_estoque m on m.produto_id = p.id
group by p.id, p.sku, p.nome, p.meta_estoque, p.ativo;

commit;
