import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { GeminiImageAnalysisProvider, interpretarRespostaGemini, obterUsoGemini, type GeminiPayload } from "../src/services/image-analysis/GeminiImageAnalysisProvider";
import { criarSchemaGemini } from "../src/services/image-analysis/geminiAnaliseRequest";
import { ImageAnalysisProviderError } from "../src/services/image-analysis/ImageAnalysisProviderError";
import { obterPrecosModeloAnaliseIa, calcularCustoEstimadoAnaliseIa } from "../src/services/metricasCustoAnaliseIa";
import { executarPilotoModelosEstampa, obterConfiguracoesPilotoGemini, type RegistroPiloto } from "../src/services/pilotoModelosEstampaService";
import { chaveResultadoPiloto, lerCheckpointsPiloto } from "../src/services/checkpointPilotoEstampas";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const schema = z.object({ titulo: z.string().min(3).max(100) }).strict();
const input = { image: { buffer: Buffer.from([1, 2, 3]), sizeBytes: 3, mimeType: "image/png" as const }, prompt: "Catalogue a imagem.", promptVersion: "v8",
  output: { name: "teste", jsonSchema: z.toJSONSchema(schema), parse: (value: unknown) => schema.parse(value) } };
const payload = (texto = '{"titulo":"Floral azul"}'): GeminiPayload => ({ responseId: "gemini_1", modelVersion: "gemini-3.5-flash-lite",
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: "pensamento privado", thought: true }, { text: texto }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 10, totalTokenCount: 160, cachedContentTokenCount: 20 } });

test("Gemini integra resposta válida com o contrato real e avaliação de pesquisa", async () => {
  const atributo = { estado: "INDETERMINADO", valores: [], evidencias: [], motivo: "Preview sem detalhe suficiente" };
  const analise = {
    titulo: "Floral azul", descricao: "Flores brancas distribuídas sobre fundo azul.", tema: "floral", subtemas: [], coresPrincipais: ["azul"], coresSecundarias: [],
    elementosVisuais: ["flores brancas"], palavrasChave: ["floral", "flores brancas", "azul", "delicado"], ocasioes: [], categorias: ["botânico"], estilo: "delicado",
    tipoImagem: "ESTAMPA", conteudosImagem: ["ESTAMPA"], confianca: 0.9, confiancaTipoImagem: 0.9,
    aplicacaoVisual: { presente: false, objetoFisicoVisivel: false, suporte: "NAO_APLICAVEL", descricao: null, evidencias: [] },
    segmentacaoBusca: { publicosSugeridos: [], contextosUso: [], afinidadesVisuais: [] },
    classificacaoTextil: { padroesTexteis: [{ termo: "floral", confianca: 0.9, evidencias: ["flores visíveis"] }] },
    composicaoVisual: { distribuicao: atributo, orientacao: atributo, densidade: atributo }, linguagemVisual: atributo,
    aplicacoesSugeridas: { estado: "INDETERMINADO", sugestoes: [], motivo: "Sem evidência suficiente para sugerir aplicações" },
  };
  const registros: RegistroPiloto[] = [];
  await executarPilotoModelosEstampa([{ id: "floral", preview_url: "x" }], async r => { registros.push(r); }, {
    configuracoes: obterConfiguracoesPilotoGemini(), maxOutputTokens: 4096,
    carregar: async () => ({ ...input.image, sourceUrl: "x", filename: null }),
    criarProvider: model => new GeminiImageAnalysisProvider({ model, apiKey: "teste", fetchImpl: async () => new Response(JSON.stringify({ ...payload(JSON.stringify(analise)), modelVersion: model }), { status: 200 }) }),
  });
  assert.equal(registros.length, 2);
  assert.ok(registros.every(r => r.ok && r.qualidade?.status === "APROVADO" && r.custoEstimadoUsd !== null));
  assert.equal(registros[0].resultado?.provider, "gemini");
});

