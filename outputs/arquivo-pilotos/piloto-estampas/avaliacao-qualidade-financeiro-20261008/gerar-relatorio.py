import json,pathlib
P=pathlib.Path(__file__).resolve().parent;d=json.loads((P/'metricas.json').read_text());ms=d['metricas'];by={m['configuracao'][1]+' / '+m['configuracao'][2]:m for m in ms}
def name(m):return m['configuracao'][1]+' / '+m['configuracao'][2]
def usd(x,digits=2):return 'US$ '+f'{x:,.{digits}f}'.replace(',','@').replace('.',',').replace('@','.')
def pct(a,b):return f'{100*a/b:.1f}%'.replace('.',',')
def num(x,n=2):return f'{x:.{n}f}'.replace('.',',')
haiku=by['claude-haiku-5-5 / auto'];sonnet=by['claude-sonnet-5-5 / auto'];H=haiku['operacao']['projecao_195k_com_falhas_conhecidas'];S=sonnet['operacao']['projecao_195k_com_falhas_conhecidas'];total=sum(m['operacao']['custo_total_conhecido'] for m in ms);redo=sum(m['operacao']['custo_sucessos_reexecutados'] for m in ms)
lines=[f'''# Relatório completo: qualidade e viabilidade financeira do piloto de estampas

Corte dos dados: **{d['corte']['data_corte']}**. Fonte: `outputs/arquivo-pilotos/piloto-estampas/resultados.jsonl`. O arquivo de resultados foi somente lido. Esta avaliação preserva um snapshot, os scripts e as evidências em sua própria pasta.

## 1. Decisão recomendada

**Melhor equilíbrio qualidade/financeiro: Claude Haiku 5.5. Melhor qualidade e estabilidade dos metadados: Claude Sonnet 5.5. Menor custo nominal: GPT‑4o mini low. Melhor alternativa OpenAI: GPT‑5.4 mini high.**

Para catalogar 195 mil imagens, escolheria **Haiku como primeira análise**, com revisão de coerência e Sonnet apenas nos casos que realmente exigirem enriquecimento ou adjudicação. Não faria duas chamadas para toda imagem. Sonnet é um candidato a fallback; a combinação Haiku→Sonnet ainda não foi avaliada como fluxo de produção e não elimina erros compartilhados.

A configuração atual do Haiku projeta **{usd(H)}** para 195 mil imagens considerando as falhas com custo conhecido e excluindo reexecuções após sucesso. Com uma reserva ilustrativa de 20%, o orçamento fica em **{usd(H*1.2)}**. Estes são valores estimados de API, sem impostos, câmbio, armazenamento, embeddings, infraestrutura ou revisão humana.

Se o processamento inicial puder ser assíncrono, **Haiku via Message Batches é o candidato financeiro mais interessante**: a documentação oferece 50% de desconto e suporte a visão. Aplicado hipoteticamente ao mesmo consumo, daria cerca de **{usd(H/2)}**, ou **{usd(H*.6)} com reserva de 20%**. O piloto usa Messages síncrono, e Batch Anthropic ainda precisa de implementação e validação. [Documentação oficial de Batch Anthropic](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

## 2. Correções em relação à avaliação anterior

A contagem de **658 sucessos únicos** continua correta para escolher um resultado por imagem/configuração. Porém, os **150 sucessos adicionais não eram cópias importadas**: os 808 sucessos têm IDs de requisição distintos. São chamadas reais repetidas para combinações que já tinham sucesso e precisam entrar no custo histórico.

A estimativa anterior de aproximadamente **US$ 462 para Haiku** era o custo médio das primeiras chamadas bem-sucedidas. Ao acrescentar falhas conhecidas, passa a aproximadamente **US$ 521**. Isso não transforma falhas sem consumo registrado em custo zero.

Não recomendo manter GPT‑4o mini high para este objetivo: a qualidade observada ficou próxima à de low, com custo bem maior. Também não recomendo aplicar Sonnet a todo o catálogo somente por gerar mais termos.

## 3. Cobertura e método

- **1.471 linhas**, com **808 chamadas bem-sucedidas**, representando **658 combinações únicas com sucesso**.
- **617 das 658** combinações foram APROVADAS pelas regras locais; as outras 41 têm sucesso técnico, mas precisam de revisão de metadados.
- **208 imagens** aparecem no histórico, de uma amostra planejada de **561**. Claude foi tentado em apenas 80–81 imagens. O piloto está incompleto; a presença de uma linha não comprova execução ativa.
- Comparação de conteúdo: **61 imagens com o mesmo id e hash**, com sucesso nas cinco configurações avaliáveis.
- Comparação operacional: **80 imagens tentadas nas cinco configurações**; considera se houve ao menos um sucesso até o corte, e não sucesso na primeira chamada.
- Nova validação de contrato e recálculo de custo em **todos os 808 sucessos**.
- Conferência visual de **13 previews**, cobrindo poá, op art, folhagem localizada, paisley, hibisco, micro-geometria, madeira simulada, desenho de regata, barrado, mockup de vestido e arabesco.
- Os hashes dos 13 previews baixados coincidem com os bytes usados no piloto.
- Teste diagnóstico de **26 consultas profissionais**, usando o texto gerado pela função atual `construirTextoPesquisa` e grupos explícitos de termos/sinônimos.
- Estabilidade: análises repetidas existentes, sem chamadas adicionais de LLM; comparação pareada Haiku/Sonnet em **55 imagens reanalisadas pelos dois modelos**.

Foi retido o primeiro `ok:true` por `id + imageHash + provider + model + detail + thinkingLevel`, em coerência com o reuso do piloto. O custo histórico usa tentativas distintas, identificadas por hash histórico ou tentativaId. Nenhum modelo foi chamado nesta avaliação; houve apenas leitura dos resultados e download dos previews para inspeção.

As consultas e a revisão visual foram elaboradas pelo assistente, não de forma cega ou aleatória, e não foram validadas por designers. O teste lexical mede presença dos conceitos na imagem esperada; **não mede precision@k, recall do catálogo, ranking, embeddings ou satisfação de busca**. Não é uma taxa de precisão visual.

## 4. Resultado técnico e qualidade automática

`ok:true` significa que a resposta foi tecnicamente aceita. APROVADO significa que passou nas regras atuais de qualidade. Nenhum dos dois equivale a acerto visual.

| Configuração | Sucessos únicos / imagens tentadas | Aprovados pelas regras | Sucessos nas mesmas 80 imagens |
|---|---:|---:|---:|''']
for m in ms:
 a=m['todos'];o=m['operacao'];lines.append(f"| {name(m)} | {a['n']}/{o['imagens_tentadas']} | {a['aprovados']}/{a['n']} ({pct(a['aprovados'],a['n'])}) | {o['sucessos_nas_80_comuns']}/80 ({pct(o['sucessos_nas_80_comuns'],80)}) |")
