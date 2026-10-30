# Paginação por IDs antes dos detalhes — 29/10/2026

## Implementação

A listagem usa WITH pagina AS MATERIALIZED para selecionar id, relevância e percentual, aplicando os mesmos filtros e a mesma ordenação antes de LIMIT/OFFSET. Um JOIN pela chave primária carrega os campos completos apenas dos itens selecionados. A ordenação é reaplicada na saída, pois o JOIN não garante ordem.

A expressão de ranking original é preservada e sua pontuação é transportada para a projeção final. Os critérios encontrados/ausentes são calculados para os itens da página. Filtros de design ainda precisam ler metadata antes de paginar para selecionar corretamente; esta mudança não elimina esse custo necessário.

A consulta de contagem foi preservada. Cache, autorização e contratos de resposta não mudaram. Nenhuma migração ou alteração de dados.

## Equivalência em PostgreSQL

Foram comparadas as consultas anterior e nova em 27 cenários, dentro de SELECTs somente leitura sobre 10 registros sintéticos definidos em CTE (jsonb_populate_recordset com o tipo public.estampas). Não houve inserção em tabelas.

Todos retornaram equivalente = true para a sequência de IDs, relevância, percentual e termos encontrados/ausentes:
- Obrigatórios e preferências de categoria/cor.
- RELEVANCIA, RECENTES, CODIGO_ASC e CODIGO_DESC.
- Primeira página, página seguinte e página vazia (offsets 0, 2 e 20; limite 2).
- Empates de código/variante com caixa diferente, id como desempate e updated_at nulo.
- Registros inativos e PENDING excluídos.
- Busca textual com exclusão, código com variante e filtro de design.

A projeção comparada foi restrita aos campos de seleção/ranking, sem retornar descrições, caminhos ou metadata. Os campos detalhados mantêm as mesmas expressões da consulta original; igualdade integral do payload não foi comparada no conector.

Para 28 cenários, SQL e parâmetros da contagem são idênticos aos anteriores, verificados na captura do repositório.

## Desempenho do SQL final

Consultas reais de listagem, completas, via EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) no Supabase junjcjuucnoyiuybhyni, com BEGIN READ ONLY e limite de 15 segundos. Sem cache da aplicação; 24 itens por página.

| Caso | Anterior | Nova |
|---|---:|---:|
| Categoria botânico + cor rosa como preferências, rodada 1 | 6.848,282 ms | 226,148 ms |
| Mesmo caso, rodada 2, ordem de execução invertida | 5.216,490 ms | 200,376 ms |
| Texto flor rosa -rascunho, uma rodada | 3.950,619 ms | 1.939,132 ms |

A busca textual ainda paga o custo de seleção e ranking dos candidatos. Tempos observados, não garantia de latência; poucas amostras, banco em uso e processamento concorrente. Não incluem planejamento, autenticação, HTTP ou renderização. Listagem e contagem seguem paralelas.

## Testes e limites

A suíte local passou com 535 testes, 6 ignorados. O novo teste opcional de integração usa PESQUISA_ESTAMPAS_TEST_DATABASE_URL e foi ignorado localmente por ausência da configuração; as 27 comparações acima foram executadas separadamente no PostgreSQL pelo conector.

Os testes locais verificam a projeção após LIMIT, filtros/contagem equivalentes, parâmetros, todas as ordenações e posições de página. Um teste opcional usa expectativas independentes para IDs e percentuais dos registros sintéticos.

Não houve deploy, validação visual autenticada ou teste em dispositivo real. Nenhuma interface foi alterada.

Evidência: paginacao-ids-validacao.json.

