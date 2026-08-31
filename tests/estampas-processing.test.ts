import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import type { EstampaCatalogo } from "../src/repositories/catalogo-estampas-repository";
import { analiseVisualEstampaStructuredOutput, validarAnaliseVisualEstampa } from "../src/schemas/analiseVisualEstampaSchema";
import {
  analisarImagemEstampaComFallback,
  AnaliseVisualQualidadeInsuficienteError,
  PROMPT_APRESENTACAO_IMAGEM,
  PROMPT_SEGMENTACAO_BUSCA,
  PROMPT_CLASSIFICACAO_TEXTIL,
  PROMPT_ANALISE_VISUAL_ESTAMPA,
} from "../src/services/analisarVisualEstampaService";
import { carregarPreviewEstampa, CarregarPreviewEstampaError } from "../src/services/carregarPreviewEstampaService";
import { construirTextoPesquisa } from "../src/services/construirTextoPesquisa";
import { expandirConsultaComVocabularioTextil } from "../src/domain/estampa-taxonomia-textil";
import { analiseCorrespondeAoConteudoAtual, estampaPrecisaReprocessamento } from "../src/services/controleVersaoAnaliseEstampa";
import type { ImageAnalysisProvider } from "../src/services/image-analysis/ImageAnalysisProvider";
import { OpenAIImageAnalysisProvider } from "../src/services/image-analysis/OpenAIImageAnalysisProvider";
import { calcularCustoEstimadoAnaliseIa, PRECOS_GPT_4O_MINI } from "../src/services/metricasCustoAnaliseIa";
import { criarCustomIdBatchEstampa, criarLinhaBatchAnaliseEstampa, serializarLinhasBatch } from "../src/services/image-analysis/criarRequisicaoBatchAnaliseEstampa";
import { criarAtualizacaoResultadoAnaliseIa, materializarClassificacaoTextil, materializarSegmentacaoBusca } from "../src/services/mapearResultadoAnaliseIaEstampa";
import { verificarNecessidadeAnaliseIa } from "../src/services/verificarNecessidadeAnaliseIa";
import {
  FILTROS_VAZIOS_PESQUISA_ESTAMPAS,
  criarQueryPesquisaEstampas,
  lerEstadoUrlPesquisaEstampas,
  temFiltroPesquisaEstampas,
} from "../src/services/filtrosPesquisaEstampas";

const estampaBase = {
  id: "00000000-0000-0000-0000-000000000001",
  codigo: "6844",
  variante: "A",
  preview_url: "https://cdn.example.com/6844-a.webp",
  storage_key: null,
  original_relative_path: null,
  original_filename: null,
  content_hash: "hash-atual",
  titulo: null,
  descricao: null,
  tema: null,
  subtemas: [],
  palavras_chave: null,
  cores: [],
  elementos_visuais: [],
  ocasioes: [],
  categorias: [],
  estilo: null,
  tipo_imagem: "INDEFINIDO",
  conteudos_imagem: [],
  suporte_aplicacao: "NAO_APLICAVEL",
  descricao_aplicacao: null,
  confianca_tipo_imagem: null,
  publicos_sugeridos: [],
  contextos_uso: [],
  afinidades_visuais: [],
  confianca_segmentacao: null,
  padroes_texteis: [],
  confianca_padrao_textil: null,
  texto_pesquisa: null,
  ai_metadata: null,
  ai_processed_hash: null,
  processing_status: "PENDING",
  processing_error: null,
  processed_at: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  is_active: true,
} satisfies EstampaCatalogo;

const analiseValida = {
  titulo: "Natal com sinos",
  descricao: "Estampa natalina com fundo verde, sinos dourados e flores vermelhas.",
  tema: "natal",
  subtemas: ["natal clássico"],
  coresPrincipais: ["verde"],
  coresSecundarias: ["vermelho", "dourado"],
  elementosVisuais: ["sinos dourados", "flores vermelhas"],
  palavrasChave: ["natal", "sino", "flor", "verde", "sinos dourados"],
  ocasioes: ["natal"],
  categorias: ["natalino"],
  estilo: "clássico",
  tipoImagem: "ESTAMPA",
  conteudosImagem: ["ESTAMPA"],
  aplicacaoVisual: {
    objetoFisicoVisivel: false,
    presente: false,
    suporte: "NAO_APLICAVEL",
    descricao: null,
    evidencias: [],
  },
  segmentacaoBusca: {
    publicosSugeridos: [
      { termo: "geral", confianca: 0.82, evidencias: ["composição de apelo amplo"] },
    ],
    contextosUso: [
      { termo: "festas e eventos", confianca: 0.68, evidencias: ["tema natalino"] },
    ],
    afinidadesVisuais: [
      { termo: "clássico", confianca: 0.9, evidencias: ["ornamentos tradicionais"] },
    ],
  },
  classificacaoTextil: {
    padroesTexteis: [
      { termo: "poá", confianca: 0.94, evidencias: ["repetição regular de bolinhas"] },
    ],
  },
  confiancaTipoImagem: 0.96,
  confianca: 0.91,
} as const;

