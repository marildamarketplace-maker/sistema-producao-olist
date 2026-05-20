create table if not exists aplicativo (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  olist_client_id text,
  olist_client_secret text,
  olist_redirect_uri text,
  olist_api_base_url text,
  olist_oauth_url text,
  olist_oauth_authorize_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into aplicativo (id, nome)
values ('00000000-0000-0000-0000-000000000001', 'Aplicativo padrão')
on conflict (id) do nothing;

alter table produtos add column if not exists aplicativo_id uuid references aplicativo(id);
alter table turnos_producao add column if not exists aplicativo_id uuid references aplicativo(id);
alter table configuracoes_sistema add column if not exists aplicativo_id uuid references aplicativo(id);
alter table solicitacoes_producao add column if not exists aplicativo_id uuid references aplicativo(id);
alter table itens_solicitacao_producao add column if not exists aplicativo_id uuid references aplicativo(id);
alter table pedidos_olist_processados add column if not exists aplicativo_id uuid references aplicativo(id);
alter table movimentacoes_estoque add column if not exists aplicativo_id uuid references aplicativo(id);
alter table solicitacoes_devolucao add column if not exists aplicativo_id uuid references aplicativo(id);
alter table itens_solicitacao_devolucao add column if not exists aplicativo_id uuid references aplicativo(id);
alter table baixas_estoque_olist add column if not exists aplicativo_id uuid references aplicativo(id);
alter table itens_baixa_estoque_olist add column if not exists aplicativo_id uuid references aplicativo(id);
alter table controles_busca_olist add column if not exists aplicativo_id uuid references aplicativo(id);
alter table integracao_olist_tokens add column if not exists aplicativo_id uuid references aplicativo(id);

alter table produtos alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table turnos_producao alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table configuracoes_sistema alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table solicitacoes_producao alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table itens_solicitacao_producao alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table pedidos_olist_processados alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table movimentacoes_estoque alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table solicitacoes_devolucao alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table itens_solicitacao_devolucao alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table baixas_estoque_olist alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table itens_baixa_estoque_olist alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table controles_busca_olist alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';
alter table integracao_olist_tokens alter column aplicativo_id set default '00000000-0000-0000-0000-000000000001';

update produtos set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update turnos_producao set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update configuracoes_sistema set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update solicitacoes_producao set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update itens_solicitacao_producao set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update pedidos_olist_processados set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update movimentacoes_estoque set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update solicitacoes_devolucao set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update itens_solicitacao_devolucao set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update baixas_estoque_olist set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update itens_baixa_estoque_olist set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update controles_busca_olist set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;
update integracao_olist_tokens set aplicativo_id = '00000000-0000-0000-0000-000000000001' where aplicativo_id is null;

create index if not exists idx_produtos_aplicativo_id on produtos(aplicativo_id);
create index if not exists idx_turnos_producao_aplicativo_id on turnos_producao(aplicativo_id);
create index if not exists idx_configuracoes_sistema_aplicativo_id on configuracoes_sistema(aplicativo_id);
create index if not exists idx_solicitacoes_producao_aplicativo_id on solicitacoes_producao(aplicativo_id);
create index if not exists idx_itens_solicitacao_producao_aplicativo_id on itens_solicitacao_producao(aplicativo_id);
create index if not exists idx_pedidos_olist_processados_aplicativo_id on pedidos_olist_processados(aplicativo_id);
create index if not exists idx_movimentacoes_estoque_aplicativo_id on movimentacoes_estoque(aplicativo_id);
create index if not exists idx_solicitacoes_devolucao_aplicativo_id on solicitacoes_devolucao(aplicativo_id);
create index if not exists idx_itens_solicitacao_devolucao_aplicativo_id on itens_solicitacao_devolucao(aplicativo_id);
create index if not exists idx_baixas_estoque_olist_aplicativo_id on baixas_estoque_olist(aplicativo_id);
create index if not exists idx_itens_baixa_estoque_olist_aplicativo_id on itens_baixa_estoque_olist(aplicativo_id);
create index if not exists idx_controles_busca_olist_aplicativo_id on controles_busca_olist(aplicativo_id);
create index if not exists idx_integracao_olist_tokens_aplicativo_id on integracao_olist_tokens(aplicativo_id);
