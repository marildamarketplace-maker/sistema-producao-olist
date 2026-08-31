import type { EstampaCatalogo } from "@/repositories/catalogo-estampas-repository";
import {
  AI_ANALYSIS_PROMPT_VERSION,
  AI_FALLBACK_IMAGE_DETAIL,
  AI_FALLBACK_MODEL,
  AI_MIN_CONFIDENCE,
  AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS,
  AI_PRIMARY_IMAGE_DETAIL,
  AI_PRIMARY_MODEL,
} from "@/config/ai";
import {
  analiseVisualEstampaStructuredOutput,
  type AnaliseVisualEstampa,
} from "@/schemas/analiseVisualEstampaSchema";
import { carregarPreviewEstampa } from "@/services/carregarPreviewEstampaService";
import type {
  ImageAnalysisInput,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from "@/services/image-analysis/ImageAnalysisProvider";
import { criarImageAnalysisProvider } from "@/services/image-analysis/imageAnalysisProviderFactory";
import { ImageAnalysisProviderError } from "@/services/image-analysis/OpenAIImageAnalysisProvider";

const PROMPT_VISUAL_BASE = `Classifique exclusivamente a arte visual apresentada na imagem, em português do Brasil.

O campo descricao será usado para pesquisa, identificação e organização do catálogo. Escreva nele de 1 a 3 frases objetivas, priorizando, nesta ordem: elementos visíveis, tema, composição, cores e estilo visual.

Use somente evidências diretamente observáveis na imagem. Não invente elementos nem afirme características incertas. Não infira ou mencione tecido, material, metragem, tamanho, preço, marketplace ou contexto comercial. Não diga que a arte é impressão 3D. A identificação do contexto visível de aplicação é permitida somente nos campos específicos de apresentação da imagem; não presuma produtos que não estejam visíveis.

Evite linguagem promocional, elogios, exageros, chamadas de venda e adjetivos comerciais. Mantenha todos os demais campos igualmente restritos à análise visual.`;

const PROMPT_PALAVRAS_CHAVE = `No campo palavrasChave, gere termos em português do Brasil voltados principalmente à pesquisa interna da estampa por pessoas que não conhecem seu código.

Priorize termos visualmente relevantes nestes grupos: elementos representados, temas, estilos, cores e ocasiões claramente associáveis ao que aparece. Inclua também combinações curtas e úteis de dois atributos observáveis, como tema + cor, estilo + cor ou elemento + cor, somente quando melhorarem a busca.

Use preferencialmente substantivos no singular e termos curtos. Evite duplicações, variações meramente redundantes, palavras vagas como "bonito", "estampa", "arte", "desenho" ou "decorativo", e qualquer termo não sustentado pela imagem. Não tente preencher o limite máximo; qualidade e relevância têm prioridade sobre quantidade.`;

const PROMPT_CORES = `Nos campos de cores, use nomes comuns e compreensíveis para pesquisa humana em português do Brasil, como "azul", "azul marinho", "rosa claro", "verde escuro", "dourado", "bege", "branco" ou "preto". Não use hexadecimal, RGB, nomes técnicos de pigmentos ou dezenas de microvariações.

Em coresPrincipais, inclua somente as cores que dominam visualmente a composição ou ocupam áreas relevantes. Em coresSecundarias, inclua cores perceptíveis de apoio, detalhes ou acentos. Não repita a mesma cor nas duas listas.

Agrupe pequenas diferenças da mesma família sob um nome simples. Só preserve qualificadores como "claro", "escuro" ou "marinho" quando a diferença for evidente e útil para a pesquisa. Ignore cores presentes apenas em detalhes insignificantes e não tente preencher o limite máximo.`;

const PROMPT_ELEMENTOS_VISUAIS = `No campo elementosVisuais, registre somente objetos, símbolos, personagens e componentes reconhecíveis que estejam diretamente visíveis na imagem. Use português do Brasil e expressões nominais curtas, concretas e úteis para pesquisa.

Prefira a identificação mais específica sustentada pela imagem. Quando um atributo visível for relevante para distinguir o elemento, inclua-o no mesmo termo, por exemplo "sinos dourados" em vez de "objeto decorativo". Não use rótulos vagos como "objeto", "elemento", "componente" ou "objeto decorativo".

Não transforme tema, estilo, ocasião, sensação ou contexto presumido em elemento visual. Não registre elementos ocultos, ambíguos ou apenas sugeridos. Evite sinônimos, singular e plural equivalentes e versões redundantes do mesmo elemento dentro desta lista.

Quando a forma específica já estiver em elementosVisuais, não acrescente também seu termo-base apenas para aumentar a lista. Se o termo-base ajudar a pesquisa, inclua-o em palavrasChave. Não tente preencher o limite máximo; registre apenas o que puder ser reconhecido com segurança.`;

const PROMPT_CLASSIFICACAO_CONTEXTUAL = `Classifique tema, subtemas, categorias e ocasioes como dimensões diferentes, usando somente evidências visuais presentes na imagem.

Em tema, informe um único conceito visual principal. Quando houver símbolos claros de uma temática reconhecível, use essa temática. Quando não houver contexto específico suficiente, use uma classificação literal baseada no motivo predominante, como "Floral", "Geométrico" ou "Abstrato", sem presumir uma celebração ou finalidade.

Em subtemas, inclua apenas refinamentos específicos do tema principal que também sejam visualmente sustentados. Não repita o tema com outra grafia e use uma lista vazia quando não houver refinamento seguro.

Em categorias, produza poucos rótulos amplos e estáveis para filtragem, em português do Brasil, coerentes com o tema e os elementos observados. Categorias não devem introduzir contexto ausente na imagem.

Em ocasioes, registre uma data, campanha, celebração ou situação somente quando houver evidência visual clara e distintiva, como símbolos, personagens, texto legível ou uma composição inequivocamente associada. Uma associação comercial plausível não é evidência suficiente. Uma estampa floral genérica, por exemplo, não deve receber "Dia das Mães". Quando nenhuma ocasião estiver claramente indicada, retorne uma lista vazia.

Se houver ambiguidade entre uma classificação contextual específica e uma classificação visual mais geral, escolha a classificação geral. Não invente contexto para preencher campos.`;

export const PROMPT_SEGMENTACAO_BUSCA = `Preencha segmentacaoBusca somente para ampliar a pesquisa interna. Essas sugestões não descrevem quem comprará a estampa e não devem ser usadas para inferir atributos pessoais. As três listas podem e devem ficar vazias quando não houver evidência visual suficiente.

Use exclusivamente os termos controlados oferecidos pelo schema. Para cada sugestão, informe confiança entre 0 e 1 e de 1 a 4 evidências visuais curtas e diretamente observáveis.

Em publicosSugeridos:
- use "infantil" apenas diante de sinais visuais fortes, como personagens infantis, composição lúdica ou motivos claramente voltados ao universo infantil;
- use "juvenil", "adulto" ou "familiar" somente quando a linguagem visual sustentar essa afinidade com segurança;
- use "geral" quando a arte tiver apelo visual amplo e não houver recorte evidente;
- não associe cores, flores ou estilos isolados a gênero. Floral rosa, por exemplo, não significa automaticamente público feminino.

Em contextosUso, registre somente contextos compatíveis com símbolos ou composição visível. Um laço rosa pode sustentar "campanhas de conscientização", mas não autoriza diagnosticar condição médica. Uma cruz pode sustentar "contexto religioso ou devocional", mas não permite inferir a religião de uma pessoa. Uma bandeira pode sustentar contexto cultural ou esportivo apenas quando houver outros sinais claros; não infira nacionalidade do usuário.

Em afinidadesVisuais, use somente rótulos coerentes com o estilo realmente observado, sem tentar preencher a lista. Não use segmentação para repetir tema, cor, elemento ou ocasião.

A ausência de sugestões é uma resposta válida. Baixa confiança nesta seção não deve reduzir o campo confianca global da análise visual nem a confiancaTipoImagem.`;

export const PROMPT_CLASSIFICACAO_TEXTIL = `Classifique também a linguagem visual usando o vocabulário profissional do mercado têxtil disponível em classificacaoTextil.padroesTexteis.

Esta classificação descreve o PADRÃO VISUAL da arte; ela não afirma que existe tecido na imagem nem deve inferir composição, material, gramatura, técnica de impressão ou produto final.

Regras importantes:
- use "poá" quando houver repetição predominante de círculos ou bolinhas, geralmente distribuídos de modo regular. Acrescente também "poá" às palavrasChave, mesmo que a descrição use "bolinhas" ou "pontos";
- use "vichy" apenas para o xadrez formado por quadrados regulares e alternância visual característica; xadrez genérico deve permanecer "xadrez";
- diferencie "chevron" de "zigue-zague" quando a construção em V for claramente reconhecível;
- use "paisley" para motivos curvos em forma de gota ou caxemira, e não para qualquer arabesco;
- use "animal print" apenas quando o padrão reproduzir visualmente pelagem, pele ou marcas reconhecíveis de animal;
- floral, folhagem e tropical podem coexistir quando cada termo tiver evidência própria;
- não escolha "geométrico" apenas porque toda composição possui formas; use-o quando as formas geométricas forem o padrão visual dominante;
- cada classificação exige confiança e evidência diretamente observável. A lista pode ficar vazia.

O termo canônico têxtil é prioritário para pesquisa. Sinônimos populares, como "bolinhas", "pontos", "polka dot", "listras", "quadriculado", "cashmere" ou "oncinha", podem permanecer em palavrasChave para ampliar a recuperação.`;

export const PROMPT_APRESENTACAO_IMAGEM = `Classifique também como a imagem apresenta a estampa, sem confundir essa classificação com tema, estilo ou elementos da arte.

Antes de escolher tipoImagem, faça obrigatoriamente esta verificação hierárquica:
1. Procure evidências de objeto ou superfície física: dobras, ondulações, volume, perspectiva, contorno, espessura, costura, caimento, reflexo, sombra, fixadores, suporte, pessoa, manequim, parede, móvel ou outro cenário.
2. Se qualquer uma dessas evidências estiver visível e a arte aparecer nesse objeto ou superfície, aplicacaoVisual.objetoFisicoVisivel e aplicacaoVisual.presente devem ser true. A imagem NÃO pode ser ESTAMPA, mesmo que a arte ocupe quase toda a fotografia.
3. Só use ESTAMPA quando a imagem mostrar uma arte digital realmente plana, sem objeto, superfície física, dobra, volume, sombra projetada, fixação, perspectiva ou cenário de uso.
4. Depois verifique se existem múltiplos painéis, versões, códigos, textos ou combinações de arte e aplicação. Nesse caso, use LAYOUT como tipo predominante, mantendo a aplicação registrada em aplicacaoVisual e conteudosImagem.

Em tipoImagem, escolha exatamente uma opção predominante:
- ESTAMPA: mostra exclusivamente a arte digital plana ou padrão visual, sem objeto físico, superfície aplicada, composição de catálogo ou cenário;
- LAYOUT: composição que reúne duas ou mais partes, como arte, mockup, textos, códigos, quadros ou variantes. Um layout continua sendo LAYOUT mesmo quando contém uma aplicação em produto;
- APLICACAO_PRODUTO: a apresentação predominante mostra a estampa em um objeto ou superfície física visível, inclusive em pessoa/modelo real, manequim, produto isolado ou ambiente. Fotografias e mockups realistas contam como aplicação;
- INDEFINIDO: somente quando a apresentação não puder ser determinada com segurança.

Em conteudosImagem, registre todos os tipos de conteúdo realmente presentes. Use MODELO_REAL quando houver uma pessoa fotografada usando ou apresentando o item, MANEQUIM para uma forma artificial, PRODUTO_ISOLADO para um produto apresentado sem pessoa ou manequim, AMBIENTE quando a aplicação estiver contextualizada em um espaço, TEXTO quando houver texto relevante e VARIANTES quando a composição mostrar versões diferentes da arte. Inclua ESTAMPA sempre que a arte plana estiver visível e APLICACAO_PRODUTO sempre que houver aplicação visível.

Em aplicacaoVisual, objetoFisicoVisivel indica se há sinais observáveis de um objeto ou superfície física. Marque presente quando a estampa estiver visualmente aplicada nesse objeto ou superfície. Use suporte MODELO_REAL, MANEQUIM, PRODUTO_ISOLADO, AMBIENTE ou OUTRO. Use MISTO quando houver mais de uma dessas formas de aplicação na mesma composição. Em evidencias, registre de 1 a 6 sinais curtos realmente visíveis, como "dobras e ondulações", "sombra sobre a parede" ou "preso por fixadores". Quando não houver aplicação, objetoFisicoVisivel e presente devem ser false, suporte deve ser NAO_APLICAVEL, descricao deve ser nula e evidencias deve ser uma lista vazia. Quando houver, a descricao deve explicar objetivamente a aplicação e seus sinais físicos visíveis.

Exemplos decisivos:
- Uma bandeira fotografada pendurada em uma parede, com dobras, sombra e fixadores, é APLICACAO_PRODUTO com suporte AMBIENTE. Não é ESTAMPA plana.
- O desenho retangular e perfeitamente plano de uma bandeira, sem dobras, sombra, fixação ou cenário, é ESTAMPA.
- Uma peça apresentada sobre pessoa ou manequim é APLICACAO_PRODUTO.
- Uma foto ou mockup de produto sobre fundo branco, ainda que sem pessoa, é APLICACAO_PRODUTO com suporte PRODUTO_ISOLADO.
- Uma prancha com arte plana, produto aplicado, códigos ou variantes é LAYOUT e também contém APLICACAO_PRODUTO.

Não identifique pessoas, não tente reconhecer identidade e não infira idade, gênero, etnia, condição de saúde ou outros atributos pessoais. Não infira material, tecido, dimensões ou finalidade comercial. Em caso de dúvida entre pessoa real e manequim, use OUTRO e reduza confiancaTipoImagem. A confiança da apresentação deve ficar entre 0 e 1.`;

export async function analisarVisualEstampa(
  estampa: EstampaCatalogo,
  primaryProvider: ImageAnalysisProvider = criarImageAnalysisProvider(
    AI_PRIMARY_MODEL,
    AI_PRIMARY_IMAGE_DETAIL,
  ),
  fallbackProvider: ImageAnalysisProvider = criarImageAnalysisProvider(
    AI_FALLBACK_MODEL,
    AI_FALLBACK_IMAGE_DETAIL,
  ),
): Promise<ImageAnalysisResult<AnaliseVisualEstampa>> {
  const carregamentoIniciadoEm = Date.now();
  console.info("[estampas-ai] Carregando preview da estampa.", {
    estampaId: estampa.id,
  });
  const preview = await carregarPreviewEstampa(estampa);
  console.info("[estampas-ai] Preview carregado; acionando modelo primário.", {
    estampaId: estampa.id,
    mimeType: preview.mimeType,
    sizeBytes: preview.sizeBytes,
    carregamentoMs: Date.now() - carregamentoIniciadoEm,
    model: primaryProvider.model,
  });
  return analisarImagemEstampaComFallback({
    image: preview,
    prompt: `${PROMPT_VISUAL_BASE}\n\n${PROMPT_APRESENTACAO_IMAGEM}\n\n${PROMPT_ELEMENTOS_VISUAIS}\n\n${PROMPT_CLASSIFICACAO_CONTEXTUAL}\n\n${PROMPT_CLASSIFICACAO_TEXTIL}\n\n${PROMPT_SEGMENTACAO_BUSCA}\n\n${PROMPT_PALAVRAS_CHAVE}\n\n${PROMPT_CORES}`,
    promptVersion: AI_ANALYSIS_PROMPT_VERSION,
    output: analiseVisualEstampaStructuredOutput,
  }, primaryProvider, fallbackProvider);
}

export class AnaliseVisualQualidadeInsuficienteError extends Error {
  // Os dois modelos já analisaram a mesma imagem. Repetir o mesmo fluxo tende a
  // gerar o mesmo resultado e apenas aumenta custo; a correção é manual/prompt.
  readonly retriable = false;

  constructor(message: string) {
    super(message);
    this.name = "AnaliseVisualQualidadeInsuficienteError";
  }
}

export async function analisarImagemEstampaComFallback(
  input: ImageAnalysisInput<AnaliseVisualEstampa>,
  primaryProvider: ImageAnalysisProvider,
  fallbackProvider: ImageAnalysisProvider,
): Promise<ImageAnalysisResult<AnaliseVisualEstampa>> {
  let motivoFallback: string | null = null;
  let tentativasPrimario = 0;

  for (let tentativa = 1; tentativa <= AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS; tentativa += 1) {
    tentativasPrimario = tentativa;
    try {
      const resultado = await primaryProvider.analyzeImage(input);
      const motivoConfianca = obterMotivoConfiancaInsuficiente(resultado.data);
      if (!motivoConfianca) return resultado;
      motivoFallback = motivoConfianca;
      break;
    } catch (error) {
      if (!erroElegivelParaFallback(error)) throw error;
      motivoFallback = codigoErroFallback(error);
      if (!erroEstruturalRepetivel(error) || tentativa === AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS) {
        break;
      }
    }
  }

  console.warn("[estampas-ai] Acionando modelo fallback.", {
    primaryModel: primaryProvider.model,
    fallbackModel: fallbackProvider.model,
    reason: motivoFallback,
  });

  const resultadoFallback = await fallbackProvider.analyzeImage(input);
  const motivoConfiancaFallback = obterMotivoConfiancaInsuficiente(resultadoFallback.data);
  if (motivoConfiancaFallback) {
    throw new AnaliseVisualQualidadeInsuficienteError(
      `Fallback retornou confiança insuficiente (${motivoConfiancaFallback}); mínimo configurado ${AI_MIN_CONFIDENCE}.`,
    );
  }

  return {
    ...resultadoFallback,
    fallbackUsed: true,
    fallbackReason: motivoFallback,
    primaryModel: primaryProvider.model,
    primaryAttempts: tentativasPrimario,
  };
}

function obterMotivoConfiancaInsuficiente(analise: AnaliseVisualEstampa) {
  if (analise.confianca < AI_MIN_CONFIDENCE) {
    return `LOW_CONFIDENCE:${analise.confianca}`;
  }
  if (analise.confiancaTipoImagem < AI_MIN_CONFIDENCE) {
    return `LOW_PRESENTATION_CONFIDENCE:${analise.confiancaTipoImagem}`;
  }
  return null;
}

function erroEstruturalRepetivel(error: unknown) {
  return (
    error instanceof ImageAnalysisProviderError &&
    ["INVALID_RESPONSE", "INVALID_STRUCTURED_OUTPUT"].includes(error.code)
  );
}

function erroElegivelParaFallback(error: unknown) {
  return (
    error instanceof ImageAnalysisProviderError &&
    ["INVALID_RESPONSE", "INVALID_STRUCTURED_OUTPUT", "PROVIDER_ERROR"].includes(error.code)
  );
}

function codigoErroFallback(error: unknown) {
  return error instanceof ImageAnalysisProviderError ? `PRIMARY_ERROR:${error.code}` : "PRIMARY_ERROR";
}