test("não solicita IA quando os hashes já correspondem, salvo reprocessamento manual", () => {
  const estampa = { ...estampaBase, ai_processed_hash: "hash-atual" };
  assert.equal(analiseCorrespondeAoConteudoAtual(estampa), true);
  assert.equal(estampaPrecisaReprocessamento(estampa), false);
  assert.equal(verificarNecessidadeAnaliseIa(estampa).acao, "IGNORAR_JA_PROCESSADA");
  assert.equal(verificarNecessidadeAnaliseIa(estampa, { reprocessamentoManual: true }).acao, "PROCESSAR");
});

test("pesquisa administrativa exige ao menos um filtro antes de consultar o catálogo", () => {
  assert.equal(temFiltroPesquisaEstampas({}), false);
  assert.equal(temFiltroPesquisaEstampas({ status: "TODOS", cores: [" "] }), false);
  assert.equal(temFiltroPesquisaEstampas({ consulta: " natal " }), true);
  assert.equal(temFiltroPesquisaEstampas({ status: "FAILED" }), true);
});

test("query params preservam todos os filtros compartilháveis da pesquisa", () => {
  const filtros = {
    ...FILTROS_VAZIOS_PESQUISA_ESTAMPAS,
    consulta: "natal vermelho",
    codigo: "6844",
    variante: "A",
    tema: "natal",
    cores: ["vermelho", "dourado"],
    palavraChave: "sinos dourados",
    elementoVisual: "sino",
    categoria: "natalino",
    ocasiao: "natal",
    publicoSugerido: "geral",
    contextoUso: "festas e eventos",
    afinidadeVisual: "clássico",
    tipoImagem: "LAYOUT" as const,
    conteudoImagem: "MODELO_REAL" as const,
    suporteAplicacao: "MISTO" as const,
    status: "COMPLETED" as const,
  };
  const query = criarQueryPesquisaEstampas(filtros, 3, "RELEVANCIA");
  const restaurado = lerEstadoUrlPesquisaEstampas(query);

  assert.deepEqual(restaurado.filtros, filtros);
  assert.equal(restaurado.pagina, 3);
  assert.equal(restaurado.ordenacao, "RELEVANCIA");
  assert.deepEqual(query.getAll("cor"), ["vermelho", "dourado"]);
});

test("schema aceita resposta completa e rejeita confiança fora de 0 a 1", () => {
  assert.deepEqual(validarAnaliseVisualEstampa(analiseValida), analiseValida);
  assert.throws(() => validarAnaliseVisualEstampa({ ...analiseValida, confianca: 1.2 }));
});

test("segmentação aceita listas e evidências compactas com termos controlados", () => {
  assert.deepEqual(validarAnaliseVisualEstampa({
    ...analiseValida,
    segmentacaoBusca: {
      publicosSugeridos: [],
      contextosUso: [],
      afinidadesVisuais: [],
    },
  }).segmentacaoBusca, {
    publicosSugeridos: [],
    contextosUso: [],
    afinidadesVisuais: [],
  });
  assert.throws(() => validarAnaliseVisualEstampa({
    ...analiseValida,
    segmentacaoBusca: {
      ...analiseValida.segmentacaoBusca,
      publicosSugeridos: [{ termo: "mulheres", confianca: 0.9, evidencias: ["cor rosa"] }],
    },
  }));
  assert.deepEqual(validarAnaliseVisualEstampa({
    ...analiseValida,
    segmentacaoBusca: {
      ...analiseValida.segmentacaoBusca,
      publicosSugeridos: [{ termo: "geral", confianca: 0.9, evidencias: [] }],
    },
  }).segmentacaoBusca.publicosSugeridos[0]?.evidencias, []);
  assert.throws(() => validarAnaliseVisualEstampa({
    ...analiseValida,
    segmentacaoBusca: {
      ...analiseValida.segmentacaoBusca,
      publicosSugeridos: [{ termo: "geral", confianca: 0.9, evidencias: ["amplo", "neutro", "versátil"] }],
    },
  }));
});

