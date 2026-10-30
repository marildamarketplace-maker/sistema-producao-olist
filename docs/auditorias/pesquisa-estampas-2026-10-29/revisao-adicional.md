# Nova revisão de desempenho — 29/10/2026

## Estado conferido no código
- Facetas: unstable_cache, 300 segundos.
- Pesquisa: unstable_cache após validação e serialização, 86.400 segundos.
- Prefetch: somente próxima página; cache local limitado a três páginas, por sessão/filtros.
- Categoria: operador @> com lower no parâmetro e normalização na gravação.
- Outros seis arrays exatos: ainda EXISTS + unnest + lower.
- Busca em nomes/caminhos: vetor calculado durante o SELECT.
- Tsqueries ainda construídas em diversas expressões da consulta.
- Listagem retorna metadata e campos de detalhe para todos os cards.
- Listagem e contagem executam separadamente e em paralelo.

## Novas medições no banco
Conector administrativo do Supabase junjcjuucnoyiuybhyni. BEGIN READ ONLY, statement_timeout 15 segundos, consultas sequenciais, EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON). SQL capturado do repositório real, páginas de 24 itens, COMPLETED e is_active. Acesso direto ao banco evita o cache da aplicação, medindo o caminho de pesquisas inéditas.

| Caso | Listagem (ms) | Contagem (ms) |
|---|---:|---:|
| Design: linguagem aquarelado + distribuição corrido | 10.785,623 | 10.490,120 |
| Estilo romântico | 12,942 | 55,424 |
| Texto cereja amarela | 4.228,197 | 3.092,820 |
| Categoria botânico e cor rosa como preferências, mínimo 50% | 2.751,047 | 72,199 |

Tempos individuais de execução, sem planejamento, autenticação, HTTP ou navegador. Não somar listagem e contagem como latência da aplicação: em produção elas rodam em paralelo. Banco com processamento concorrente e poucas amostras; não estimar percentis.

## Experimento: selecionar IDs antes de carregar os detalhes

Para o caso de categoria + cor como preferências, foi construída uma CTE MATERIALIZED que seleciona e ordena os IDs e os percentuais da página, seguida de JOIN por chave primária para projetar os mesmos campos completos. A consulta mantém a ordenação externa para não depender da ordem do JOIN. O experimento específico não tem texto pesquisado e usa relevância zero; generalizar para busca textual exige transportar a relevância real.

Execução inicial: 111,703 ms contra 2.751,047 ms da listagem atual. Repetições:
- preferencias:lista: 6946.669 ms.
- preferencias:lista:ids_primeiro: 77.055 ms.

Plano inicial: leitura dos metadados completos só para 24 itens, 7.042 blocos compartilhados acessados contra 154.135 na listagem original. Sem mudança de índice, dados ou aplicação. Não houve comparação integral de resultados; identidade dos IDs, percentuais e ordem ainda devem ser cobertos por testes no mesmo snapshot antes de integrar.

## Melhorias priorizadas

1. Paginar IDs/score antes de carregar JSON e campos de detalhe. Foi a melhor melhoria testada sem mudança de schema para a listagem com preferências. Manter filtros e ranking antes de LIMIT e carregar detalhes depois. Não paginar antes de calcular score.
2. Indexar ou materializar atributos de design. O banco não tem GIN em ai_metadata e os predicados @> percorrem o conjunto COMPLETED. Avaliar GIN parcial jsonb_path_ops no JSON atual versus colunas específicas de busca; comparar planos em ambiente de teste. Nenhum ganho com índice novo foi medido, pois nenhum índice foi criado. Aplicação sugerida usa EXISTS com confiança e requer solução própria; GIN não resolve automaticamente esse predicado.
3. Calcular cada tsquery uma única vez. Ainda não implementado; nova busca textual continua levando segundos. Preservar prefixos, sinônimos, frases, exclusões e pontuação.
4. Persistir/indexar vetor de nomes/caminhos e revisar predicados COALESCE/OR. O GIN atual cobre search_vector, não o vetor de arquivos calculado.
5. Estender operadores indexáveis aos seis arrays restantes, após garantir escrita normalizada. Reutilizar evidência anterior apenas como histórico, não como nova medição nesta revisão.
6. Reutilizar a contagem entre páginas e ordenações. Hoje a chave do cache completo inclui paginação/ordenação; a primeira visita à próxima página repete a mesma contagem global. Separar a contagem em cache por filtros, preferências e mínimo, sem página/ordenação. Avaliar custo adicional de leituras do cache.
7. Deduplicar pesquisas inéditas simultâneas no servidor. O cliente compartilha a Promise por página; isso não prova deduplicação global entre usuários/instâncias. Medir concorrência antes de adotar coordenação distribuída.
8. Rever o payload da listagem: obter detalhes sob demanda pode reduzir rede e serialização, além da projeção SQL tardia. Bytes HTTP não foram medidos.
9. Instrumentar duração separada de autenticação, autorização, listagem, contagem e resposta, com logs agregados sem tokens, texto sensível ou dados de produtos. A autorização atual consulta o usuário duas vezes e ainda roda com cache preenchido; seu custo não foi medido, portanto não relaxar permissões por hipótese.

## Recomendação de execução

Começar por IDs/score antes de metadata, com regressão de todos os modos de ordenação, paginação e preferências. Em paralelo lógico de planejamento (sem agentes), preparar estudo do índice dos atributos de design, pois o caso aquarelado+corrido continua acima de 10 segundos. Não fazer migração global nem alterar todos os filtros de uma vez.

## Validação e escopo

Somente revisão, consultas de leitura e experimento SQL. Nenhum código de aplicação, índice ou dado foi alterado. Não houve teste autenticado em navegador, dispositivo real ou benchmark de carga. Cache quente e prefetch não eliminam os gargalos de combinações inéditas. Evidência completa: revisao-adicional.json.

