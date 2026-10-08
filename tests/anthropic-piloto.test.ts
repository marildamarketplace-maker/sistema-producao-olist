import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnthropicImageAnalysisProvider, interpretarRespostaAnthropic, obterUsoAnthropic, type AnthropicPayload } from "../src/services/image-analysis/AnthropicImageAnalysisProvider";
import { criarPromptAnthropic, criarRequisicaoAnthropicAnalise } from "../src/services/image-analysis/anthropicAnaliseRequest";
import { ImageAnalysisProviderError } from "../src/services/image-analysis/ImageAnalysisProviderError";
import { obterPrecosModeloAnaliseIa, calcularCustoEstimadoAnaliseIa } from "../src/services/metricasCustoAnaliseIa";
import { CONFIGURACOES_PILOTO, CONFIGURACOES_PILOTO_ANTHROPIC, obterConfiguracoesPilotoGemini, executarPilotoModelosEstampa, type RegistroPiloto } from "../src/services/pilotoModelosEstampaService";
import { lerCheckpointsPiloto } from "../src/services/checkpointPilotoEstampas";

const schema = z.object({ titulo: z.string().min(3) }).strict();
const input = { image: { buffer: Buffer.from([1, 2, 3]), sizeBytes: 3, mimeType: "image/png" as const }, prompt: "Catalogue a imagem.", promptVersion: "v8",
  output: { name: "teste", jsonSchema: z.toJSONSchema(schema), parse: (value: unknown) => schema.parse(value) } };
const payload = (text = '{"titulo":"Floral azul"}'): AnthropicPayload => ({ id: "msg_1", model: "claude-haiku-5-5", stop_reason: "end_turn",
  content: [{ type: "thinking", text: "pensamento privado" }, { type: "text", text }],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 } });

test("Claude envia imagem e contrato JSON no prompt sem compilar gramática", async () => {
  let chamadas = 0;
  const provider = new AnthropicImageAnalysisProvider({ apiKey: "segredo", model: "claude-haiku-5-5", maxOutputTokens: 4096,
    fetchImpl: async (url, init) => {
      chamadas++;
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "segredo");
      assert.equal((init?.headers as Record<string, string>)["anthropic-version"], "2023-06-01");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.system, criarPromptAnthropic(input.prompt, input.output.jsonSchema));
      assert.equal(body.messages[0].content[0].source.data, input.image.buffer.toString("base64"));
      assert.equal(body.messages[0].content[0].source.media_type, "image/png");
      assert.equal(body.output_config, undefined);
      assert.match(body.system, /minLength/);
      return new Response(JSON.stringify(payload()), { status: 200 });
    } });
  const result = await provider.analyzeImage(input);
  assert.equal(chamadas, 1);
  assert.deepEqual(result.data, { titulo: "Floral azul" });
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 50, totalTokens: 170, cachedInputTokens: 20 });
  assert.doesNotMatch(JSON.stringify(result), /segredo|pensamento privado/);
});

test("Claude envia contrato completo com enums, nulos e limites sem mutar schema", () => {
  const original = { type: "object", properties: { titulo: { type: "string", minLength: 3 }, lista: { type: "array", minItems: 1, items: { type: "string", enum: ["floral"] } }, confianca: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] } }, required: ["titulo", "lista", "confianca"] };
  const copia = structuredClone(original);
  const request = criarRequisicaoAnthropicAnalise("claude-haiku-5-5", { ...input, output: { ...input.output, jsonSchema: original } }, 4096);
  assert.deepEqual(original, copia);
  assert.ok(!Object.hasOwn(request, "output_config"));
  assert.ok(request.system.includes(JSON.stringify(original)));
  assert.match(request.system, /motivo deve ser null/);
  assert.match(request.system, /sugestoes=\[\]/);
});

