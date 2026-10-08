# Pesquisa profissional de estampas

## Avaliação do catálogo em 08/10/2026

Consultas somente de leitura no Supabase do projeto, confirmado pelo endereço configurado na aplicação. A fotografia analisada contém 561 estampas ativas, das quais 289 estão concluídas. Esses números mudam conforme o processamento avança.

| Atributo nas concluídas | Registros com classificação | Decisão |
| --- | ---: | --- |
| Estilo | 289 | Filtro principal |
| Distribuição | 285 | Filtro principal |
| Linguagem visual | 287 | Filtro principal |
| Orientação | 278 | Filtro avançado |
| Densidade | 283 | Filtro avançado |
| Público sugerido | 6 | Manter como critério complementar |
| Ocasião | 2 | Manter como critério complementar |

Existem 112 cores, 88 temas, 11 estilos, quatro distribuições, cinco orientações, três densidades e seis linguagens visuais distintas nas estampas concluídas. Motivos botânicos, geométricos, abstratos e ornamentais predominam. Estilo, composição, padrão têxtil e paleta são os critérios mais úteis para reaproveitamento por designers; público e ocasião não devem liderar a navegação porque têm baixa cobertura.

## Melhorias implementadas

- Categoria, estilo, distribuição e linguagem visual acessíveis no formulário principal, além dos filtros existentes de identificação, apresentação e padrão têxtil.
- Filtros avançados agrupados em identificação/apresentação, motivos/contexto, design/composição e paleta.
- Orientação, densidade e aplicação sugerida disponíveis no refinamento profissional.
- Aplicações sugeridas exigem estado `IDENTIFICADO` e confiança entre 70% e 100%. Na fotografia analisada, há 36 sugestões confiáveis de decoração, 27 de vestuário, nove de acessórios e duas de moda praia; uma mesma estampa pode ter mais de uma sugestão.
- Cores com busca, checkboxes e combinação explícita entre todas as selecionadas ou qualquer uma. Máximo de dez cores.
- Opções carregadas ao abrir a tela e atualizadas quando o status muda; valores mais frequentes aparecem primeiro. As facetas incluem apenas estampas ativas no status solicitado.
- Status omitido significa concluídas. Outros status continuam disponíveis. É necessário fornecer um critério explícito antes de consultar.
- Etiquetas removíveis dos filtros aplicados, estados de carregamento e repetição do carregamento de opções em caso de falha.
- Cards mostram estilo, distribuição e linguagem visual. Detalhes exibem os novos atributos e as evidências das aplicações sugeridas. Previews usam `object-contain` para preservar a composição inteira.
- Modal com navegação de teclado restrita ao diálogo, fechamento por Escape ou clique no fundo e restauração do foco.

“Corrido” descreve distribuição pela superfície, sem comprovar rapport técnico. “Vetorial” descreve aparência, sem comprovar formato de arquivo. Aplicação sugerida é uma possibilidade de reaproveitamento, diferente do suporte físico identificado na imagem. Esses limites aparecem na interface.

## Links compartilháveis

Rota web: `/controle-midia/estampas`.

Parâmetros já existentes preservados: `q`, `codigo`, `variante`, `tema`, `cor` repetido, `palavraChave`, `elementoVisual`, `categoria`, `ocasiao`, `publicoSugerido`, `contextoUso`, `afinidadeVisual`, `padraoTextil`, `tipoImagem`, `suporteAplicacao`, `conteudoImagem`, `status`, `pagina` e `ordenacao`.

Novos critérios: `estilo`, `distribuicao`, `orientacao`, `densidade`, `linguagemVisual`, `aplicacaoSugerida` e `modoCores=TODAS|QUALQUER`.

`porPagina` agora é restaurado e preservado na URL, na API, na paginação e na ordenação. A interface oferece 12, 24, 48 e 60 itens, além de preservar outro tamanho válido recebido por link. A API limita a página a 1.000.000 e o tamanho da página a 60. Valores inválidos nos parâmetros de navegação web recebem valores padrão; a API rejeita entradas inválidas.

Exemplo:

```text
/controle-midia/estampas?distribuicao=corrido&linguagemVisual=aquarelado&cor=rosa&cor=creme&modoCores=QUALQUER&status=COMPLETED&pagina=1&porPagina=48&ordenacao=RELEVANCIA
```

O botão de compartilhamento copia o link da busca aplicada. Os filtros da URL são restaurados também ao voltar ou avançar no navegador. O link continua exigindo autenticação e permissão para pesquisar estampas; não contém credenciais.

## Verificação

As consultas SQL geradas pelo código foram executadas no banco real, somente para leitura:

| Consulta | Resultados |
| --- | ---: |
| Cereja | 20 |
| Estilo romântico | 61 |
| Distribuição barrado | 30 |
| Orientação vertical | 51 |
| Densidade densa | 127 |
| Linguagem aquarelado | 73 |
| Aplicação sugerida vestuário, confiança ≥70% | 27 |
| Corrido + aquarelado + rosa ou creme | 40 |
| Rosa e creme obrigatórias | 35 |

