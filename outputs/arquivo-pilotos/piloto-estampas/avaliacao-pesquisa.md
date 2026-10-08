# Avaliação dos metadados para pesquisa profissional

Corte: 2026-10-08T13:07:18-03:00. O piloto continua em execução; novos registros não fazem parte deste retrato.

## Conclusão

**Claude Sonnet 5.5 apresentou a melhor riqueza de metadados para pesquisa profissional. Claude Haiku 5.5 foi o melhor custo-benefício para catalogação inicial. GPT‑5.4 mini foi a melhor configuração OpenAI avaliada.** Trata-se de uma conclusão preliminar sobre o conteúdo textual, sem comprovação de precisão visual.

## Base e método

Foram lidas 1471 linhas: 808 sucessos brutos, 658 combinações bem-sucedidas únicas e 150 cópias de sucesso desconsideradas. Todas as combinações bem-sucedidas únicas entraram nas métricas. A comparação direta usa 61 imagens com o mesmo id e hash, bem-sucedidas nas cinco configurações.

Foi mantido o primeiro sucesso por imagem/hash/provider/model/detail/thinkingLevel, respeitando a regra de reutilização do piloto. Não foram somadas cópias ou tentativas históricas. A análise qualitativa examinou metadados de 23 imagens pareadas: as 20 primeiras por id e três exemplos adicionais (barrado, mockup floral e lenço). Não representa uma anotação visual completa do lote.

## Todos os sucessos únicos

| Configuração | Sucessos únicos | Aprovados pelas regras | Palavras-chave médias |
|---|---:|---:|---:|
| gpt-4o-mini / low | 155 | 139/155 (89.7%) | 4.64 |
| gpt-4o-mini / high | 158 | 147/158 (93.0%) | 4.72 |
| gpt-5.4-mini / high | 189 | 179/189 (94.7%) | 8.59 |
| claude-haiku-5-5 / auto | 79 | 75/79 (94.9%) | 8.34 |
| claude-sonnet-5-5 / auto | 77 | 77/77 (100.0%) | 10.34 |

## Mesmas 61 imagens

| Configuração | Aprovados pelas regras | Palavras-chave médias | Com classificação têxtil | US$/chamada aceita | Latência mediana |
|---|---:|---:|---:|---:|---:|
| gpt-4o-mini / low | 53/61 | 4.66 | 51/61 | 0.001078 | 6.53s |
| gpt-4o-mini / high | 55/61 | 4.62 | 56/61 | 0.003425 | 7.01s |
| gpt-5.4-mini / high | 58/61 | 8.74 | 58/61 | 0.004803 | 4.82s |
| claude-haiku-5-5 / auto | 61/61 | 8.44 | 55/61 | 0.002351 | 13.44s |
| claude-sonnet-5-5 / auto | 61/61 | 10.61 | 58/61 | 0.029862 | 8.80s |

A quantidade de termos e a presença de classificação não provam qualidade. Vazios legítimos e estados indeterminados não foram penalizados. APROVADO é o resultado da função local de qualidade; ok:true significa resposta tecnicamente aceita, podendo continuar com PRECISA_REVISAO. O custo acima é a média salva das chamadas bem-sucedidas, sem tentativas malsucedidas.

## O que diferencia os resultados

**Sonnet:** vocabulário mais discriminante, com composição, acabamento, contraste, cores e subtipos de motivos. Exemplos: “arcos ogivais”, “folhas lanceoladas”, “fileiras alternadas”, “tom sobre tom”, “textura mosqueada”. Permite consultas mais específicas que um rótulo como floral. Nas 61 imagens pareadas teve 10,61 termos em média e aprovação automática em todas.

**Haiku:** se aproxima do Sonnet em motivos e organização espacial, com boas expressões como “treliça ornamental”, “folhagem translúcida”, “grade alternada” e “veios de madeira”. Nas chamadas bem-sucedidas pareadas, Sonnet custou aproximadamente 12,7 vezes o Haiku. A linguagem visual nem sempre é tão específica: no mockup de rosas, Haiku usa “outro” enquanto a descrição fala de ilustração sombreada.