lines+=['''
O Haiku teve maior cobertura técnica na comparação operacional, e Sonnet teve mais aprovações automáticas entre seus resultados aceitos. Há viés de sobrevivência nas 61 imagens completas; por isso as 80 tentadas são apresentadas separadamente. Não extrapolar estas proporções diretamente para todo o catálogo.

**Gemini foi excluído do ranking:** não há sucessos; existem 418 tentativas com erro de autenticação. O bloqueio de acesso não demonstra qualidade inferior do modelo, e o custo não registrado não deve ser apresentado como custo zero comprovado.

## 5. Utilidade para pesquisa: mesmas 61 imagens

| Configuração | Aprovação pelas regras | Termos médios | Classificação têxtil preenchida | Termos amplos/genéricos¹ |
|---|---:|---:|---:|---:|''']
for m in ms:
 a=m['pareados'];lines.append(f"| {name(m)} | {a['aprovados']}/61 | {num(a['media_termos'])} | {a['classificacao_textil_preenchida']}/61 | {a['termos_amplos_ou_genericos']}/{a['total_termos']} |")
lines+=['''
¹ Contagem lexical diagnóstica: estampa, padrão, design, imagem, arte, moda, moda praia, decoração, acessórios, vestuário, moderno, design moderno, decorativo, verão e deco. Aplicações como moda praia têm valor em sua propriedade específica, mas pouca capacidade de distinguir motivos visuais quando ocupam palavras-chave. A lista usada está no script e não é uma avaliação completa de genericidade.

Não usei quantidade de palavras como nota de qualidade. Um resultado pode ser útil com poucos termos. Não penalizei ausência legítima de público, ocasião ou aplicação, e não interpretei confiança autorrelatada como precisão.

O Sonnet gera mais relações utilizáveis entre motivo, acabamento, cor, contraste e composição. Haiku fica próximo em especificidade. GPT‑5.4 recupera motivos melhores que GPT‑4o, mas em **8 das 533 palavras-chave pareadas** aparecem referências a código, texto central ou tipografia: esses termos podem ajudar a identificar um layout, mas devem ficar separados dos motivos da arte. Buscar por SKU/código continua útil e não deve ser removido.

## 6. Nova validação: consultas profissionais

Foram criadas duas consultas por preview, uma mais simples e outra combinando conceitos. Exemplos: “paisley diagonal”, “folhagem azul localizada”, “losangos com baixo contraste”, “buquês em fileiras alternadas” e “barrado geométrico vermelho”.

| Configuração | Conceitos presentes no índice atual | Conceitos presentes somente nas palavras-chave |
|---|---:|---:|''']
for m in ms:
 a=m['buscas'];lines.append(f"| {name(m)} | {a['indice_atual']}/26 ({pct(a['indice_atual'],26)}) | {a['so_keywords']}/26 |")
