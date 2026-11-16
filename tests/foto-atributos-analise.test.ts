import assert from "node:assert/strict";
import test from "node:test";
import type { ImageAnalysisInput } from "../src/services/image-analysis/ImageAnalysisProvider";
import { AnthropicImageAnalysisProvider } from "../src/services/image-analysis/AnthropicImageAnalysisProvider";
import { OpenAIImageAnalysisProvider } from "../src/services/image-analysis/OpenAIImageAnalysisProvider";
import { analisarFotoPesquisaEstampas } from "../src/services/analisarFotoPesquisaEstampas";
import { PROMPT_ANALISE_VISUAL_ESTAMPA } from "../src/services/analisarVisualEstampaService";

const analise = {
  titulo: "Floral azul", descricao: "Flores azuis distribuídas pela superfície, com linguagem aquarelada.",
  tema: "floral", subtemas: [], coresPrincipais: ["azul"], coresSecundarias: ["branco"],
  elementosVisuais: ["flores"], palavrasChave: ["flor", "azul", "aquarela", "floral azul"], ocasioes: [], categorias: ["floral"], estilo: "clássico",
  tipoImagem: "ESTAMPA", conteudosImagem: ["ESTAMPA"],
  aplicacaoVisual: { objetoFisicoVisivel: false, presente: false, suporte: "NAO_APLICAVEL", descricao: null, evidencias: [] },
  segmentacaoBusca: { publicosSugeridos: [], contextosUso: [], afinidadesVisuais: [] },
  classificacaoTextil: { padroesTexteis: [] }, confiancaTipoImagem: 0.96, confianca: 0.95,
};

test("foto usa o mesmo prompt/schema/provedores da catalogação, sem cadastrar nem indexar imagem", async t => {
  process.env.OPENAI_API_KEY = "chave-ficticia";
  process.env.ANTHROPIC_API_KEY = "chave-ficticia";
  let chamadas = 0;
  const imagem = Buffer.from("foto-normalizada");
  const analisar = async <T>(input: ImageAnalysisInput<T>) => {
    chamadas++;
    assert.equal(input.prompt, PROMPT_ANALISE_VISUAL_ESTAMPA);
    assert.equal(input.image.buffer, imagem);
    assert.equal(input.image.mimeType, "image/jpeg");
    return { provider: "teste", model: "teste", analyzedAt: new Date().toISOString(), promptVersion: input.promptVersion,
      fallbackUsed: false, fallbackReason: null, primaryModel: "teste", primaryAttempts: 1,
      data: input.output.parse(analise), requestId: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  };
  t.mock.method(AnthropicImageAnalysisProvider.prototype, "analyzeImage", analisar);
  t.mock.method(OpenAIImageAnalysisProvider.prototype, "analyzeImage", analisar);
  const referencia = await analisarFotoPesquisaEstampas(imagem);
  assert.deepEqual(referencia.motivos, ["flores"]);
  assert.deepEqual(referencia.cores, ["azul"]);
  assert.equal(referencia.tema, "floral");
  assert.ok(chamadas >= 1 && chamadas <= 2);
});