test("materialização aplica o limiar sem invalidar sugestões vazias ou fracas", () => {
  const analise = validarAnaliseVisualEstampa(analiseValida);
  assert.deepEqual(materializarSegmentacaoBusca(analise, 0.7), {
    publicosSugeridos: ["geral"],
    contextosUso: [],
    afinidadesVisuais: ["clássico"],
    confianca: 0.86,
  });
  assert.deepEqual(materializarSegmentacaoBusca(validarAnaliseVisualEstampa({
    ...analiseValida,
    segmentacaoBusca: { publicosSugeridos: [], contextosUso: [], afinidadesVisuais: [] },
  }), 0.7), {
    publicosSugeridos: [], contextosUso: [], afinidadesVisuais: [], confianca: null,
  });
});

test("prompt de segmentação proíbe inferência sensível e aceita ausência de sugestão", () => {
  assert.match(PROMPT_SEGMENTACAO_BUSCA, /não associe cor, flor ou estilo isolado a gênero/iu);
  assert.match(PROMPT_SEGMENTACAO_BUSCA, /não infira idade, etnia, religião, saúde ou identidade/iu);
  assert.match(PROMPT_SEGMENTACAO_BUSCA, /listas podem ficar vazias/iu);
});

test("classificação usa vocabulário têxtil canônico com evidência opcional", () => {
  assert.deepEqual(materializarClassificacaoTextil(
    validarAnaliseVisualEstampa(analiseValida),
    0.7,
  ), { padroes: ["poá"], confianca: 0.94 });
  assert.match(PROMPT_CLASSIFICACAO_TEXTIL, /use poá para repetição dominante de círculos ou bolinhas/iu);
  assert.throws(() => validarAnaliseVisualEstampa({
    ...analiseValida,
    classificacaoTextil: {
      padroesTexteis: [{ termo: "bolinhas", confianca: 0.95, evidencias: [] }],
    },
  }));
});

test("pesquisa expande sinônimos do vocabulário têxtil sem chamada de IA", () => {
  const poa = expandirConsultaComVocabularioTextil("poá");
  assert.match(poa, /"poá"/u);
  assert.match(poa, /"poa"/u);
  assert.match(poa, /"poás"/u);
  assert.match(poa, /"bolinhas"/u);
  assert.match(poa, /"polka dot"/u);
  const composta = expandirConsultaComVocabularioTextil("bolinhas pretas");
  assert.match(composta, /\("poá" OR [\s\S]+"bolinhas"[\s\S]+\) "pretas"/u);
});

test("schema normaliza taxonomias e remove duplicações sem gastar novo retry", () => {
  const normalizada = validarAnaliseVisualEstampa({
    ...analiseValida,
    tema: "  NATAL  ",
    subtemas: ["Natal clássico", "natal   clássico"],
    coresPrincipais: ["Azul", " azul "],
    coresSecundarias: ["AZUL", "Branco"],
    palavrasChave: ["Natal", "natal", "Sino", "Flor", "Azul", "Branco"],
  });
  assert.equal(normalizada.tema, "natal");
  assert.deepEqual(normalizada.subtemas, ["natal clássico"]);
  assert.deepEqual(normalizada.coresPrincipais, ["azul"]);
  assert.deepEqual(normalizada.coresSecundarias, ["branco"]);
  assert.deepEqual(normalizada.palavrasChave, ["natal", "sino", "flor", "azul", "branco"]);
});