lines+=['''
**Haiku cobriu 24 consultas e Sonnet 25.** A diferença neste conjunto é pequena diante do custo. GPT‑5.4 cobriu 16. O índice completo melhora a cobertura em relação a usar apenas `palavrasChave`, porque inclui título, descrição, composição, taxonomias e cores.

Limitações concretas: o Sonnet perde “poá com grade alternada” porque usa “grade regular”; Haiku perde “barrado geométrico vermelho” e a combinação exata de ramo localizado com faixas verticais. Essas perdas lexicais não provam que uma busca semântica falharia. A busca deve tratar variações, sinônimos e filtros, sem inventar equivalências que descaracterizem composição.

Sonnet contém a palavra barrado em outro campo da imagem MV27792.jpg, mas sua distribuição estruturada é apenas corrido. **Uma consulta textual pode passar enquanto o filtro barrado falha.** Isso reforça a necessidade de validar texto e propriedades separadamente.

## 7. Conferência visual: acertos e falhas verificadas

| Caso | Evidência observada | Resultado relevante |
|---|---|---|
| Op art, MV23019 | Ondas multicoloridas e diagonais | Claude identifica op art/psicodélico e diagonal. GPT‑4o low afirma contorno de vaso sem sustentação clara no preview. |
| Quadrados, MV23020 | Quadrados concêntricos convergindo ao centro | GPT‑5.4 e Claude classificam centralizado. GPT‑4o low/high usam corrido, prejudicando o filtro. |
| Folhagem MV27065-E/F | Ramo grande concentrado à esquerda, faixas verticais à direita; sem repetição evidente na área visível | Claude reconhece localizado. GPT‑4o e GPT‑5.4 usam corrido. |
| Paisley, MV27181-N | Paisley, volutas, folhagem, fluxo diagonal | GPT‑5.4 e Claude reconhecem paisley; GPT‑4o permanece em floral. |
| Micro-geometria, MV27599-E | Micro-losangos densos em baixo contraste | Claude traz losangos; Sonnet detalha baixo contraste e eixo vertical. GPT‑4o é genérico. |
| Regata, MV27789 | Silhueta plana desenhada com flor de laçadas/cordão | Haiku e Sonnet detalham o motivo, mas ambos registram objetoFisicoVisivel=true sem evidência de produto físico. |
| Barrado, MV27792 | Bandas horizontais com motivos geométricos | GPT‑4o e GPT‑5.4 marcam barrado; Haiku e Sonnet usam apenas corrido na distribuição. |
| Vestido, MV27999 | Modelo real, vestido e painel com buquês repetidos e espaçados | Claude distingue aplicação e painel. GPT‑4o low confunde repetição de motivos isolados com localizado. |
| Lenço vinho | Treliça curvilínea, pequenos buquês e moldura | Claude combina treliça, arcos, buquês e cores; GPT‑5.4 reconhece arabesco; GPT‑4o low permanece geométrico. |

A revisão individual dos 13 previews está em `revisao-visual.json`; os dois contatos visuais estão na mesma pasta. A amostra serve para localizar falhas e confirmar diferenças de especificidade, não para inferir uma taxa de acerto global.

**Linguagem visual continua problemática:** hibisco recebe fotográfico, vetorial ou aquarelado; rosas realistas também são tratadas de formas distintas. Aparência vetorial não comprova formato vetorial e realismo não comprova fotografia. A taxonomia precisa permitir ilustração realista, aparência gráfica e textura pictórica, separando aparência observada de técnica de origem.

## 8. Estabilidade em reanálises das mesmas imagens

Comparação Haiku/Sonnet no mesmo conjunto de **55 imagens** com múltiplos sucessos. “Inalterado” significa que todas as respostas repetidas concordaram no atributo. Não significa que estavam corretas.

| Atributo | Haiku: inalterado | Sonnet: inalterado |
|---|---:|---:|''']
labels={'tipo':'Apresentação','distribuicao':'Distribuição','orientacao':'Orientação','densidade':'Densidade','linguagem':'Linguagem visual','padroes':'Padrões têxteis'}
for k,label in labels.items():
 a=d['estabilidade_pareada_claude']['claude-haiku-5-5'][k+'_inalterado'];b=d['estabilidade_pareada_claude']['claude-sonnet-5-5'][k+'_inalterado'];lines.append(f'| {label} | {a}/55 ({pct(a,55)}) | {b}/55 ({pct(b,55)}) |')
