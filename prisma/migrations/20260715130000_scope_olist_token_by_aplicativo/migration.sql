alter table integracao_olist_tokens
  alter column aplicativo_id drop default;

delete from integracao_olist_tokens where aplicativo_id is null;

alter table integracao_olist_tokens
  alter column aplicativo_id set not null;

drop index if exists integracao_olist_tokens_provider_key;
drop index if exists uq_integracao_olist_tokens_provider;

create unique index if not exists uq_integracao_olist_tokens_aplicativo_provider
  on integracao_olist_tokens(aplicativo_id, provider);
