export type ProdutoMockupPromptInput = {
  nomeProduto: string;
  sku: string;
  tamanho: string;
  descricaoEstampa: string;
  descricaoVariante: string;
  detalhesPromptIa: string;
};

export function buildProdutoMockupPrompt(input: ProdutoMockupPromptInput) {
  return `Use a primeira imagem como mockup principal do produto.

Use a segunda imagem como referencia obrigatoria da estampa/arte.

Prioridade maxima: a estampa da segunda imagem deve ser preservada como arte original. Nao redesenhe, nao resuma, nao interprete e nao substitua a arte. Trate a segunda imagem como fonte visual literal que deve ser transferida para o produto.

Se a estampa possuir texto, letras, numeros, logotipos, frases, simbolos ou assinatura visual:
- manter exatamente o mesmo texto
- manter todas as palavras legiveis
- manter grafia, acentos, pontuacao e ordem dos caracteres
- manter tipografia aparente
- manter logotipos e simbolos sem alteracao
- nao inventar letras
- nao trocar palavras
- nao borrar texto
- nao omitir textos pequenos quando estiverem visiveis na arte original
- nao substituir texto por pseudo-texto

Antes de gerar a imagem, interprete cuidadosamente as duas referencias:
- a primeira imagem define camera, enquadramento, angulo, distancia focal aparente, fundo, iluminacao, volume do produto e acabamento fotografico
- a segunda imagem define a arte final que deve ser aplicada, com cores, contraste, limites, detalhes finos, textos e proporcoes originais
- quando houver conflito, preserve a estrutura fotografica do mockup e preserve a identidade visual da estampa

Aplique a estampa da segunda imagem no produto do mockup mantendo:

- mesmo enquadramento base
- mesma perspectiva principal
- mesma proposta visual
- mesma estrutura do mockup
- mesmo formato do produto
- mesma proporcao visual
- mesmo estilo comercial marketplace

O mockup deve continuar altamente fiel ao original, porem e PERMITIDO realizar pequenas variacoes naturais para evitar imagens excessivamente identicas entre geracoes.

Variacoes permitidas:
- leves ajustes de iluminacao
- pequenas variacoes de sombra
- pequenas mudancas de textura do ambiente
- variacoes suaves de fundo mantendo o mesmo estilo
- pequenas mudancas de tons neutros do ambiente
- pequenas variacoes de pose/persona (quando houver modelo)
- pequenas variacoes de acessorios neutros
- pequenas variacoes de profundidade de campo
- pequenas variacoes de composicao secundaria

As variacoes devem:
- manter identidade visual consistente
- manter aspecto profissional
- manter padrao marketplace
- parecer fotos reais diferentes do mesmo produto
- evitar aparencia de imagem duplicada

NUNCA alterar:
- geometria do produto
- modelagem do produto
- proporcao do produto
- posicionamento principal
- bordas, costuras, barras, amarracoes, alcas, acabamento e formato original do item
- identidade da estampa
- cores originais da arte
- textos, letras, palavras, numeros, logotipos ou simbolos da arte
- estilo principal do mockup

Ajuste obrigatoriamente a proporcao e escala da arte conforme o tamanho real informado do produto, respeitando:
- area util de impressao
- caimento natural do tecido
- dobras, ondulacoes, rugas, vincos e curvas naturais do material
- deformacao perspectiva da arte acompanhando a superficie real do produto
- proporcao correta da estampa
- densidade visual adequada
- tamanho real do produto
- posicionamento proporcional da arte

A estampa NAO deve:
- ficar esticada
- comprimida
- distorcida
- desproporcional
- ampliar ou reduzir elementos aleatoriamente

Utilize o tamanho informado para manter a relacao correta entre:
- dimensao do produto
- escala da estampa
- repeticao da arte
- ocupacao visual no mockup

Caso a arte seja localizada:
- centralizar proporcionalmente
- respeitar margens naturais do produto
- manter alinhamento realista

Caso a arte seja padrao/pattern:
- repetir mantendo escala coerente com o tamanho informado
- evitar elementos exageradamente grandes ou pequenos

Regras obrigatorias:
- manter aparencia realista
- resultado profissional para marketplace
- alta fidelidade a estampa enviada
- reproduzir a arte original com maxima fidelidade visual
- preservar textos e elementos graficos da estampa exatamente como enviados
- qualidade fotografica
- textura natural do tecido
- sombras coerentes
- perspectiva realista
- iluminacao integrada entre mockup e estampa
- contato natural da arte com a textura do tecido, sem parecer adesivo plano
- nitidez suficiente para uso em anuncio de marketplace
- nao adicionar textos, marcas d'agua, etiquetas, logos ou elementos graficos que nao existam nas imagens de referencia
- nao transformar o produto em outro tipo de item

Orientacao por tipo de produto:
- bandeira: aplicar a arte acompanhando ondulacoes do tecido, mantendo bordas e caimento, sem endurecer a superficie
- lenco: respeitar dobras, cantos, maleabilidade e escala da estampa, mantendo aparencia de tecido leve
- forro de mesa: manter a perspectiva da mesa, queda lateral, bordas visiveis e repeticao/centralizacao proporcional da arte
- avental: preservar alcas, costuras, bolso quando existir, torso/modelo quando existir e deformar a arte conforme volume do corpo

Produto:
${input.nomeProduto}

SKU:
${input.sku}

Tamanho:
${input.tamanho}

Descricao da estampa:
${input.descricaoEstampa}

Descricao da variante:
${input.descricaoVariante}

Detalhes especificos do tipo de produto:
${input.detalhesPromptIa}`;
}