test("schema distingue aplicação em modelo real e rejeita apresentação contraditória", () => {
  const modeloReal = {
    ...analiseValida,
    tipoImagem: "APLICACAO_PRODUTO",
    conteudosImagem: ["ESTAMPA", "APLICACAO_PRODUTO", "MODELO_REAL"],
    aplicacaoVisual: {
      objetoFisicoVisivel: true,
      presente: true,
      suporte: "MODELO_REAL",
      descricao: "Estampa aplicada em uma peça apresentada por uma pessoa fotografada.",
      evidencias: ["pessoa fotografada", "caimento da peça"],
    },
  };
  assert.deepEqual(validarAnaliseVisualEstampa(modeloReal), modeloReal);
  assert.throws(() => validarAnaliseVisualEstampa({
    ...modeloReal,
    aplicacaoVisual: {
      objetoFisicoVisivel: true,
      presente: false,
      suporte: "MODELO_REAL",
      descricao: null,
      evidencias: [],
    },
  }));

  const layoutMisto = {
    ...modeloReal,
    tipoImagem: "LAYOUT",
    conteudosImagem: [
      "ESTAMPA",
      "APLICACAO_PRODUTO",
      "MODELO_REAL",
      "MANEQUIM",
      "TEXTO",
      "VARIANTES",
    ],
    aplicacaoVisual: {
      objetoFisicoVisivel: true,
      presente: true,
      suporte: "MISTO",
      descricao: "Layout com aplicações apresentadas por uma pessoa fotografada e em um manequim.",
      evidencias: ["pessoa fotografada", "manequim visível"],
    },
  };
  assert.deepEqual(validarAnaliseVisualEstampa(layoutMisto), layoutMisto);
});

test("persistência materializa os campos pesquisáveis da apresentação", () => {
  const atualizacao = criarAtualizacaoResultadoAnaliseIa({
    provider: "teste",
    model: "economico",
    analyzedAt: new Date(0).toISOString(),
    promptVersion: "v2",
    fallbackUsed: false,
    fallbackReason: null,
    primaryModel: "economico",
    primaryAttempts: 1,
    data: validarAnaliseVisualEstampa({
      ...analiseValida,
      tipoImagem: "APLICACAO_PRODUTO",
      conteudosImagem: ["ESTAMPA", "APLICACAO_PRODUTO", "MANEQUIM"],
      aplicacaoVisual: {
        objetoFisicoVisivel: true,
        presente: true,
        suporte: "MANEQUIM",
        descricao: "Estampa aplicada em uma peça apresentada sobre um manequim.",
        evidencias: ["manequim visível", "caimento da peça"],
      },
    }),
    requestId: null,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  });
  assert.equal(atualizacao.tipo_imagem, "APLICACAO_PRODUTO");
  assert.equal(atualizacao.suporte_aplicacao, "MANEQUIM");
  assert.deepEqual(atualizacao.conteudos_imagem, ["ESTAMPA", "APLICACAO_PRODUTO", "MANEQUIM"]);
  assert.deepEqual(atualizacao.publicos_sugeridos, ["geral"]);
  assert.deepEqual(atualizacao.contextos_uso, []);
  assert.deepEqual(atualizacao.afinidades_visuais, ["clássico"]);
  assert.equal(atualizacao.confianca_segmentacao, 0.86);
  assert.deepEqual(atualizacao.padroes_texteis, ["poá"]);
  assert.equal(atualizacao.confianca_padrao_textil, 0.94);
});

test("classificação não aceita bandeira física como estampa plana", () => {
  assert.match(
    PROMPT_APRESENTACAO_IMAGEM,
    /bandeira fotografada pendurada em uma parede[\s\S]+não ESTAMPA plana/iu,
  );
  const bandeiraAplicada = {
    ...analiseValida,
    titulo: "Bandeira da França",
    tipoImagem: "APLICACAO_PRODUTO",
    conteudosImagem: ["APLICACAO_PRODUTO", "AMBIENTE"],
    aplicacaoVisual: {
      objetoFisicoVisivel: true,
      presente: true,
      suporte: "AMBIENTE",
      descricao: "Bandeira pendurada em uma parede, com dobras, sombras e fixação visíveis.",
      evidencias: ["dobras e ondulações", "sombra sobre a parede", "preso por fixadores"],
    },
  };
  assert.deepEqual(validarAnaliseVisualEstampa(bandeiraAplicada), bandeiraAplicada);
  assert.throws(() => validarAnaliseVisualEstampa({
    ...bandeiraAplicada,
    tipoImagem: "ESTAMPA",
  }));
});

test("texto_pesquisa remove vazios e duplicações sem perder termos compostos", () => {
  assert.equal(
    construirTextoPesquisa({ codigo: "6844", variante: "A", tema: "Natal", palavrasChave: ["natal", "sinos dourados", ""] }),
    "6844 A Natal sinos dourados",
  );
  assert.match(
    construirTextoPesquisa({ codigo: "6844", publicosSugeridos: ["familiar"], contextosUso: ["festas e eventos"] }),
    /6844 familiar festas e eventos/u,
  );
});

