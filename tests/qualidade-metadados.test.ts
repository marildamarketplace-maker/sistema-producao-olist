import assert from "node:assert/strict";
import test from "node:test";
import { avaliarQualidadeMetadados } from "../src/services/avaliarQualidadeMetadados";
import { validarAnaliseVisualEstampa, analiseVisualEstampaStructuredOutput } from "../src/schemas/analiseVisualEstampaSchema";
import { analisarImagemEstampaComFallback } from "../src/services/analisarVisualEstampaService";
import { criarAtualizacaoResultadoAnaliseIa } from "../src/services/mapearResultadoAnaliseIaEstampa";
import type { ImageAnalysisProvider } from "../src/services/image-analysis/ImageAnalysisProvider";
import { ImageAnalysisProviderError } from "../src/services/image-analysis/ImageAnalysisProviderError";

const base = validarAnaliseVisualEstampa({
  titulo: "Floral sobre fundo azul", descricao: "Composição floral com flores brancas sobre fundo azul.",
  tema: "floral", estilo: "delicado", subtemas: [], coresPrincipais: ["azul"], coresSecundarias: [],
  elementosVisuais: ["flores brancas"], palavrasChave: ["floral", "flores brancas", "azul", "delicado"],
  categorias: ["botânico"], ocasioes: [], tipoImagem: "ESTAMPA", conteudosImagem: ["ESTAMPA"],
  aplicacaoVisual: { presente: false, objetoFisicoVisivel: false, suporte: "NAO_APLICAVEL", descricao: null, evidencias: [] },
  segmentacaoBusca: { publicosSugeridos: [], contextosUso: [], afinidadesVisuais: [] },
  classificacaoTextil: { padroesTexteis: [{ termo: "floral", confianca: 0.95, evidencias: ["flores repetidas"] }] },
  confianca: 0.95, confiancaTipoImagem: 0.95,
});

test("qualidade preserva vazios legítimos e não altera os dados", () => {
  const antes = structuredClone(base);
  assert.equal(avaliarQualidadeMetadados(base).precisaRevisao, false);
  assert.deepEqual(base, antes);
  assert.equal(avaliarQualidadeMetadados({ ...base, tema: "natal", titulo: "Sinos", descricao: "Sinos dourados em fundo verde.", elementosVisuais: ["sinos"], classificacaoTextil: { padroesTexteis: [] } }).precisaRevisao, false);
});

test("qualidade detecta padrões ausentes e incompatíveis com tema explícito", () => {
  assert.equal(avaliarQualidadeMetadados({ ...base, classificacaoTextil: { padroesTexteis: [] } }).problemas[0].codigo, "PADRAO_TEXTIL_AUSENTE");
  assert.equal(avaliarQualidadeMetadados({ ...base, tema: "paisley" }).problemas[0].codigo, "PADRAO_TEXTIL_INCOMPATIVEL");
  assert.equal(avaliarQualidadeMetadados({ ...base, tema: "botânico", classificacaoTextil: { padroesTexteis: [] } }).problemas[0].codigo, "PADRAO_TEXTIL_AUSENTE");
  assert.equal(avaliarQualidadeMetadados({ ...base, tema: "geométrico", classificacaoTextil: { padroesTexteis: [{ termo: "poá", confianca: 0.9, evidencias: ["bolinhas repetidas"] }] } }).precisaRevisao, false);
});

test("qualidade detecta termos genéricos, ausência de evidência e campos essenciais", () => {
  const analise = { ...base, titulo: " ", palavrasChave: ["floral", " ESTAMPA ", "padrão", "design"],
    segmentacaoBusca: { ...base.segmentacaoBusca, afinidadesVisuais: [{ termo: "delicado" as const, confianca: 0.9, evidencias: [] }] } };
  const codigos = avaliarQualidadeMetadados(analise).problemas.map(item => item.codigo);
  assert.equal(codigos.filter(codigo => codigo === "PALAVRA_CHAVE_GENERICA").length, 3);
  assert.ok(codigos.includes("SUGESTAO_SEM_EVIDENCIA"));
  assert.ok(codigos.includes("CAMPO_ESSENCIAL_VAZIO"));
  assert.ok(avaliarQualidadeMetadados({ ...base, classificacaoTextil: { padroesTexteis: [{ termo: "floral", confianca: 0.9, evidencias: [] }] } }).precisaRevisao);
});

test("qualidade reconhece contradição de apresentação sem confundir textura com objeto", () => {
  assert.ok(avaliarQualidadeMetadados({ ...base, descricao: "Estampa em manequim com flores brancas." }).problemas.some(item => item.codigo === "APRESENTACAO_CONTRADITORIA"));
  assert.equal(avaliarQualidadeMetadados({ ...base, descricao: "Textura visual floral com sombras e aparência de tecido." }).precisaRevisao, false);
});