lines+=['''
Sonnet é mais estável em apresentação, orientação, densidade, linguagem e padrões; Haiku foi ligeiramente mais estável em distribuição. Isto justifica Sonnet para casos ambíguos, sem provar que ele será sempre melhor nem que estabilidade equivale a verdade.

No conjunto de reanálises de cada configuração, a sobreposição literal de palavras-chave (Jaccard primeiro/último) foi 25,7% no Haiku e 43,5% no Sonnet. São grupos de tamanhos distintos, e sinônimos reduzem a sobreposição; não usar esse indicador como ranking isolado. OpenAI tem somente 6–9 imagens repetidas por configuração, insuficientes para comparar estabilidade com Claude de forma justa.

## 9. Auditoria de tentativas e gasto histórico

| Configuração | Tentativas | Falhas | Falhas sem custo | Reexecuções após sucesso | Custo total conhecido | Custo dessas reexecuções |
|---|---:|---:|---:|---:|---:|---:|''']
for m in ms:
 o=m['operacao'];lines.append(f"| {name(m)} | {o['chamadas']} | {o['falhas']} | {o['falhas_sem_custo']} | {o['sucessos_reexecutados']} | {usd(o['custo_total_conhecido'],4)} | {usd(o['custo_sucessos_reexecutados'],4)} |")
lines+=[f'''
O gasto conhecido das cinco configurações soma **{usd(total)}**. As reexecuções após sucesso representam **{usd(redo)}**, aproximadamente **{pct(redo,total)}** desse gasto. Esse gasto é real, mas não deve ser projetado como necessário em um fluxo que reutiliza sucessos corretamente. Não foi inferida a causa das reexecuções a partir dos logs.

Há **92 falhas sem custo conhecido** nas configurações com sucesso, além das 418 tentativas Gemini. Valores nulos podem incluir timeout, rate limit ou rejeição HTTP sem uso registrado. O relatório não presume que foram cobrados nem que foram gratuitos.

Principais falhas:

- GPT‑4o low: 80 INVALID_STRUCTURED_OUTPUT e 13 RATE_LIMIT.
- GPT‑4o high: 76 INVALID_STRUCTURED_OUTPUT, 16 RATE_LIMIT e um TIMEOUT.
- GPT‑5.4: 18 INVALID_STRUCTURED_OUTPUT, 14 RATE_LIMIT e uma falha temporária.
- Haiku: cinco OUTPUT_TRUNCATED, quatro INVALID_STRUCTURED_OUTPUT, duas falhas temporárias e uma rejeição HTTP.
- Sonnet: 13 INVALID_STRUCTURED_OUTPUT e uma rejeição HTTP; descrição e coerência de aplicação aparecem entre os caminhos de validação.

Esses totais descrevem o histórico do piloto e podem incluir tentativas de diagnóstico. Não são uma medição controlada da probabilidade futura de falha. O cálculo inclui toda falha com custo conhecido; isso torna a projeção operacional mais prudente que usar somente sucessos.

## 10. Projeção financeira para 195 mil imagens

Fórmulas:

- Base: `195000 × soma(custo dos primeiros sucessos) / sucessos únicos`.
- Com falhas conhecidas: `195000 × (custo dos primeiros sucessos + custo das falhas conhecidas) / sucessos únicos`.
- Reserva ilustrativa: `projeção com falhas conhecidas × 1,20`.

| Configuração | Uma chamada aceita por imagem | Incluindo falhas conhecidas | Com reserva adicional de 20% |
|---|---:|---:|---:|''']
for m in ms:
 o=m['operacao'];lines.append(f"| {name(m)} | {usd(o['projecao_195k_base'])} | {usd(o['projecao_195k_com_falhas_conhecidas'])} | {usd(o['projecao_195k_com_reserva20'])} |")