test("preview bloqueia hosts locais antes de realizar chamada de rede", async () => {
  await assert.rejects(
    carregarPreviewEstampa({ id: estampaBase.id, preview_url: "http://127.0.0.1/imagem.png" }),
    (error: unknown) => error instanceof CarregarPreviewEstampaError && error.code === "INVALID_URL",
  );
});

test("preview limita origem ao Cloud autorizado e valida redirects", async () => {
  await assert.rejects(
    carregarPreviewEstampa({
      id: estampaBase.id,
      preview_url: "https://cdn-nao-autorizado.example/imagem.png",
    }),
    (error: unknown) =>
      error instanceof CarregarPreviewEstampaError && error.code === "INVALID_URL",
  );

  await assert.rejects(
    carregarPreviewEstampa(
      { id: estampaBase.id, preview_url: "https://storage.googleapis.com/imagem.png" },
      {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/interno.png" },
        }),
      },
    ),
    (error: unknown) =>
      error instanceof CarregarPreviewEstampaError && error.code === "INVALID_URL",
  );

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const carregado = await carregarPreviewEstampa(
    { id: estampaBase.id, preview_url: "https://storage.googleapis.com/imagem.png" },
    {
      fetchImpl: async () => new Response(png, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(png.length),
        },
      }),
    },
  );
  assert.equal(carregado.mimeType, "image/png");
  assert.equal(carregado.sizeBytes, png.length);
});

test("fallback considera também a confiança da classificação de apresentação", async () => {
  let chamadasPrimario = 0;
  let chamadasFallback = 0;
  const resultado = <T>(model: string, data: T) => ({
    provider: "teste", model, analyzedAt: new Date(0).toISOString(), promptVersion: "v1",
    fallbackUsed: false, fallbackReason: null, primaryModel: model, primaryAttempts: 1,
    data, requestId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  });
  const primario: ImageAnalysisProvider = {
    name: "teste", model: "economico",
    async analyzeImage(input) { chamadasPrimario += 1; return resultado("economico", input.output.parse({ ...analiseValida, confiancaTipoImagem: 0.4 })); },
  };
  const fallback: ImageAnalysisProvider = {
    name: "teste", model: "capaz",
    async analyzeImage(input) { chamadasFallback += 1; return resultado("capaz", input.output.parse({ ...analiseValida, confianca: 0.9 })); },
  };
  const final = await analisarImagemEstampaComFallback({
    image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 },
    prompt: "Analise", promptVersion: "v1",
    output: { name: "teste", jsonSchema: {}, parse: validarAnaliseVisualEstampa },
  }, primario, fallback);
  assert.equal(final.model, "capaz");
  assert.equal(final.fallbackUsed, true);
  assert.equal(chamadasPrimario, 1);
  assert.equal(chamadasFallback, 1);
});

test("segmentação vazia ou com baixa confiança não aciona o modelo fallback", async () => {
  let chamadasFallback = 0;
  const resultado = <T>(model: string, data: T) => ({
    provider: "teste", model, analyzedAt: new Date(0).toISOString(), promptVersion: "v4",
    fallbackUsed: false, fallbackReason: null, primaryModel: model, primaryAttempts: 1,
    data, requestId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  });
  const primario: ImageAnalysisProvider = {
    name: "teste", model: "economico",
    async analyzeImage(input) {
      return resultado("economico", input.output.parse({
        ...analiseValida,
        segmentacaoBusca: {
          publicosSugeridos: [{ termo: "geral", confianca: 0.1, evidencias: ["apelo amplo"] }],
          contextosUso: [],
          afinidadesVisuais: [],
        },
      }));
    },
  };
  const fallback: ImageAnalysisProvider = {
    name: "teste", model: "capaz",
    async analyzeImage(input) {
      chamadasFallback += 1;
      return resultado("capaz", input.output.parse(analiseValida));
    },
  };
  const final = await analisarImagemEstampaComFallback({
    image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 },
    prompt: "Analise", promptVersion: "v4",
    output: { name: "teste", jsonSchema: {}, parse: validarAnaliseVisualEstampa },
  }, primario, fallback);
  assert.equal(final.model, "economico");
  assert.equal(chamadasFallback, 0);
});