test("adapter envia bytes, schema compatível e chave em header; interpreta resposta sem pensamento", async () => {
  let chamadas = 0;
  const provider = new GeminiImageAnalysisProvider({ apiKey: "chave-privada", model: "gemini-3.5-flash-lite", thinkingLevel: "low", imageDetail: "high", maxOutputTokens: 4096,
    fetchImpl: async (url, init) => {
      chamadas++;
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
      assert.ok(!String(url).includes("chave-privada"));
      assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], "chave-privada");
      assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.contents[0].parts[0].inlineData.data, input.image.buffer.toString("base64"));
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "LOW", includeThoughts: false });
      assert.equal(body.generationConfig.mediaResolution, "MEDIA_RESOLUTION_HIGH");
      assert.equal(body.generationConfig.maxOutputTokens, 4096);
      assert.equal(body.generationConfig.responseJsonSchema.properties.titulo.minLength, undefined);
      assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
      return new Response(JSON.stringify(payload()), { status: 200 });
    } });
  const resultado = await provider.analyzeImage(input);
  assert.equal(chamadas, 1);
  assert.equal(resultado.provider, "gemini");
  assert.deepEqual(resultado.data, { titulo: "Floral azul" });
  assert.deepEqual(resultado.usage, { inputTokens: 100, outputTokens: 60, totalTokens: 160, cachedInputTokens: 20 });
  assert.doesNotMatch(JSON.stringify(resultado), /pensamento privado|chave-privada/);
});

test("schema mantém enums, nulos, arrays e limites numéricos sem alterar o contrato original", () => {
  const original = { $schema: "remover", type: "object", properties: { descricao: { anyOf: [{ type: "string", minLength: 3 }, { type: "null" }] }, lista: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: ["floral", "poá"] } }, confianca: { type: "number", minimum: 0, maximum: 1 } }, required: ["lista"] };
  const copia = structuredClone(original);
  const adaptado = criarSchemaGemini(original);
  assert.deepEqual(original, copia);
  assert.equal(adaptado.$schema, undefined);
  assert.deepEqual((adaptado.properties as typeof original.properties).descricao.anyOf, [{ type: "string" }, { type: "null" }]);
  assert.deepEqual((adaptado.properties as typeof original.properties).lista, original.properties.lista);
});

test("diagnóstico distingue bloqueio, truncamento, incompleto, JSON inválido e schema", () => {
  const casos: Array<[GeminiPayload, string]> = [
    [{ promptFeedback: { blockReason: "SAFETY" } }, "REFUSAL"],
    [{ candidates: [{ finishReason: "MAX_TOKENS" }] }, "OUTPUT_TRUNCATED"],
    [{ candidates: [{ finishReason: "SAFETY" }] }, "REFUSAL"],
    [{ candidates: [{ finishReason: "OTHER" }] }, "INCOMPLETE_RESPONSE"],
    [payload(""), "INVALID_RESPONSE"], [payload("{"), "INVALID_JSON"], [payload('{"titulo":"x","chavePrivada":"segredo"}'), "INVALID_STRUCTURED_OUTPUT"],
  ];
  for (const [resposta, code] of casos) assert.throws(() => interpretarRespostaGemini(resposta, input), (error: unknown) => {
    if (!(error instanceof ImageAnalysisProviderError)) return false;
    assert.equal(error.code, code);
    assert.doesNotMatch(JSON.stringify(error.details), /segredo|chavePrivada/);
    return true;
  });
});

