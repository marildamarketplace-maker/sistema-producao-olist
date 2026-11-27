# Produtos por evento no Calendário Comercial

Cada card de evento oferece **Associar produtos**, nas visões mensal e nos detalhes
anuais. O seletor pesquisa título/SKU no estoque local, mostra somente produtos
ativos para novas inclusões e permite consultar/remover vínculos existentes.
As associações usam o ID fixo do evento, sem ano, e permanecem até remoção.

## Título e seleção

O título é o `tituloFinal` do registro `ProdutoOlist` vinculado ao produto local,
priorizando o mais recentemente atualizado e desempate por ID. Sem título, exibe
“Sem título” e permite encontrar o produto pelo SKU. Não consulta o ERP.

A seleção persiste entre páginas, filtros e abas enquanto o seletor estiver
aberto. Salvar aplica apenas o delta; fechar com mudanças pede confirmação de
descarte. Até 100 mudanças por salvamento na interface. A aba **Já associados**
inclui inativos, identificados e disponíveis para remoção; não são apagados
quando o produto fica inativo.

## Autorização, consistência e concorrência

As três server actions revalidam token, usuário ativo, aplicativo e a permissão
`podeVisualizarTarefasMidia`. O servidor valida evento, termo, paginação, UUIDs
e limites. Não recebe aplicativo do browser. Erros de infraestrutura retornam
mensagens genéricas.

A relação tem unicidade por aplicativo/evento/produto e FK composta que impede
vínculos a produtos de outro aplicativo. A tabela possui RLS habilitada e acesso
revogado para `anon`/`authenticated`; o backend usa o cliente compartilhado Prisma.

O salvamento usa transação, lock por aplicativo/evento e locks nos produtos
adicionados, validando a situação ativa dentro da transação. Ordem dos locks de
produto é estável. Inclui `ON CONFLICT DO NOTHING`, remoção idempotente, timeout de
lock de 5s, statement de 8s e transação de 10s. Mudanças independentes de outras
sessões são preservadas; para operações opostas explícitas no mesmo vínculo,
prevalece a última operação executada. Não há retry automático de mutações.

## Egress

A busca é executada no banco, com debounce de 300ms e páginas de 20 produtos
(consulta de até 21 para detectar próxima página), retornando apenas ID, título,
SKU, ativo e associado. O título usa uma única consulta com lateral limitada,
sem descrições, imagens ou agregações de estoque. Contagens são agrupadas pelos
eventos exibidos. Na visão anual, conta os eventos do planejamento anual.

Não há polling, download de mídia nem leitura do estoque inteiro no browser.
Volume e custos em produção não foram medidos; desempenho da busca por substring
sobre grande catálogo deve ser observado antes de criar índices adicionais.

## Migration e publicação

Aplicar **somente** `prisma/migrations/20261127130000_calendario_produtos/migration.sql`
antes de disponibilizar o código. O histórico deste repositório contém migrations
independentes pendentes; não executar o conjunto indiscriminadamente. A migration
cria uma relação e um índice único composto na tabela de produtos existente;
isso pode bloquear brevemente escritas, limitado por lock_timeout de 5s e
statement_timeout de 120s. Não foi aplicada nesta implementação.

## Validação local

Testes em `tests/calendario-produtos*.test.ts` cobrem autorização, validação,
delta, produtos indisponíveis, parâmetros SQL, limites, projeção, contagens e
contratos dos locks/isolamento. A suíte existente de calendário também é mantida.
Os testes de repositório usam um cliente simulado: não comprovam execução da SQL,
constraints ou concorrência real em PostgreSQL. Validar essas fronteiras em um
banco de teste antes da publicação.

Verificações realizadas nesta entrega: 32 testes relacionados passaram, schema
Prisma válido, TypeScript sem erros, lint dos arquivos alterados sem avisos e
build Next.js concluído (com avisos preexistentes fora do escopo). O pnpm
configurado falhou ao obter/verificar sua versão; foram usados os executáveis
locais já instalados, sem mudança de dependências.

No navegador, o seletor real foi renderizado isoladamente com ações simuladas e
dados fictícios: busca, seleção entre filtros/páginas, salvamento, remoção de
inativo, estado vazio, Escape, contenção/restauração de foco e restauração da
rolagem do body. Conferência visual nos temas claro e escuro, em viewport efetiva
mobile de 373px e desktop de 1343px, sem overflow horizontal. Isso não representa
teste em dispositivo físico nem fluxo autenticado com banco real. Erros reais de
infraestrutura e concorrência PostgreSQL continuam sem validação de integração.

### Renovação de sessão

O seletor preserva alterações pendentes ao renovar o token da mesma identidade.
Trocar o usuário autenticado, o usuário local ou o aplicativo reinicia o estado.
O teste `tests/calendario-sessao-browser.test.ts` renderiza a página real com
autenticação e ações simuladas no Chrome headless: verifica a seleção preservada,
o uso do token atualizado no salvamento e a limpeza ao trocar usuário/aplicativo.
Essa regressão passou localmente, assim como os 51 testes relacionados,
TypeScript e lint. A mudança não adiciona consultas ou payloads; mantém o
recarregamento existente durante a renovação e não altera o impacto em egress.

### Títulos do estoque importado

A migration `20261127160000_produtos_titulo` adiciona `produtos.titulo`, opcional.
A importação existente em **Estoque → Importar produtos da Olist** passa a salvar
o nome recebido (`descricao`, ou `nome`), sem apagar um título anterior quando a
resposta não o informa. O cadastro criado recebe o aplicativo da importação;
SKUs de outro aplicativo são ignorados e a escrita também restringe o aplicativo.
O calendário usa esse título antes de `produto_olist.titulo_final`, tanto na
associação (incluindo busca) quanto na divulgação mensal. Não há consulta remota
por produto ao abrir a tela. Sem título em ambas as fontes, permanece “Sem título”.

Aplicar a migration antes de executar o código novo e reimportar para preencher
os cadastros existentes. Não foi aplicado DDL nem executada importação em produção.
A coluna adiciona apenas um texto às respostas já paginadas; a importação reutiliza
as mesmas páginas do ERP e não adiciona chamadas externas. Nenhum ganho monetário
foi medido. Os testes locais cobrem nome ausente/inválido e precedência/fallback
executados em PostgreSQL em memória.