test("baixa confiança após fallback é definitiva para evitar chamadas repetidas", async () => {
  const resultado = <T>(model: string, data: T) => ({
    provider: "teste", model, analyzedAt: new Date(0).toISOString(), promptVersion: "v1",
    fallbackUsed: false, fallbackReason: null, primaryModel: model, primaryAttempts: 1,
    data, requestId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  });
  const provider = (model: string): ImageAnalysisProvider => ({
    name: "teste",
    model,
    async analyzeImage(input) {
      return resultado(model, input.output.parse({
        ...analiseValida,
        confiancaTipoImagem: 0.4,
      }));
    },
  });

  await assert.rejects(
    analisarImagemEstampaComFallback({
      image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 },
      prompt: "Analise",
      promptVersion: "v1",
      output: { name: "teste", jsonSchema: {}, parse: validarAnaliseVisualEstampa },
    }, provider("economico"), provider("capaz")),
    (error: unknown) =>
      error instanceof AnaliseVisualQualidadeInsuficienteError && error.retriable === false,
  );
});

test("provider centraliza detalhe econômico, cache do prompt e telemetria", async () => {
  let payloadEnviado: Record<string, unknown> = {};
  const provider = new OpenAIImageAnalysisProvider({
    apiKey: "teste",
    model: "modelo-economico",
    imageDetail: "low",
    fetchImpl: async (_input, init) => {
      payloadEnviado = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "req_teste",
        model: "modelo-economico",
        output_text: JSON.stringify(analiseValida),
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
          input_tokens_details: { cached_tokens: 80 },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const resultado = await provider.analyzeImage({
    image: { buffer: Buffer.from([1, 2, 3]), mimeType: "image/png", sizeBytes: 3 },
    prompt: "Prompt estável",
    promptVersion: "prompt-v3",
    output: {
      name: "analise_teste",
      jsonSchema: {},
      parse: validarAnaliseVisualEstampa,
    },
  });

  assert.equal(payloadEnviado?.store, false);
  assert.equal(payloadEnviado?.prompt_cache_key, "prompt-v3");
  const input = payloadEnviado?.input as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  assert.equal(input[0]?.role, "developer");
  assert.equal(input[1]?.role, "user");
  assert.equal(input[1]?.content[0]?.detail, "low");
  assert.equal(payloadEnviado?.max_output_tokens, 700);
  assert.equal(resultado.imageDetail, "low");
  assert.equal(resultado.usage.cachedInputTokens, 80);
});

test("custo considera cache e desconto de batch sem contar tokens duas vezes", () => {
  const normal = calcularCustoEstimadoAnaliseIa({
    inputTokens: 5_744,
    cachedInputTokens: 2_464,
    outputTokens: 230,
  }, PRECOS_GPT_4O_MINI);
  const batch = calcularCustoEstimadoAnaliseIa({
    inputTokens: 5_744,
    cachedInputTokens: 2_464,
    outputTokens: 230,
  }, PRECOS_GPT_4O_MINI, 0.5);
  assert.equal(normal.inputTokens, 5_744);
  assert.equal(normal.cachedInputTokens, 2_464);
  assert.equal(batch.estimatedCostUsd, normal.estimatedCostUsd / 2);
});

test("texto de pesquisa expande sinônimos sem duplicar os arrays persistidos", () => {
  const texto = construirTextoPesquisa({
    codigo: "5635",
    padroesTexteis: ["poá"],
    cores: ["azul marinho"],
  });
  assert.match(texto, /poá/iu);
  assert.match(texto, /bolinhas/iu);
  assert.match(texto, /polka dot/iu);
  assert.match(texto, /marinho/iu);
});

test("item Batch é idempotente, usa preview remoto permitido e detail low", () => {
  const customId = criarCustomIdBatchEstampa({ estampaId: "6844", contentHash: "hash-atual" });
  const linha = criarLinhaBatchAnaliseEstampa({
    customId,
    previewUrl: "https://storage.googleapis.com/catalogo/6844-a.webp",
  });
  assert.match(customId, /estampa:6844:hash:hash-atual:prompt:/u);
  const body = linha.body as { input: Array<{ role: string; content: Array<Record<string, unknown>> }> };
  assert.equal(body.input[0]?.role, "developer");
  assert.equal(body.input[1]?.content[0]?.detail, "low");
  assert.equal(serializarLinhasBatch([linha]).split("\n").filter(Boolean).length, 1);
});

test("prompt e schema permanecem compactos para controlar custo de entrada", () => {
  const schema = JSON.stringify(analiseVisualEstampaStructuredOutput.jsonSchema);
  assert.ok(PROMPT_ANALISE_VISUAL_ESTAMPA.length < 4_000);
  assert.ok(schema.length < 8_000);
});