test("HTTP e timeout são classificados sem vazamento e sem retries implícitos", async () => {
  for (const [status, code] of [[401, "AUTHENTICATION_ERROR"], [403, "AUTHENTICATION_ERROR"], [429, "RATE_LIMIT"], [500, "PROVIDER_TEMPORARY_ERROR"], [400, "PROVIDER_ERROR"]] as const) {
    let chamadas = 0;
    const provider = new GeminiImageAnalysisProvider({ apiKey: "segredo", model: "gemini-3.8-flash", fetchImpl: async () => { chamadas++; return new Response("segredo", { status }); } });
    await assert.rejects(provider.analyzeImage(input), (error: unknown) => error instanceof ImageAnalysisProviderError && error.code === code && !JSON.stringify(error).includes("segredo"));
    assert.equal(chamadas, 1);
  }
  const timeout = new GeminiImageAnalysisProvider({ apiKey: "teste", model: "gemini-3.8-flash", timeoutMs: 5,
    fetchImpl: async (_, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("rede privada")))) });
  await assert.rejects(timeout.analyzeImage(input), (error: unknown) => error instanceof ImageAnalysisProviderError && error.code === "TIMEOUT");
  const rede = new GeminiImageAnalysisProvider({ apiKey: "teste", model: "gemini-3.8-flash", fetchImpl: async () => { throw new Error("segredo"); } });
  await assert.rejects(rede.analyzeImage(input), (error: unknown) => error instanceof ImageAnalysisProviderError && error.code === "PROVIDER_TEMPORARY_ERROR");
});

test("custos incluem pensamento, cache e fim da promoção sem inventar uso ausente", () => {
  const precos = obterPrecosModeloAnaliseIa("gemini-3.5-flash-lite")!;
  assert.equal(calcularCustoEstimadoAnaliseIa(obterUsoGemini(payload()), precos).estimatedCostUsd, 0.0001746);
  assert.equal(obterUsoGemini({}).outputTokens, null);
  assert.equal(obterPrecosModeloAnaliseIa("gemini-3.8-flash", "2026-12-31T23:59:59Z")!.outputPorMilhaoUsd, 3.75);
  assert.equal(obterPrecosModeloAnaliseIa("gemini-3.8-flash", "2027-01-01T00:00:00Z")!.outputPorMilhaoUsd, 7.5);
});

test("piloto Gemini preserva diagnóstico/custo e retenta falhas", async () => {
  const registros: RegistroPiloto[] = [];
  const configuracoes = obterConfiguracoesPilotoGemini();
  let chamadas = 0;
  const deps = { configuracoes, maxOutputTokens: 4096,
    carregar: async () => ({ ...input.image, sourceUrl: "privada", filename: null }),
    criarProvider: (model: string) => new GeminiImageAnalysisProvider({ apiKey: "teste", model, fetchImpl: async () => {
      chamadas++; return new Response(JSON.stringify({ ...payload(), candidates: [{ finishReason: "MAX_TOKENS" }] }), { status: 200 });
    } }),
  };
  await executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }], async r => { registros.push(r); }, deps);
  assert.equal(chamadas, 2);
  assert.ok(registros.every(r => !r.ok && r.erro === "OUTPUT_TRUNCATED" && r.custoEstimadoUsd !== null));
  await executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }], async () => {}, { ...deps, anteriores: registros });
  assert.equal(chamadas, 4);
  assert.notEqual(chaveResultadoPiloto(registros[0]), chaveResultadoPiloto({ ...registros[0], configuracao: { ...registros[0].configuracao, thinkingLevel: "high" } }));
  assert.notEqual(chaveResultadoPiloto(registros[0]), chaveResultadoPiloto({ ...registros[0], configuracao: { ...registros[0].configuracao, provider: "openai" } }));
  const pasta = await mkdtemp(join(tmpdir(), "gemini-checkpoint-"));
  try {
    const diretorio = join(pasta, "piloto-estampas-123");
    await mkdir(diretorio);
    await writeFile(join(diretorio, "resultados.jsonl"), registros.map(r => JSON.stringify(r)).join("\n") + "\n");
    const salvos = await lerCheckpointsPiloto(pasta);
    assert.equal(salvos[0].configuracao.thinkingLevel, configuracoes[0].thinkingLevel);
    assert.equal(chaveResultadoPiloto(salvos[0]), chaveResultadoPiloto(registros[0]));
  } finally { await rm(pasta, { recursive: true, force: true }); }
});
