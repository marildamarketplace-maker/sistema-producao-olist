# Auditoria de desempenho e custos do dashboard

Verificação em 18 de novembro de 2026, por leitura do código, estatísticas e planos do PostgreSQL de produção e reprodução das consultas HTTP. O maior ganho é substituir o download dos históricos por agregações no banco. Há também dois problemas prioritários: acesso direto sem sessão de usuário e truncagem que faz o cálculo atual retornar zero peças pendentes quando existem 17.

Esta entrega é um diagnóstico. Nenhum endpoint, índice, política de acesso, dado de negócio ou configuração de produção foi alterado.

## Fluxo atual

`src/app/dashboard/page.tsx:223` consulta diretamente sete recursos `/rest/v1/...` do Supabase; não utiliza uma API Next.js dedicada ao dashboard. O cliente em `src/lib/supabase.ts` não injeta filtro de aplicativo. Os históricos e os produtos são baixados integralmente por `carregarTodasPaginas`, em páginas de 1.000 registros com `LIMIT/OFFSET`.

Os filtros de datas, somas, agrupamentos, ordenações e recortes dos rankings acontecem no navegador. A paginação visível de oito produtos também recorta arrays já carregados. Alterar datas não faz novas consultas, mas tampouco reduz o download inicial. Não há polling no componente: o carregamento acontece na montagem da página.

Com os volumes encontrados, uma montagem completa dispara **14 chamadas de dados**: três de produtos, quatro de movimentações, três de vendas e quatro para os demais recursos. Autenticação, shell e imagens não estão incluídos nessa conta.

## Volumes e consultas

Bytes calculados no banco com `sum(octet_length(row_to_json(t)::text))`, usando as mesmas projeções da tela. São medidas de JSON lógico, sem compressão, delimitadores da resposta ou cabeçalhos; não são egress faturado. A consulta HTTP dos itens confirmou resposta comprimida com gzip.

| Recurso | Registros existentes no recorte | JSON lógico | Chamadas por montagem | Ajuste principal |
| --- | ---: | ---: | ---: | --- |
| Produtos ativos | 2.070 | 325.138 B | 3 | Resumos e rankings paginados no banco; imagens somente dos itens exibidos |
| Movimentações de estoque | 3.015 | 679.244 B | 4 | Somar saldo por produto |
| Itens de baixa Olist | 2.028 | 297.506 B | 3 | Somar vendas por SKU e calcular última venda |
| Solicitações de produção | 246 | 41.628 B | 1 | Contar por status/prioridade e período |
| Solicitações de devolução | 4 | 454 B | 1 | Contar total e pendentes |
| Itens de produção | 1.010 | 153.704 B | 1, truncada a 1.000 | Somar pendência com JOIN nas solicitações elegíveis |
| Configurações utilizadas | 2 | 82 B | 1 | Incorporar à consulta de resumo |

O conjunto completo corresponde a **1.497.756 bytes**, aproximadamente **1,50 MB**. O carregamento atual omite dez itens de produção e fica próximo desse volume. O conjunto completo teria 8.375 registros; a tela recebe 8.365 no recorte observado.

## Achados prioritários

### 1. Leitura sem autenticação e sem isolamento de aplicativo

Nas sete tabelas, `relrowsecurity=false`, sem políticas cadastradas, e os papéis `anon` e `authenticated` têm SELECT. As chamadas do dashboard não filtram `aplicativo_id`. Uma requisição usando somente a chave pública da aplicação, sem token de sessão de usuário, conseguiu ler itens e solicitações de produção.

O `AccessGuard` controla apresentação. O efeito que chama `carregarDashboard()` está no componente pai e executa independentemente desse guard. As permissões dos cards também não evitam as sete leituras.

Criar uma API de dashboard com autenticação e autorização no servidor, incluindo aplicativo e permissões de cada domínio. Isso precisa ser acompanhado da correção do acesso direto às tabelas: uma API segura não fecha a Data API existente. Mapear os demais consumidores antes de introduzir RLS e restringir grants, para preservar os fluxos legítimos. Não usar uma função `SECURITY DEFINER` pública como atalho.

