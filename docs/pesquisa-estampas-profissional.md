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
