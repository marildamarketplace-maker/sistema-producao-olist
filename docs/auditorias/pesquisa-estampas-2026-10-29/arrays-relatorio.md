# Filtros exatos de arrays — consultas de desempenho de 29/10/2026

## Método

Consultas somente leitura no projeto Supabase junjcjuucnoyiuybhyni, com BEGIN READ ONLY e statement_timeout de 15 segundos. Nenhuma alteração em dados, índices ou código.

Sete campos auditados em toda a tabela, agrupados por processing_status, incluindo registros inativos. Não foram encontrados elementos diferentes de lower(elemento). Arrays vazios não produzem linhas na auditoria; elementos nulos são comparados com IS DISTINCT FROM. Isso não garante a normalização de futuras gravações.

Para cada campo, escolhemos o valor mais frequente entre estampas ativas/concluídas. Comparamos, na tabela inteira e no mesmo SELECT, o predicado EXISTS + unnest + lower com coluna @> ARRAY[lower(valor)]::text[], usando IS DISTINCT FROM para detectar diferenças inclusive de nulidade. Todos os termos testados tiveram zero divergências.

Desempenho: contagem de estampas ativas/concluídas, duas rodadas por variante, ordem atual→GIN na primeira e GIN→atual na segunda. Tempos são Execution Time de EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON); não incluem planejamento, HTTP, autenticação ou renderização. Banco em uso e processamento concorrente: quantidades podem mudar entre consultas. Não são medições de carga, p95/p99 ou ganho garantido em produção.

## Resultados em milissegundos

| Campo | Termo | Atual: rodadas 1 / 2 | @>: rodadas 1 / 2 | Divergências |
|---|---|---:|---:|---:|
| categorias | botânico | 72.385 / 77.430 | 33.994 / 26.789 | 0 |
| elementos_visuais | folhas verdes | 173.421 / 306.002 | 52.701 / 37.467 | 0 |
| ocasioes | natal | 59.057 / 46.162 | 12.815 / 0.955 | 0 |
| publicos_sugeridos | infantil | 43.081 / 43.498 | 11.444 / 0.904 | 0 |
| contextos_uso | decoração | 43.141 / 44.476 | 11.979 / 1.144 | 0 |
| afinidades_visuais | lúdico | 48.374 / 90.907 | 20.092 / 10.326 | 0 |
| padroes_texteis | folhagem | 62.235 / 62.384 | 33.737 / 14.683 | 0 |

## Índices observados nas variantes @>

- categorias: idx_estampas_categorias_gin, idx_estampas_status_created_at.
- elementos_visuais: idx_estampas_elementos_visuais_gin, idx_estampas_status_created_at.
- ocasioes: idx_estampas_ocasioes_gin.
- publicos_sugeridos: estampas_publicos_sugeridos_gin.
- contextos_uso: estampas_contextos_uso_gin.
- afinidades_visuais: estampas_afinidades_visuais_gin, idx_estampas_status_created_at.
- padroes_texteis: estampas_padroes_texteis_gin, idx_estampas_status_created_at.

Todos os sete campos tiveram melhoria nas duas rodadas. O benefício é maior nos termos seletivos (públicos, ocasiões e contextos). Para categoria e padrão têxtil, mais frequentes, o custo de visitar as linhas correspondentes continua relevante.

## Implicações para implementação

1. Os dados atuais permitem avançar com categoria e depois os outros seis campos, desde que o contrato de minúsculas seja garantido nos caminhos de escrita.
2. Preferir lower no parâmetro SQL, preservando a comparação do PostgreSQL, e a coluna sem função para aproveitar o GIN.
3. Reutilizar o mesmo predicado para filtro obrigatório e preferência. Testar percentuais e ordenação antes de integrar.
4. Não substituir a busca parcial de palavras-chave por inclusão exata.
5. Não criar índices adicionais: os índices existentes foram suficientes nestes testes.
6. A normalização futura permanece uma lacuna: atualizarEstampa aceita arrays diretamente.

## Limites

Testamos um termo frequente por campo e contagens isoladas. Não testamos todas as categorias, termos raros/inexistentes, todos os valores Unicode, combinações de filtros, ordenação, cobertura percentual ou desempenho da listagem completa. A ausência de divergência para esses sete termos não prova equivalência universal.

Conector administrativo, sem sessão real de usuário. Nenhuma interface alterada ou validada em navegador. Não houve teste de concorrência; somente consultas sequenciais no banco em uso.

Evidências completas, SQL e planos: arrays-comparativos.json.

