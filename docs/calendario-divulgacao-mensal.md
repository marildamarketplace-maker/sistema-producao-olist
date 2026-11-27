# Produtos para divulgar por mês

Na aba **Reforçar divulgação** do calendário mensal, **Produtos para divulgar**
abre `/controle-midia/calendario/divulgacao` com mês e abrangência selecionados.
A visão anual também oferece o acesso por mês. O retorno preserva mês, região,
etapa e visão. A tela permite trocar mês/abrangência e atualizar a lista.

## Regras implementadas

- Eventos são resolvidos no servidor pela etapa `divulgar` do calendário. Novembro
  inclui Natal antecipado. Não são recebidos IDs de eventos arbitrários do browser.
- Somente produtos locais ativos e associados aos eventos elegíveis entram.
  Cada produto aparece uma vez, mesmo com vários vínculos.
- As quatro colunas são produto/título, SKU, movimentações de saída e estoque.
  O título é o `tituloFinal` vinculado mais recentemente atualizado (ID desempata);
  sem título, mostra “Sem título”. Não há consulta ao ERP.
- Saídas = **quantidade de registros**, de qualquer origem, nos últimos 12 meses
  de calendário. Uma saída de 50 unidades conta uma vez. Datas usam `created_at`,
  não data comercial da venda. Ajustes/trocas também contam, conforme solicitado.
- Um único instante de referência é capturado por resposta. Janela `[início,
  referência)`, com cálculo dos meses em `America/Sao_Paulo`; anos bissextos são
  tratados pelo PostgreSQL. O período efetivo é mostrado na tela.
- Estoque = soma das quantidades de entradas menos saídas de **todo o histórico**
  até a referência. O corte de 12 meses não restringe o saldo.

## Ranking

Os produtos com saldo positivo são separados pela mediana da contagem de saídas.
A SQL usa a mediana inferior (`percentile_disc`), cuja separação `<=`/`>` equivale
à mediana contínua para as contagens inteiras. Se o corte coincide com o máximo
apesar de haver contagens menores, recua ao maior nível distinto inferior. Isso
corrige casos como `[2,10,10,10]`, mantendo os empates no mesmo perfil.

- Perfil A: até o corte; maior estoque, depois menos saídas, SKU/ID.
- Perfil B: acima do corte; mais saídas, depois maior estoque, SKU/ID.
- Todos com a mesma contagem: somente A, sem fabricar diferença de histórico.

Cada produto recebe um evento principal de maior potencial (ID desempata), sem
somar pesos de vínculos adicionais. Todos os eventos pertinentes aparecem na
explicação da linha. Pesos: Muito alto **2**, Alto **1,6**, Moderado **1,3**, Baixo
**1**. Dentro de cada perfil/evento, numerar pela ordem acima e intercalar eventos
por `(posiçãoLocal - 0,5) / peso`, em aritmética decimal, com desempates estáveis.

Combinar as filas no ciclo global `A B A A B A B A A B`, sem reiniciá-lo em cada
página. Slots de A: 1/3/4/6/8/9; B: 2/5/7/10. Ordenar posições virtuais comprime
lacunas quando um perfil acaba. Com oferta suficiente, cada 20 positivos têm
12 A e 8 B; se um perfil for insuficiente, o outro completa. Isso não é previsão
de vendas nem cálculo de giro contábil.

Saldo zero e negativo permanece na mesma tabela, **depois de todos os positivos**,
ordenado por saldo decrescente, maior potencial, SKU/ID. A diversidade cobre
somente eventos, sem espaçar modelos, estampas, tamanhos ou variantes.

## Segurança, consistência e execução

Server action revalida token, usuário ativo, aplicativo e acesso ao calendário
**e** permissão de visualizar ou editar estoque. O aplicativo vem da autenticação;
consultas e agregações filtram o aplicativo dos produtos, vínculos e movimentos.
Zod valida mês, região e página; campos extras são recusados. Erros não expõem
SQL, tokens ou respostas de provedores. Inteiros SQL são validados contra perda
de precisão antes de serializar para JavaScript.

Serviço coordena validação/autorização por funções injetáveis; SQL agregada fica
separada da interface e do cliente Prisma. Não há classes ou novas camadas globais.
A consulta usa uma transação somente de leitura, statement_timeout de 5s,
transação de 8s e espera de conexão de 5s, sem retry automático ou polling.

É uma leitura local, sem integrações externas, jobs ou mutações. Agregação,
classificação e paginação são executadas no banco, com um snapshot por consulta.
Entre páginas, novas movimentações ou mudanças de associação/situação podem
repetir/omitir produtos. A UI informa essa limitação; **Atualizar** volta à primeira
página. Nenhum snapshot durável ou cache compartilhado foi introduzido.

## Egress e medição

A resposta tem páginas de 20; a SQL consulta até 21 linhas para detectar a próxima.
Agrega somente os candidatos do mês e seus movimentos, sem histórico bruto,
observações, descrições ou imagens. O título é buscado apenas para a página final.
Não há N+1, consulta de estoque inteiro para o browser ou polling.

A classificação global ainda processa todos os candidatos no banco a cada página.
Paginar reduz tráfego, não elimina esse custo. Um cenário sintético de PGlite com
1.000 produtos e 38.250 movimentos produziu página de 20 com **3.761 bytes** de
JSON (sem o envelope de eventos da action), com EXPLAIN ANALYZE de aproximadamente
**0,52–0,78s** em duas execuções locais. São dados fictícios e PostgreSQL WASM;
não estimam latência, carga, tráfego ou custos faturados em produção.
Nenhum índice novo foi criado sem evidência do plano no banco real.

## Dependência e publicação

Reutiliza a migration das associações
`prisma/migrations/20261127130000_calendario_produtos/migration.sql`. Ela foi
executada somente no PostgreSQL em memória dos testes. A aplicação no banco do
sistema permanece pendente; não executar outras migrations do histórico por
implicação. Esta etapa não criou nova migration, não publicou e não fez commit.

## Validação

Os testes `calendario-divulgacao*.test.ts` cobrem o serviço autorizado, isolamento,
filtros, projeção/parametrização SQL, timeout e serialização. PostgreSQL em memória
(PGlite já transitivo do Prisma) executa a SQL real e a migration em fixtures,
verificando deduplicação, títulos, saldo/contagem, datas, mediana corrigida,
60/40 entre páginas, falta de perfil, pesos, inativos, zeros/negativos, permissões
da relação para papéis públicos e constraints. Sem conexão de produção.

O navegador usou os componentes reais em um harness temporário com autenticação
simulada, rotas locais e serviço/SQL reais sobre fixtures PGlite. Verificados:
acesso pelo mês, paginação até os saldos finais, atualização, mudança de mês/estado
vazio, retorno ao calendário, foco após paginação por teclado, texto longo,
rolagem horizontal contida e temas claro/escuro. Larguras CSS efetivas 373px e
1343px; emulação de viewport, não dispositivo físico.

Essa validação não comprova sessão Supabase real, transporte de server actions
Next em ambiente publicado, desempenho com o histórico real ou aumento de vendas.

Resultado final: **51 testes relacionados passaram**, TypeScript sem erros, lint
nos arquivos alterados sem avisos e build Next.js concluído. O build registra
avisos preexistentes de imagens e variável sem uso em outros módulos; nenhuma
dependência foi alterada. Como o pnpm configurado apresentou falha de obtenção/
verificação nesta sessão, as verificações usaram os executáveis das dependências
já instaladas (`node --import tsx`, TypeScript e Next locais).