**GPT‑5.4 mini:** bom enriquecimento de motivos, cores e composição, normalmente superior ao GPT‑4o mini. Produziu “floral miúdo”, “malha ornamental”, “manchas irregulares” e combinações cromáticas úteis. Em alguns layouts mistura a apresentação com a arte: centralização do texto vira atributo de distribuição, e “código”, “texto central” ou “tipografia central” aparecem nas palavras-chave.

**GPT‑4o mini:** identifica famílias básicas, mas perde características discriminantes e recorre mais a aplicações genéricas. Low e high ficaram próximos em riqueza textual (4,66 e 4,62 termos); high custou cerca de 3,18 vezes low nesta comparação. Não aparece um ganho suficiente para preferir high como solução de pesquisa profissional.

## Exemplos comparáveis

| Imagem | Diferença útil observada nos metadados |
|---|---|
| MV23019 150x150 Logo AA.jpg | 4o low: abstrato, ondulado, colorido, moderno. Haiku/Sonnet: op art, ondas psicodélicas, efeito óptico, composição diagonal; Sonnet acrescenta combinações cromáticas e anos 70. Estética anos 70 é interpretação e deve ser tratada como tal. |
| MV27181-N.jpg | 4o: floral/ornamental. 5.4 e Claude: paisley, volutas, folhagem; Sonnet acrescenta traço manual, diagonal e tons terrosos. |
| MV27999-b mockuop.jpg | 4o high inclui estampa leve e verão; 5.4 descreve floral miúdo e buquês; Claude detalha fileiras alternadas, folhas verde-oliva e aplicação em vestido. Há divergência sobre a linguagem da arte. |
| lenço_vermelho.png | Sonnet: treliça arabesca, buquê floral, creme sobre vinho, linhas finas, arcos ogivais. Haiku: treliça ornamental, arcos entrelaçados e bege sobre bordô. São descritores mais úteis que design simétrico. |

Esses exemplos mostram diferenças de especificidade, não confirmam que o modelo viu a imagem corretamente.

## Riscos e pontos de melhoria

Entre as 61 imagens comuns, os modelos discordam na apresentação em 33, distribuição em 26, linguagem visual em 36 e densidade em 46. Divergência não identifica automaticamente quem errou; é uma boa fila de revisão.

1. Separar atributos da arte dos elementos de apresentação: código, régua, assinatura, texto e moldura de catálogo. Não usar centralização de código para classificar a composição da estampa. Barrado exige distinguir borda da arte de moldura da apresentação.

2. Definir melhor linguagem visual. Contorno nítido não comprova arquivo vetorial; aparência realista não comprova origem fotográfica. Usar aparência vetorial e ilustração realista quando o formato de origem não é observável, ampliando a taxonomia se necessário.

3. Indexar motivos, composição, linguagem e cores diretamente, com normalização e sinônimos. Não depender exclusivamente de palavrasChave: corrido/corrida/distribuição corrida, vinho/bordô, floral botânico/folhagem precisam de uma estratégia consistente de recuperação.

4. Manter aplicações sugeridas separadas da busca por características observadas. Há evidências fracas, sobretudo no 4o, como “uso frequente em roupas de banho” e “ideal para forração de móveis”: isso não é evidência visual.

5. Validar buscas reais com designers: consultas como “paisley diagonal em tons terrosos”, “poá preto e branco com moldura” e “folhagem aquarelada em azul com baixo contraste”. Medir precisão dos primeiros resultados e capacidade de recuperar imagens relevantes com anotações humanas.

## Recomendação de uso

Usar Haiku como candidato a catalogação inicial em escala e Sonnet para casos ambíguos ou de maior valor, encaminhando divergências objetivas à revisão. GPT‑5.4 mini é uma boa alternativa de provider. Esta avaliação não altera a configuração do piloto nem justifica reexecutar sucessos já persistidos.

## Limites da comparação

Gemini não possui sucesso no corte e ficou fora. Claude e OpenAI usam contratos de transporte diferentes, prompts efetivos diferentes e limites de saída de 4096 e 1600 tokens, respectivamente. A conclusão compara configurações reais do piloto, não isola o efeito do modelo. As 61 imagens têm variantes e famílias semelhantes e representam apenas a interseção dos sucessos; não permitem concluir taxa de sucesso operacional, precisão visual ou qualidade final de recuperação de um catálogo de 195 mil imagens.