test("Claude distingue recusa, truncamento, resposta incompleta, JSON e schema", () => {
  const casos: Array<[AnthropicPayload, string]> = [
    [{ ...payload(), stop_reason: "refusal" }, "REFUSAL"],
    [{ ...payload(), stop_details: { type: "refusal" } }, "REFUSAL"],
    [{ ...payload(), stop_reason: "max_tokens" }, "OUTPUT_TRUNCATED"],
    [{ ...payload(), stop_reason: "pause_turn" }, "INCOMPLETE_RESPONSE"],
    [payload(""), "INVALID_RESPONSE"], [payload("{"), "INVALID_JSON"],
    [payload('{"titulo":"x","chavePrivada":"segredo"}'), "INVALID_STRUCTURED_OUTPUT"],
  ];
  for (const [resposta, code] of casos) assert.throws(() => interpretarRespostaAnthropic(resposta, input), (error: unknown) => {
    if (!(error instanceof ImageAnalysisProviderError)) return false;
    assert.equal(error.code, code);
    assert.equal((error.details as { usage: { outputTokens: number } }).usage.outputTokens, 50);
    assert.doesNotMatch(JSON.stringify(error.details), /segredo|chavePrivada/);
    return true;
  });
});

test("Claude classifica HTTP, timeout, rede e corpo inválido sem retries nem secrets", async () => {
  for (const [status, code] of [[401, "AUTHENTICATION_ERROR"], [403, "AUTHENTICATION_ERROR"], [429, "RATE_LIMIT"], [500, "PROVIDER_TEMPORARY_ERROR"], [400, "PROVIDER_ERROR"]] as const) {
    let chamadas = 0;
    const provider = new AnthropicImageAnalysisProvider({ apiKey: "segredo", model: "claude-sonnet-5-5", fetchImpl: async () => { chamadas++; return new Response("segredo", { status }); } });
    await assert.rejects(provider.analyzeImage(input), (error: unknown) => error instanceof ImageAnalysisProviderError && error.code === code && !JSON.stringify(error).includes("segredo"));
    assert.equal(chamadas, 1);
  }
  const timeout = new AnthropicImageAnalysisProvider({ apiKey: "teste", model: "claude-haiku-5-5", timeoutMs: 5,
    fetchImpl: async (_, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("segredo")))) });
  await assert.rejects(timeout.analyzeImage(input), (e: unknown) => e instanceof ImageAnalysisProviderError && e.code === "TIMEOUT");
  for (const fetchImpl of [async () => { throw new Error("segredo"); }, async () => new Response("[]", { status: 200 })]) {
    const provider = new AnthropicImageAnalysisProvider({ apiKey: "teste", model: "claude-haiku-5-5", fetchImpl });
    await assert.rejects(provider.analyzeImage(input), (e: unknown) => e instanceof ImageAnalysisProviderError && ["PROVIDER_TEMPORARY_ERROR", "INVALID_RESPONSE"].includes(e.code));
  }
});

test("Claude calcula cache e tarifa longa sem estimar consumo desconhecido", () => {
  const usage = obterUsoAnthropic(payload());
  assert.equal(calcularCustoEstimadoAnaliseIa(usage, obterPrecosModeloAnaliseIa("claude-haiku-5-5", undefined, usage.inputTokens)!).estimatedCostUsd, 0.0000352);
  assert.equal(obterPrecosModeloAnaliseIa("claude-haiku-5-5", undefined, 100000)!.inputPorMilhaoUsd, 0.1);
  assert.equal(obterPrecosModeloAnaliseIa("claude-haiku-5-5", undefined, 100001)!.inputPorMilhaoUsd, 0.5);
  assert.equal(obterPrecosModeloAnaliseIa("claude-sonnet-5-5")!.outputPorMilhaoUsd, 10);
  assert.equal(obterUsoAnthropic({}).inputTokens, null);
  assert.equal(obterUsoAnthropic({ usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 10 } }).inputTokens, null);
});

