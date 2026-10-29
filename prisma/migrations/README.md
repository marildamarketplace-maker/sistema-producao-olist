# Migrations após a auditoria de 29/10/2026

Este diretório foi reorganizado por solicitação explícita, usando o estado do banco auditado:

- 65 migrations com efeitos atendidos ou superados foram excluídas.
- 19 migrations foram reduzidas a correções pontuais das lacunas encontradas.
- 8 migrations de seed foram excluídas em uma segunda etapa, por solicitação explícita.
- 5 migrations de dados/revisão foram preservadas sem alteração.
- `20261028170000_kits_estoque`, já registrada no banco, foi preservada sem alteração.

**Restam 25 arquivos migration.sql: 19 corretivos, 5 de revisão e a migration de kits. Nenhuma alteração foi aplicada ao banco durante esta reorganização.**

## Não executar deploy global ainda

As 5 migrations de dados continuam exigindo decisão. A conversão histórica de links usa colunas já removidas; os outros arquivos podem criar associações, reclassificar estampas ou reabrir uma fila. Permanecerem neste diretório não significa estarem aprovadas para execução.

Este conjunto **não cria um banco vazio do zero**. As correções pressupõem as tabelas já existentes no banco auditado. Será necessário um baseline independente se houver necessidade de provisionar outro ambiente vazio. Em outro ambiente com as migrations antigas registradas, excluir arquivos ou alterar seus checksums exige reconciliação própria; este ajuste não deve ser aplicado indiscriminadamente a outros históricos.

## Antes de executar alguma correção futuramente

Rever o plano e a autorização, conferir novamente dados/constraints e separar as migrations que serão aplicadas. Os arquivos corretivos abortam em dados inválidos, sem apagá-los nem normalizá-los automaticamente. Usam transação, `lock_timeout` de 5 segundos e `statement_timeout` de 120 segundos. Construção de índices e validação de constraints ainda podem bloquear operações; os limites interrompem esperas longas, mas não garantem disponibilidade ininterrupta. Não há DML de produção nos 19 arquivos corretivos.

A estrutura de `turnos_producao` foi preparada sem horários fictícios, com aplicativo obrigatório e acesso apenas servidor. A tela legada usa acesso direto do navegador e precisará de uma API autenticada antes de voltar a funcionar; não liberar grants públicos para contornar isso.

## Rastreabilidade

- [Mapa histórico da auditoria](../../docs/auditorias/migrations-2026-10-29/mapa-migrations.md)
- [Alterações e validação](../../docs/auditorias/migrations-2026-10-29/alteracoes-migrations.md)
- [Manifesto com hashes anteriores e atuais](../../docs/auditorias/migrations-2026-10-29/alteracoes-arquivos.json)

O commit `2626b795cac1d096edad4ee76d4caa116447a6d9` contém os SQLs anteriores à reorganização, recuperáveis pelo Git.

## Seeds excluídos na segunda etapa

- `20260716171000_seed_formas_pagamento_planos`
- `20260721100000_seed_tarefas_midia_operacao`
- `20260721110000_seed_tarefa_semanal_oferta_relampago`
- `20260721120000_seed_tarefa_quinzenal_google_storage`
- `20260721130000_seed_tarefas_mensais_financeiro`
- `20260721150000_seed_tarefa_quinzenal_novos_produtos`
- `20260721160000_seed_tarefa_semanal_devolucoes`
- `20260721170000_seed_tarefas_mensais_cancelamento_notas`