lines+=['''
A tabela usa todos os primeiros sucessos disponíveis de cada configuração: 155, 158, 189, 79 e 77, respectivamente. O conjunto de imagens não é idêntico nesta tabela financeira; a tabela seguinte traz custo e latência nas mesmas 61 imagens. O aumento com falhas é um custo conhecido por resultado obtido no lote incompleto, não uma garantia de que todas as 195 mil imagens serão aprovadas no mesmo regime.

| Configuração | US$/mil chamadas aceitas pareadas | Latência mediana | Latência P90 |
|---|---:|---:|---:|''']
for m in ms:
 a=m['pareados'];lines.append(f"| {name(m)} | {usd(a['custo_medio']*1000)} | {num(a['latencia_mediana_s'])}s | {num(a['latencia_p90_s'])}s |")
lines+=['''
Haiku é econômico, mas foi mais lento que Sonnet neste contrato. Nos primeiros sucessos, Haiku gerou em média cerca de 3.048 tokens de saída, contra 1.307 no Sonnet. Os dados salvos não permitem separar com segurança quanto desse consumo pertence a raciocínio e quanto ao JSON. Limite de tokens é teto, não consumo fixo.

Não converti para reais com uma taxa arbitrária. Para orçamento em BRL: multiplique o total em USD pelo câmbio efetivo de cobrança e acrescente impostos/tarifas aplicáveis.

## 11. Estratégia Haiku + Sonnet: cenários, não fluxo já medido

O fallback adiciona uma segunda chamada às imagens encaminhadas. Portanto não se deve substituir o custo Haiku pelo Sonnet nesses casos.

Fórmula: `195000 × custoHaiku + 195000 × proporçãoEncaminhada × custoSonnet`.

| Cenário síncrono | Projeção com falhas conhecidas | Com reserva adicional de 20% |
|---|---:|---:|''']
for p in [0,.05,.1,.2,1]:
 label='Somente Haiku' if p==0 else 'Haiku + Sonnet em '+str(int(p*100))+'% das imagens';lines.append(f'| {label} | {usd(H+p*S)} | {usd((H+p*S)*1.2)} |')