Os quatro conjuntos conferidos por aplicativo continham dados somente do aplicativo atual. Isso não constitui isolamento: as consultas e permissões atuais não impedem acesso a registros de outros aplicativos se existirem ou forem adicionados.

### 2. Peças pendentes incorretas por limite de resposta

Em `src/app/dashboard/page.tsx:273`, a leitura de itens não tem paginação nem agregação. A API respondeu `Content-Range: 0-999/1010`; dez itens ficam de fora. Também não existe ordenação nessa leitura.

A reprodução HTTP das duas consultas e da lógica do dashboard resultou em **0 peças pendentes**. O JOIN e a soma sobre o conjunto completo resultaram em **17 peças**, em uma solicitação em produção com sete itens. Resultado referente à coleta e ao filtro padrão, sem datas.

A solução recomendada é agregar a pendência diretamente no SQL. Aumentar o limite global ou baixar todas as páginas manteria o crescimento do tráfego e do processamento no navegador. As duas consultas de solicitações também estão sujeitas ao limite de resposta, embora os volumes atuais sejam inferiores a mil.

### 3. Históricos inteiros para produzir pequenos resumos

Em `src/app/dashboard/page.tsx:247`, todas as movimentações e vendas são buscadas, ordenadas e paginadas. O navegador precisa apenas de saldos, quantidades vendidas e últimas vendas. Cada página repete trabalho de leitura/ordenação no banco, e `OFFSET` aumenta o trabalho descartado conforme avança.

Simulações somente de leitura, já restringindo o aplicativo:

| Conjunto | Histórico atual | Agregado equivalente para período completo | Redução do JSON lógico |
| --- | ---: | ---: | ---: |
| Estoque | 3.015 linhas / 679.244 B | 496 produtos / 34.239 B | 95,0% |
| Vendas e última venda | 2.028 linhas / 297.506 B | 424 SKUs / 46.699 B | 84,3% |
| Total dos dois | 976.750 B | 80.938 B | **91,7%** |

Somente essa substituição reduziria aproximadamente 896 KB por montagem, ou **59,8% do conjunto completo atual**, mantendo os demais payloads. O resultado ainda não é o desenho final: resumos escalares e rankings limitados permitem deixar de baixar também o catálogo completo.

### 4. Filtros, rankings e exportações precisam de contratos separados

Aplicar o período no SQL das vendas e solicitações. Preservar o saldo acumulado e a última venda global: limitar esses dois cálculos ao período selecionado mudaria os indicadores. Os campos atuais de período usam `created_at`, e não a data comercial do pedido ou a data de entrega.

Retornar os cards e os rankings de seis itens em um resumo compacto. Para mais vendidos e parados, devolver oito itens por página e total, com limite máximo validado e desempate estável. Evitar uma chamada por produto. Exportações devem buscar seus dados completos somente quando solicitadas; quando o volume justificar, usar o processamento assíncrono existente, com lotes e estado durável.

Falha na consulta de devoluções hoje é transformada em array vazio (`page.tsx:300`), exibindo zero como se fosse dado válido. Distinguir erro de ausência de registros no contrato e no card.

### 5. Índices devem acompanhar as consultas reformuladas

Nos planos atuais, produtos, movimentações e vendas usam `Seq Scan + Sort` nas páginas intermediárias. Não existem índices de ordenação por `(created_at, id)` nos dois históricos. Há índices isolados por aplicativo e chaves primárias; produtos também têm SKU único.