A consulta de facetas foi executada no banco e retornou as opções profissionais e os enums de apresentação corretamente. Dez casos de busca textual no PostgreSQL passaram, incluindo singular/plural, conjunção, acentos, frases, alternativas e apóstrofos.

A suíte local teve 195 testes aprovados, nenhuma falha e um teste de conexão direta ignorado por ausência da variável opcional de teste. A validação equivalente de SQL foi feita via conector. TypeScript, ESLint dos arquivos alterados, build de produção e `git diff --check` passaram.

Os testes adicionados cobrem round-trip de URL, links antigos, limites de paginação/paleta, vocabulários inválidos, JSON incompleto, estados dos atributos, confiança das sugestões, consultas parametrizadas, igualdade entre filtros de lista/contagem e autorização da API.

Não houve escrita no banco, migration ou deploy. A validação visual autenticada no navegador permanece pendente: a ferramenta de navegador falhou ao carregar sua política de acesso.

## Considerações técnicas

A definição e normalização dos critérios ficam no domínio; o helper SQL constrói apenas condições parametrizadas; o serviço valida e transforma a resposta; o componente mantém apresentação e estado da URL. Isso mantém responsabilidades específicas e permite acrescentar critérios pelo catálogo existente, sem criar uma hierarquia de classes. Não há subtipos novos aos quais aplicar substituição de Liskov. As interfaces continuam pequenas e o padrão de acesso ao repositório existente foi preservado.

Os atributos JSON usam os metadados já existentes, sem reprocessamento de IA nem alteração de schema. O catálogo atual é pequeno; esses predicados JSON poderão exigir índices específicos quando o volume crescer. As facetas mantêm o limite existente de 300 opções por campo, agora escolhidas por frequência. Para motivos que não apareçam na lista, use a pesquisa geral por prefixo ou palavra-chave.

## Busca ampliada por percentual de correspondência

A pesquisa geral agora inclui resultados que atendem pelo menos um critério. Na ordenação por **Correspondência e relevância**, o percentual é o primeiro critério de ordenação; a relevância textual, a atualização e o identificador desempatarão os resultados. Ordenações explícitas por código ou data continuam sendo respeitadas, com aviso na tela de que não priorizam percentuais.

O percentual é `critérios encontrados / critérios pesquisados × 100`, arredondado para uma casa decimal. Cada critério tem o mesmo peso. Em `cereja amarela`, ambos encontrados representam 100%; somente um representa 50%. Cada card mostra também os critérios encontrados e ausentes. O resumo informa quantos resultados completos e parciais existem em toda a busca aplicada, independentemente da página atual.

Esse percentual mede cobertura nos metadados e **não confiança da IA**. Dois termos presentes podem descrever elementos diferentes da imagem: cerejas vermelhas e flores amarelas podem atender os dois termos. Essa distinção aparece na interface. Frases entre aspas permitem exigir adjacência dos termos no texto indexado.

O usuário pode escolher busca ampliada, no mínimo 50%, no mínimo 75% ou 100%. Outros percentuais inteiros recebidos por link também são preservados. A opção faz parte da URL e da API em `correspondenciaMinima=1..100`; o padrão é `1`, que admite ao menos um critério. Esse controle sozinho não dispara uma pesquisa.

```text
/controle-midia/estampas?q=cereja+amarela&correspondenciaMinima=50&status=COMPLETED&pagina=1&porPagina=48&ordenacao=RELEVANCIA
```

Recursos do texto de busca:

- Prefixos: `cereja` encontra `cerejas`.
- Variações controladas de cores: `amarela` encontra também `amarelo`, `amarelas` e `amarelos`; também há grupos para vermelho, roxo, preto, branco, dourado, prateado, azul e marrom.
- Sinônimos têxteis continuam disponíveis, como `poá` e `bolinhas`.
- Expressões profissionais, como `animal print`, `azul claro`, `traço manual` e `sem direção dominante`, são um critério cada.
- Frases explícitas entre aspas são literais, preservam adjacência e não expandem sinônimos. Os prefixos dos lexemas continuam disponíveis.
- `-texto` ou `sem texto` excluem ocorrências desse critério. Exclusões são obrigatórias e não entram no denominador do percentual. É necessário informar também um critério positivo.
- Artigos/preposições e critérios repetidos não aumentam o denominador. Sinônimos equivalentes são deduplicados. No máximo 12 critérios entre positivos e exclusões; entradas excedentes, aspas incompletas e critérios simultaneamente incluídos/excluídos são rejeitados com mensagem clara.
- Códigos com prefixo alfabético e variante, como `MV27849-B`, preservam a identidade exata e funcionam mesmo sem vetor textual.