lines+=['''
Os percentuais são cenários de planejamento, não taxas inferidas da amostra visual. Aprovação automática não detectou as falhas de regata/barrado; usar somente `qualidade.precisaRevisao` para encaminhar casos deixaria passar problemas importantes.

Roteamento recomendado: falha de contrato após uma retentativa adequada; contradição entre apresentação e suporte físico; composição indeterminada em uma arte em que ela importa; ramo concentrado classificado corrido sem evidência de repetição; faixas descritas sem classificação estrutural compatível; ausência de motivo específico que a descrição já reconhece. Se Sonnet mantiver a contradição, preservar atributos válidos e enviar à revisão.

## 12. Preços, cache e Batch

As tarifas de entrada/saída usadas no código coincidem com as fontes oficiais verificadas em 08/10/2026:

| Modelo | Entrada por milhão de tokens | Saída por milhão de tokens |
|---|---:|---:|
| GPT‑4o mini | US$ 0,15 | US$ 0,60 |
| GPT‑5.4 mini | US$ 0,75 | US$ 4,50 |
| Haiku 5.5, prompts até 100 mil tokens | US$ 0,10 | US$ 0,50 |
| Sonnet 5.5 | US$ 2,00 | US$ 10,00 |

Fontes: [OpenAI Docs — GPT‑4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [OpenAI Docs — GPT‑5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Anthropic — Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5), [Claude Platform — Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview).

**Cache:** OpenAI já possui tokens de cache registrados e os custos acima incluem esse benefício. Claude tem zero tokens de cache nos primeiros sucessos; o provider atual não solicita cache. Não atribuir a Claude um desconto de cache que ainda não foi medido. Além disso, o código usa US$ 0,20/M para cache de Sonnet, mas a documentação atual informa US$ 0,10/M. Isso não altera esta amostra sem cache; deve ser corrigido antes de estimar futuras chamadas cacheadas. [Preço atual de cache Sonnet](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5).

**Batch:** a API Anthropic suporta visão e oferece desconto de 50%; OpenAI também documenta desconto de 50% em Batch. A API, a persistência de custom_id e a recuperação de resultados precisam ser implementadas e testadas mantendo idempotência, reuso de sucessos e tratamento de erros por item. As imagens base64 também contam no tamanho do lote. Não assumir que o fluxo síncrono atual recebe o desconto. [Batch Anthropic](https://platform.claude.com/docs/en/build-with-claude/batch-processing), [Batch OpenAI](https://developers.openai.com/api/docs/guides/batch).

| Projeção hipotética Batch | Base, só chamadas aceitas | Com mesmo volume de falhas conhecidas | Com reserva adicional de 20% |
|---|---:|---:|---:|''']
for m in [haiku,sonnet]:
 o=m['operacao'];lines.append(f"| {name(m)} | {usd(o['projecao_195k_base']/2)} | {usd(o['projecao_195k_com_falhas_conhecidas']/2)} | {usd(o['projecao_195k_com_falhas_conhecidas']*.6)} |")