As tabelas são pequenas. Um scan sequencial para agregar a maior parte delas é aceitável, e não justifica automaticamente um novo índice. A prioridade é retirar downloads e ordenações desnecessários. Índices não reduzem os bytes do mesmo resultado e acrescentam armazenamento e custo às escritas. A decisão deve seguir o plano real, como orienta a [documentação de otimização do Supabase](https://supabase.com/docs/guides/database/query-optimization).

Candidatos para avaliação após definir o SQL final, sem criação nesta auditoria:

- Vendas: `(aplicativo_id, created_at)` para o filtro por período. Avaliar cobertura com SKU/quantidade somente com benefício medido.
- Itens de produção: `(aplicativo_id, solicitacao_id)` para o JOIN das solicitações elegíveis.
- Solicitações de produção: índice parcial por aplicativo e data, com `WHERE status = 'em_producao'`, se o crescimento justificar. O conjunto atual tem uma solicitação elegível e não exige otimização urgente por índice.
- Paginação de produtos ativos: `(aplicativo_id, sku, id) WHERE ativo = true`, se esse acesso persistir no desenho final.

Não criar automaticamente índices para ordenar todo o histórico: essa ordenação deixa de ser necessária ao calcular os agregados.

## Medições de execução

`pg_stat_statements` encontrou as mesmas projeções e ordenações usadas pela tela. Valores acumulados desde o reset informado em 16/05/2026; entradas podem ter sido desalocadas e consultas idênticas podem ser compartilhadas por outras telas. Não representam acessos diários nem o tempo completo de carregamento.

| Consulta compatível com a tela | Chamadas SQL acumuladas | Média | Máximo |
| --- | ---: | ---: | ---: |
| Produtos ativos paginados | 267 | 37,971 ms | 468,008 ms |
| Movimentações paginadas | 283 | 29,964 ms | 501,645 ms |
| Vendas paginadas | 207 | 37,803 ms | 465,015 ms |
| Itens de produção | 415 | 9,034 ms | 216,662 ms |
| Solicitações de produção | 160 | 5,114 ms | 86,327 ms |
| Devoluções | 159 | 1,468 ms | 13,422 ms |
| Configurações, assinatura principal | 731 | 0,520 ms | 15,302 ms |

Em `EXPLAIN (ANALYZE, BUFFERS)`, com serialização JSON e timeout de cinco segundos, as páginas intermediárias de produtos/movimentações/vendas levaram respectivamente **51,382 / 44,286 / 33,860 ms**. Leram todas as linhas elegíveis antes do recorte e ordenaram em memória, sem spill para disco.

As simulações de agregação completa de saldo e vendas levaram **3,659 / 3,226 ms**. Contagem de produção levou **0,355 ms**, e soma de pendência com JOIN, **0,948 ms**. São amostras pontuais com cache e condições de execução variáveis, não um benchmark controlado nem promessa de latência da futura API. Não houve criação de índices nem alteração de parâmetros do banco.

## SQL proposto para os principais cálculos

Exemplos parametrizados para implementação no servidor. `$1` deve vir do aplicativo vinculado ao usuário autenticado; não confiar em um aplicativo informado livremente pelo cliente. As agregações foram verificadas substituindo esse parâmetro pelo aplicativo da coleta.

```sql
-- Saldo acumulado. Não limitar pelo período de vendas.
SELECT produto_id,
       SUM(CASE WHEN tipo_movimento = 'saida'
                THEN -quantidade ELSE quantidade END) AS saldo_atual
FROM public.movimentacoes_estoque
WHERE aplicativo_id = $1
GROUP BY produto_id;

-- Período completo. Para filtro de vendas, preservar MAX global separadamente.
SELECT sku, SUM(quantidade) AS total_vendido,
       MAX(created_at) AS ultima_venda
FROM public.itens_baixa_estoque_olist
WHERE aplicativo_id = $1
GROUP BY sku;

-- Pendência completa, sem o corte de mil itens da Data API.
SELECT COALESCE(SUM(GREATEST(
         0, i.quantidade_solicitada - COALESCE(i.quantidade_produzida, 0)
       )), 0) AS quantidade_pendente
FROM public.itens_solicitacao_producao i
JOIN public.solicitacoes_producao s
  ON s.id = i.solicitacao_id
 AND s.aplicativo_id = i.aplicativo_id
WHERE i.aplicativo_id = $1
  AND s.status = 'em_producao';
```

No endpoint final, incluir o intervalo de criação de solicitações quando informado. Usar limites temporais explícitos e fuso definido; preferir início inclusivo e próximo dia exclusivo, sem aplicar função à coluna indexada. Preservar produtos ativos, saldos negativos, metas por produto e fallback global, regra de agrupamento de SKU e tratamento atual de produtos sem venda. A coleta não encontrou movimentações sem produto nem tipos além de entrada/saída; o contrato deve tratar dados legados conforme a regra existente.

Reutilizar `getUsuarioAutenticado`, Prisma e os padrões de autorização existentes. A API de estoque em modo resumo já usa agregação e serve como referência; não reutilizar diretamente seu handler, pois seu contrato e suas permissões são diferentes. Separar cálculo/consulta e apresentação com funções pequenas, sem novas camadas genéricas. Isso preserva responsabilidades e contratos, mantém interfaces específicas e permite testar dependências sem abstrações especulativas.

## Impacto em custo e sequência recomendada

O caminho atual é Supabase → navegador. Transferir o mesmo histórico para uma API Next.js apenas mudaria o destinatário inicial: Supabase → servidor continuaria transferindo os mesmos dados. A redução precisa acontecer na consulta ao banco. A [documentação de egress do Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/egress) descreve os diferentes caminhos contabilizados.

Como cenário ilustrativo, 100 montagens por dia durante 30 dias representam aproximadamente **4,49 GB de JSON lógico** no desenho atual. Apenas agregar os dois históricos reduziria cerca de **2,69 GB lógicos** nesse cenário. Frequência real, compressão, cache, tráfego de imagens e consumo faturado não foram medidos; não é estimativa de cobrança ou economia monetária.

Ordem recomendada:

1. Corrigir autorização/isolamento e o cálculo truncado das pendências, coordenando a proteção da Data API com os demais consumidores.
2. Introduzir resumo agregado e rankings paginados, preservando as regras de negócio e aplicando filtros no banco.
3. Medir novamente bytes, chamadas e p50/p95 da API; avaliar somente os índices necessários ao SQL final.
4. Se persistirem leituras repetidas, considerar cache curto de 30–60 segundos, com chave por aplicativo, permissões, período e página. Autorizar antes de servir cache e invalidar conforme os eventos relevantes; saldo em cache nunca é autoridade para movimentar estoque.

Não há evidência neste recorte para recomendar aumento de plano, particionamento, réplica, tabela de saldos ou materialized view. Esses recursos adicionariam custo ou manutenção antes de corrigir o fluxo principal.

## Validação e critérios para implementação

Realizados: inspeção das sete consultas e dos índices/permissões reais, contagens e tamanho lógico, estatísticas acumuladas, sete planos atuais e quatro planos agregados, reprodução HTTP da truncagem e do cálculo incorreto. As verificações não deixaram transações de diagnóstico abertas. Não houve validação visual do dashboard nem auditoria completa de autorização do sistema.

Para a implementação, incluir regressões com mais de mil itens e solicitação pendente no final do conjunto; isolamento entre aplicativos; usuário sem sessão, inativo e sem permissões; filtros de data e limites de dia; totais com produtos inativos, metas nulas, saldo negativo e SKU sem venda; desempate e limites da paginação; erros parciais; orçamento de chamadas/bytes e exportação completa. Usar os testes existentes de estoque/paginação como referência, acrescentando testes específicos do dashboard.

Validar desktop e mobile, ambos os temas, teclado, paginação, seleção para produção, exportações e estados de erro/carregamento. Como a entrega atual altera somente documentação, não foram executados build ou suíte da aplicação. Alterações concorrentes de outras tarefas no checkout foram preservadas.