Por padrão, os filtros específicos continuam obrigatórios. A configuração de obrigatórios e preferências descrita abaixo permite flexibilizar explicitamente os filtros de conteúdo. Código, variante, status e exclusões permanecem obrigatórios. A ausência de pesquisa textual não gera um percentual artificial.

O link compartilhado é construído a partir dos critérios aplicados, do status efetivo, da paginação e da ordenação. Parâmetros externos desconhecidos e fragmentos não são copiados. O feedback de link copiado é reiniciado quando a busca muda.

### Verificação complementar em 08/10/2026

As consultas geradas pelo código foram executadas somente para leitura no banco:

| Consulta | Total | 100% | Parciais |
| --- | ---: | ---: | ---: |
| Cereja amarela, ampliada | 106 | 8 | 98 |
| Cereja amarela, mínimo de 100% | 8 | 8 | 0 |
| Cereja amarela + filtro obrigatório verde | 70 | 7 | 63 |
| Animal print aquarelado, excluindo texto | 75 | 0 | 75 |
| Código MV27849-B | 1 | 1 | 0 |

Os números refletem o catálogo naquele momento, não uma promessa de contagens futuras. Foram validados também 14 cenários sintéticos no PostgreSQL, cobrindo 100%, 50%, 66,7%, nenhuma correspondência, variações de cor, sinônimos, frases, exclusões e código/variante com vetor nulo; todos passaram.

Os novos testes locais cobrem interpretação da consulta, deduplicação, cálculo, limite de critérios, limites percentuais, construção parametrizada, prioridade da cobertura, filtros obrigatórios, resumo global, ausência de campos internos na resposta, restauração de URL e validação da API. A suíte final teve 207 testes aprovados, nenhuma falha e um teste opcional de conexão direta ignorado. TypeScript, lint dos arquivos alterados e build passaram. A conferência visual autenticada e o deploy continuam pendentes.


## Critérios obrigatórios e preferências

O formulário principal e o modal avançado agora apresentam um seletor de papel para cada critério de conteúdo preenchido. Marque **Obrigatório** para exigir o predicado inteiro ou **Preferência** para incluí-lo na cobertura percentual. Código, variante, status, exclusões e a seleção de registros ativos não podem ser preferências. Códigos identificados na pesquisa geral também são sempre obrigatórios.

A pesquisa geral continua como preferência por padrão; os demais filtros continuam obrigatórios até uma escolha explícita do usuário, preservando links anteriores. A pesquisa geral também pode ser marcada como obrigatória: nesse caso seus termos precisam ser atendidos e deixam de participar do percentual. O percentual considera somente as preferências ativas. Cada filtro estruturado vale um critério; a paleta de cores é um grupo único, seguindo o modo TODAS ou QUALQUER. Cada termo/frase da pesquisa geral preferencial vale um critério. Critérios vazios não pontuam. Sem preferências ativas, não é exibido percentual.

A correspondência mínima continua exigindo pelo menos uma preferência atendida por padrão. Restrições obrigatórias são sempre aplicadas antes da elegibilidade das preferências. A ordenação por correspondência funciona também quando só há preferências estruturadas, sem pesquisa textual.

O parâmetro `preferencias` contém os nomes dos filtros preferenciais separados por vírgula. Ausência do parâmetro restaura o padrão `consulta`; `preferencias=` representa explicitamente nenhuma preferência. A API rejeita campos desconhecidos ou protegidos nessa lista. A navegação web descarta nomes inválidos sem flexibilizar critérios protegidos.

```text
/controle-midia/estampas?estilo=romântico&linguagemVisual=aquarelado&cor=amarelo&preferencias=cores,linguagemVisual&correspondenciaMinima=1&status=COMPLETED&ordenacao=RELEVANCIA
```

Neste exemplo, estilo romântico é obrigatório; aquarelado e amarelo são preferências. A consulta gerada foi executada no banco em 08/10/2026 e encontrou 38 estampas: 12 atendendo ambas as preferências (100%) e 26 parciais (50%). Com mínimo de 100%, retornou 12. Uma consulta obrigatória por `cereja amarela -texto`, com estilo romântico preferencial, também foi validada. Código/variante obrigatórios foram verificados com e sem preferências de cores; sem preferências, a resposta não apresenta cobertura artificial.

A implementação reutiliza os mesmos predicados para obrigatórios e preferências, evitando diferenças entre modos. Novos testes cobrem todos os 19 filtros estruturados flexibilizáveis, isolamento das listas ao copiar o formulário, restauração da URL, obrigatoriedade do texto, códigos inseridos no texto e rejeição de relaxamento de status. A suíte geral passou com 214 testes; o teste adicional cobrindo todos os filtros também passou (8 testes focados de preferências aprovados). TypeScript, lint e build passaram. Sem migration, escrita no banco ou deploy; conferência visual autenticada pendente.