test("retomada conjunta executa só Claude e retenta falhas em pasta Anthropic", async () => {
  const registros: RegistroPiloto[] = [];
  const configuracoes = [...CONFIGURACOES_PILOTO, ...obterConfiguracoesPilotoGemini(), ...CONFIGURACOES_PILOTO_ANTHROPIC];
  let chamadas = 0;
  const deps = { maxOutputTokens: 4096, carregar: async () => ({ ...input.image, sourceUrl: "x", filename: null }),
    criarProvider: (model: string) => new AnthropicImageAnalysisProvider({ model: model.startsWith("claude-") ? model : "claude-haiku-5-5", apiKey: "teste",
      fetchImpl: async () => { chamadas++; return new Response(JSON.stringify({ ...payload(), stop_reason: "max_tokens" }), { status: 200 }); } }),
  };
  const imagem = [{ id: "1", preview_url: "x" }];
  await executarPilotoModelosEstampa(imagem, async r => { registros.push(r); }, { ...deps, configuracoes: configuracoes.slice(0, 5) });
  assert.equal(chamadas, 5);
  await executarPilotoModelosEstampa(imagem, async r => { registros.push(r); }, { ...deps, configuracoes, anteriores: registros.map(r => ({ ...r, ok: true })) });
  assert.equal(chamadas, 7);
  const claude = registros.slice(5);
  assert.ok(claude.every(r => r.configuracao.provider === "anthropic" && r.erro === "OUTPUT_TRUNCATED" && r.custoEstimadoUsd !== null));
  await executarPilotoModelosEstampa(imagem, async () => {}, { ...deps, configuracoes, anteriores: registros.map((r, i) => ({ ...r, ok: i < 5 })) });
  assert.equal(chamadas, 9);
  const pasta = await mkdtemp(join(tmpdir(), "claude-checkpoint-"));
  try {
    const diretorio = join(pasta, "anthropic", "piloto-estampas-123");
    await mkdir(diretorio, { recursive: true });
    await writeFile(join(diretorio, "resultados.jsonl"), claude.map(r => JSON.stringify(r)).join("\n") + "\n");
    assert.equal((await lerCheckpointsPiloto(pasta, true)).length, 2);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test("Claude integra contrato completo e aprovação de qualidade no piloto", async () => {
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
    configuracoes: CONFIGURACOES_PILOTO_ANTHROPIC, maxOutputTokensPorProvider: { anthropic: 4096 },
    carregar: async () => ({ ...input.image, sourceUrl: "x", filename: null }),
    criarProvider: model => new AnthropicImageAnalysisProvider({ model, apiKey: "teste", fetchImpl: async () => new Response(JSON.stringify({ ...payload(JSON.stringify(analise)), model }), { status: 200 }) }),
  });
  assert.equal(registros.length, 2);
  assert.ok(registros.every(r => r.ok && r.resultado?.provider === "anthropic" && r.qualidade?.status === "APROVADO" && r.custoEstimadoUsd !== null && r.maxOutputTokens === 4096));
  const { analiseVisualEstampaStructuredOutput } = await import("../src/schemas/analiseVisualEstampaSchema");
  assert.throws(() => interpretarRespostaAnthropic(payload(JSON.stringify({ ...analise, categorias: ["vocabulário inventado"] })), { output: analiseVisualEstampaStructuredOutput }), (e: unknown) => e instanceof ImageAnalysisProviderError && e.code === "INVALID_STRUCTURED_OUTPUT");
});

test("Claude rejeita imagem cujo base64 excede limite antes da rede", async () => {
  let chamadas = 0;
  const provider = new AnthropicImageAnalysisProvider({ model: "claude-haiku-5-5", apiKey: "teste", fetchImpl: async () => { chamadas++; return new Response(); } });
  await assert.rejects(provider.analyzeImage({ ...input, image: { ...input.image, buffer: Buffer.alloc(8 * 1024 * 1024), sizeBytes: 8 * 1024 * 1024 } }), (e: unknown) => e instanceof ImageAnalysisProviderError && e.code === "CONFIGURATION_ERROR");
  assert.equal(chamadas, 0);
});

test("Claude preserva motivo HTTP controlado sem gravar mensagem remota", async () => {
  const casos = [["Your credit balance is too low", "SALDO_INSUFICIENTE"], ["Organization spend limit exceeded", "LIMITE_GASTO"], ["Schema is too complex for compilation", "SCHEMA_COMPLEXO"], ["Invalid schema: anyOf", "SCHEMA_INVALIDO"], ["model invalid", "MODELO_INVALIDO"], ["max_tokens invalid", "PARAMETRO_INVALIDO"], ["image size exceeded", "IMAGEM_INVALIDA"], ["erro desconhecido", "NAO_CLASSIFICADO"]];
  for (const [message, motivo] of casos) {
    const provider = new AnthropicImageAnalysisProvider({ apiKey: "segredo", model: "claude-haiku-5-5", fetchImpl: async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", message: message + " https://privado.test/token=segredo" } }), { status: 400 }) });
    await assert.rejects(provider.analyzeImage(input), (error: unknown) => {
      if (!(error instanceof ImageAnalysisProviderError)) return false;
      assert.deepEqual(error.details, { motivoHttp: motivo });
      assert.doesNotMatch(JSON.stringify(error), /segredo|privado/);
      return true;
    });
  }
});

test("schema completo Claude vai no prompt com os mesmos campos e sem gramática remota", async () => {
  const { analiseVisualEstampaStructuredOutput } = await import("../src/schemas/analiseVisualEstampaSchema");
  const request = criarRequisicaoAnthropicAnalise("claude-haiku-5-5", { ...input, output: analiseVisualEstampaStructuredOutput }, 4096);
  assert.ok(!Object.hasOwn(request, "output_config"));
  assert.match(request.system, /poá/);
  assert.ok(request.system.includes(JSON.stringify(analiseVisualEstampaStructuredOutput.jsonSchema)));
});

test("erro global de gramática salva diagnóstico e encerra sem repetir lote", async () => {
  const salvos: RegistroPiloto[] = [];
  let chamadas = 0;
  await assert.rejects(executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }, { id: "2", preview_url: "x" }], async r => { salvos.push(r); }, {
    configuracoes: CONFIGURACOES_PILOTO_ANTHROPIC,
    carregar: async () => ({ ...input.image, sourceUrl: "x", filename: null }),
    criarProvider: model => new AnthropicImageAnalysisProvider({ model, apiKey: "teste", fetchImpl: async () => {
      chamadas++;
      return new Response(JSON.stringify({ error: { message: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." } }), { status: 400 });
    } }),
  }), /SCHEMA_COMPLEXO/);
  assert.equal(chamadas, 1);
  assert.equal(salvos.length, 1);
  assert.equal(salvos[0].diagnostico?.motivoHttp, "SCHEMA_COMPLEXO");
});

test("Claude aceita apenas JSON puro ou um bloco JSON completo; rejeita prosa e campos ausentes", () => {
  assert.deepEqual(interpretarRespostaAnthropic(payload('```json\n{"titulo":"Floral azul"}\n```'), input), { titulo: "Floral azul" });
  for (const text of ['Aqui está: {"titulo":"Floral azul"}', '```json\n{"titulo":"Floral azul"}\n```\nExplicação']) {
    assert.throws(() => interpretarRespostaAnthropic(payload(text), input), (e: unknown) => e instanceof ImageAnalysisProviderError && e.code === "INVALID_JSON");
  }
  assert.throws(() => interpretarRespostaAnthropic(payload('{}'), input), (e: unknown) => e instanceof ImageAnalysisProviderError && e.code === "INVALID_STRUCTURED_OUTPUT");
});