lines+=['''
A simulação Batch aplica metade do custo às mesmas chamadas, sem pressupor desconto extra de cache ou mesma taxa futura de falhas. Um experimento real pode ter latência e distribuição de erros diferentes.

## 13. Melhorias prioritárias antes da escala

1. **Coerência de apresentação:** desenho de produto, mockup digital e fotografia de peça física devem ser distinguidos. A flag objetoFisicoVisivel precisa de evidência de suporte físico, e não somente silhueta de roupa.
2. **Composição profissional:** definir corrido como repetição visível, localizado como concentração sem repetição, e barrado como organização em bandas/bordas da arte. Motivos isolados repetidos podem ser corridos. Faixas devem ser avaliadas mesmo quando a composição também é corrida.
3. **Separar arte e apresentação:** código, legenda, régua e marca não são motivos da estampa. Uma moldura pode ser parte da arte de lenço ou apenas do catálogo; registrar a evidência e permitir indeterminação.
4. **Rever linguagem visual:** armazenar aparência observada separada da técnica de origem. Não exigir que o modelo adivinhe vetor, fotografia ou aquarela real a partir de raster de baixa resolução.
5. **Pesquisa por atributos:** indexar composição, motivos, linguagem, cores e estilo; manter aplicações sugeridas em camada própria. Normalizar singular/plural, corrido/corrida, vinho/bordô e variações cromáticas. Não depender só de palavras-chave.
6. **Custos completos:** registrar consumo de cada tentativa; manter nulo quando não houver uso confiável; separar chamada aceita, revisão, tentativa malsucedida e reexecução após sucesso. Não somar linhas de `resumo.json` sem normalizar configuração: ele contém duas entradas equivalentes de Haiku devido à ordem das propriedades do objeto.
7. **Falhas do Haiku:** investigar truncamento com 4096 tokens antes de fixar um limite menor. Ajustes de esforço e tamanho de contrato são candidatos a novo piloto pequeno; alterar sem medir pode diminuir custo e piorar conformidade.
8. **Falhas do Sonnet:** limitar descrição e vincular aparência física com evidência. Sonnet gerar texto mais rico não justifica quebrar limites do contrato.
9. **Idempotência:** o histórico mostra custo evitável em sucessos reexecutados. A identidade de reuso deve continuar usando imagem/hash/provider/model/detail/thinking; diagnóstico separado não pode virar reexecução automática de todos os sucessos.

Estas são recomendações. Esta avaliação não modificou providers, prompts, modelos, contratos ou o executor do piloto.

## 14. Plano de validação para fechar a decisão

A recomendação atual é suficiente para escolher Haiku como candidato econômico. Para aprovar processamento integral, falta verificar o resultado da busca com usuárias reais.

- Completar primeiro as combinações pendentes do piloto atual, preservando sucessos existentes. Resolver o acesso Gemini antes de incluí-lo no ranking.
- Criar uma referência anotada por designers em pelo menos 100 imagens estratificadas por família visual; evitar que variantes da mesma arte dominem a amostra. Incluir corrido/localizado/barrado, layouts, produtos reais e motivos ambíguos.
- Anotar motivo principal/subtipo, composição, linguagem observável e suporte físico. Permitir indeterminação, com regras de avaliação comuns aos modelos.
- Definir 30–50 consultas das designers antes de olhar os resultados dos modelos. Medir precision@10, recall sobre o conjunto anotado e taxa de imagens realmente reaproveitáveis entre os primeiros resultados.
- Separar avaliação cega de precisão visual da avaliação de utilidade para pesquisa. Uma descrição detalhada porém incorreta pode prejudicar ambas.
- Testar Haiku e Sonnet nas mesmas imagens, sem importar o resultado de um modelo para o outro, e medir gasto completo por imagem aprovada. Incluir o custo e o tempo da revisão humana.
- Usar decisões por comparação pareada e intervalo de incerteza; aceitar Haiku se atender o mínimo de qualidade definido pelas designers e mantiver economia relevante. Os limites de aceitação devem ser definidos antes desse teste, não deduzidos das 13 imagens já examinadas.
- Medir fallback e Batch em um lote separado e pequeno antes de usar suas projeções como orçamento contratado.

## 15. Limites e evidências disponíveis

A comparação é entre **configurações reais**, não entre modelos isolados: OpenAI e Claude têm prompts efetivos diferentes, contratos de transporte diferentes, detalhes low/high/auto e tetos de saída de 1600/4096. As 61 imagens possuem variantes e famílias semelhantes. A referência visual pequena e não cega não comprova precisão para 195 mil imagens.

Em 61 imagens, os modelos discordam em apresentação em 33, distribuição em 26, orientação em 48, densidade em 46, linguagem em 36 e padrões têxteis em 45. Discordância localiza casos de revisão; não identifica automaticamente o modelo correto.

A estimativa financeira usa preços verificados, tokens salvos e dados do piloto incompleto. A fatura do provider não foi reconciliada, e custos nulos não foram imputados. Não há preço em reais, garantia de orçamento ou economia de cache/Batch já realizada.

Arquivos de evidência na mesma pasta:

- `metricas.json`: métricas, 130 verificações de consulta e fila de divergências.
- `validacoes-contrato.json`: revalidação dos 808 sucessos, recálculo de custos e texto de pesquisa atual.
- `revisao-visual.json` e `amostra-visual.json`: observações e identificação dos previews; contato-1.jpg e contato-2.jpg para inspeção.
- `snapshot.jsonl` e `corte.json`: fonte congelada, horário e SHA‑256.
- `validar-contrato.mts`, `avaliar.py`, `gerar-relatorio.py`: reprodução offline. A avaliação verifica contagens, identidade de chamadas, pareamento, hash dos previews e decomposição dos custos.

**Decisão proposta:** Haiku para catalogação em escala, Sonnet para situações justificadas e revisão humana quando ambos mantiverem ambiguidade. Para o carregamento inicial, priorizar a validação de Batch Haiku. A qualidade profissional depende também das regras de coerência e do índice; trocar apenas o modelo não corrige os erros compartilhados.
''']
(P/'relatorio-completo.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'relatorio':str(P/'relatorio-completo.md'),'palavras':len(('\n'.join(lines)).split()),'totalConhecidoUsd':total,'reexecucoesConhecidasUsd':redo},ensure_ascii=False))
