import assert from "node:assert/strict";
import test from "node:test";
import { interpretarRespostaOpenAI, type OpenAIResponsesPayload } from "../src/services/image-analysis/openAIAnaliseResponse";
import { criarRequisicaoOpenAIAnalise } from "../src/services/image-analysis/openAIAnaliseRequest";
import { criarLinhaBatchAnaliseEstampa } from "../src/services/image-analysis/criarRequisicaoBatchAnaliseEstampa";
import { analiseVisualEstampaStructuredOutput } from "../src/schemas/analiseVisualEstampaSchema";
import { PROMPT_ANALISE_VISUAL_ESTAMPA } from "../src/services/analisarVisualEstampaService";
import { AI_ANALYSIS_PROMPT_VERSION, AI_PRIMARY_IMAGE_DETAIL, AI_OPENAI_PRIMARY_MODEL } from "../src/config/ai";
import { ImageAnalysisProviderError } from "../src/services/image-analysis/ImageAnalysisProviderError";
import { OpenAIImageAnalysisProvider } from "../src/services/image-analysis/OpenAIImageAnalysisProvider";
import { z } from "zod";

const output = { name: "teste", jsonSchema: {}, parse: (value: unknown) => value };
test("falha de schema preserva caminho e código sem mensagens, valores ou chaves privadas", () => {
  const schema = z.object({ titulo: z.string().min(3) }).strict();
  assert.throws(() => interpretarRespostaOpenAI({ output_text: JSON.stringify({ titulo: "x", segredoPrivado: "token-privado" }), usage: { input_tokens: 10, output_tokens: 20 } }, {
    name: "teste", jsonSchema: z.toJSONSchema(schema), parse: value => schema.parse(value),
  }), (error: unknown) => {
    if (!(error instanceof ImageAnalysisProviderError)) return false;
    assert.equal(error.code, "INVALID_STRUCTURED_OUTPUT");
    const details = error.details as { validationIssues: unknown };
    assert.deepEqual(details.validationIssues, [{ code: "too_small", path: ["titulo"] }, { code: "unrecognized_keys", path: [] }]);
    assert.doesNotMatch(JSON.stringify(details), /segredoPrivado|token-privado/);
    return true;
  });
});
test("diagnóstico diferencia truncamento, recusa, incompleto, JSON e schema", () => {
  const casos: Array<[OpenAIResponsesPayload, string]> = [
    [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{}" }, "OUTPUT_TRUNCATED"],
    [{ output: [{ content: [{ type: "refusal", refusal: "texto privado" }] }] }, "REFUSAL"],
    [{ status: "incomplete", incomplete_details: { reason: "content_filter" } }, "INCOMPLETE_RESPONSE"],
    [{ output_text: "{" }, "INVALID_JSON"],
    [{ status: "completed" }, "INVALID_RESPONSE"],
  ];
  for (const [payload, codigo] of casos) {
    assert.throws(() => interpretarRespostaOpenAI(structuredClone(payload), output), (erro: unknown) => erro instanceof ImageAnalysisProviderError && erro.code === codigo && !JSON.stringify(erro.details).includes("texto privado"));
  }
  assert.throws(() => interpretarRespostaOpenAI({ output_text: "{}" }, { ...output, parse: () => { throw new Error("schema"); } }), (erro: unknown) => erro instanceof ImageAnalysisProviderError && erro.code === "INVALID_STRUCTURED_OUTPUT");
  assert.deepEqual(interpretarRespostaOpenAI({ status: "completed", output_text: "{}" }, output), {});
});

test("Batch compartilha corpo e detalhe configurado com requisição síncrona", () => {
  const imageUrl = "https://storage.googleapis.com/catalogo/imagem.png";
  const batch = criarLinhaBatchAnaliseEstampa({ customId: "teste", previewUrl: imageUrl });
  assert.deepEqual(batch.body, criarRequisicaoOpenAIAnalise({ model: AI_OPENAI_PRIMARY_MODEL, imageDetail: AI_PRIMARY_IMAGE_DETAIL, imageUrl, prompt: PROMPT_ANALISE_VISUAL_ESTAMPA, promptVersion: AI_ANALYSIS_PROMPT_VERSION, output: analiseVisualEstampaStructuredOutput }));
});

test("provider preserva uso de resposta truncada sem expor conteúdo", async () => {
  const provider = new OpenAIImageAnalysisProvider({ apiKey: "teste", fetchImpl: async () => new Response(JSON.stringify({ id: "resp_1", model: "gpt-4o-mini", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "conteúdo privado", usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }), { status: 200 }) });
  await assert.rejects(provider.analyzeImage({ image: { buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1 }, prompt: "Teste", promptVersion: "teste", output }), (error: unknown) => {
    if (!(error instanceof ImageAnalysisProviderError)) return false;
    assert.equal(error.code, "OUTPUT_TRUNCATED");
    assert.deepEqual((error.details as { usage: unknown }).usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: null });
    assert.ok(!JSON.stringify(error.details).includes("privado"));
    return true;
  });
});