test("metadados completos não acionam fallback", async () => {
  const primary: ImageAnalysisProvider = {
    name: "teste", model: "primary",
    async analyzeImage(input) {
      return { provider: "teste", model: "primary", analyzedAt: new Date(0).toISOString(), promptVersion: "v1",
        primaryModel: "primary", primaryAttempts: 1, fallbackUsed: false, fallbackReason: null, requestId: null,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null }, data: input.output.parse(base) };
    },
  };
  const fallback: ImageAnalysisProvider = { name: "teste", model: "fallback", async analyzeImage() { throw new Error("Fallback indevido"); } };
  const resultado = await analisarImagemEstampaComFallback({ image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 }, prompt: "Analise", promptVersion: "v1", output: analiseVisualEstampaStructuredOutput }, primary, fallback);
  assert.equal(resultado.fallbackUsed, false);
});

test("qualidade aciona fallback uma vez e persiste revisão ou correção com atributos preservados", async () => {
  const ruim = { ...base, palavrasChave: ["floral", "estampa", "azul", "delicado"] };
  for (const corrigir of [false, true]) {
    let chamadas = 0;
    const provider = (model: string): ImageAnalysisProvider => ({
      name: "teste", model,
      async analyzeImage(input) {
        chamadas += 1;
        return { provider: "teste", model, analyzedAt: new Date(0).toISOString(), promptVersion: "v1",
          primaryModel: model, primaryAttempts: 1, fallbackUsed: false, fallbackReason: null, requestId: null,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
          data: input.output.parse(model === "fallback" && corrigir ? base : ruim) };
      },
    });
    const resultado = await analisarImagemEstampaComFallback({ image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 }, prompt: "Analise", promptVersion: "v1", output: analiseVisualEstampaStructuredOutput }, provider("primary"), provider("fallback"));
    assert.equal(chamadas, 2);
    assert.equal(resultado.fallbackUsed, true);
    assert.equal(resultado.attempts?.length, 2);
    assert.ok(resultado.attempts?.every(tentativa => tentativa.durationMs >= 0));
    assert.match(resultado.fallbackReason!, /METADATA_QUALITY:PALAVRA_CHAVE_GENERICA/u);
    const atualizacao = criarAtualizacaoResultadoAnaliseIa(resultado);
    const metadata = atualizacao.ai_metadata as { metadata_quality: { precisaRevisao: boolean; problemas: unknown[] } };
    assert.equal(metadata.metadata_quality.precisaRevisao, !corrigir);
    assert.equal(atualizacao.titulo, base.titulo);
    assert.deepEqual(atualizacao.padroes_texteis, ["floral"]);
    assert.equal(atualizacao.processing_error, null);
  }
});

test("recusa e truncamento não acionam fallback", async () => {
  for (const code of ["REFUSAL", "OUTPUT_TRUNCATED"] as const) {
    let chamadas = 0;
    const primary: ImageAnalysisProvider = { name: "teste", model: "primary", async analyzeImage() { chamadas++; throw new ImageAnalysisProviderError("Diagnóstico", { code, provider: "teste" }); } };
    const fallback: ImageAnalysisProvider = { name: "teste", model: "fallback", async analyzeImage() { chamadas++; throw new Error("Fallback indevido"); } };
    await assert.rejects(analisarImagemEstampaComFallback({ image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 }, prompt: "Analise", promptVersion: "v1", output: analiseVisualEstampaStructuredOutput }, primary, fallback), (erro: unknown) => erro instanceof ImageAnalysisProviderError && erro.code === code);
    assert.equal(chamadas, 1);
  }
});

test("custo soma tentativa inválida e resposta aprovada preservando uso individual", async () => {
  const uso = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: 0 };
  const primary: ImageAnalysisProvider = { name: "openai", model: "gpt-4o-mini", async analyzeImage() { throw new ImageAnalysisProviderError("Inválido", { code: "INVALID_JSON", provider: "openai", details: { usage: uso, requestId: "resp_primario" } }); } };
  const fallback: ImageAnalysisProvider = { name: "openai", model: "gpt-5.4-mini", async analyzeImage(input) {
    return { provider: "openai", model: "gpt-5.4-mini", analyzedAt: new Date(0).toISOString(), promptVersion: "v1", primaryModel: "gpt-5.4-mini", primaryAttempts: 1, fallbackUsed: false, fallbackReason: null, requestId: "resp_fallback", usage: uso, data: input.output.parse(base) };
  } };
  const resultado = await analisarImagemEstampaComFallback({ image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 }, prompt: "Analise", promptVersion: "v1", output: analiseVisualEstampaStructuredOutput }, primary, fallback);
  assert.equal(resultado.attempts?.[0].outcome, "ERROR");
  assert.equal(resultado.attempts?.[0].requestId, "resp_primario");
  const metadata = criarAtualizacaoResultadoAnaliseIa(resultado).ai_metadata as { attempts_summary: { known_cost_usd: number; cost_complete: boolean } };
  assert.ok(Math.abs(metadata.attempts_summary.known_cost_usd - 0.00141) < 1e-10);
  assert.equal(metadata.attempts_summary.cost_complete, true);
});
