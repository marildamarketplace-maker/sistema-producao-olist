import assert from "node:assert/strict";
import test from "node:test";
import { executarPilotoModelosEstampa, CONFIGURACOES_PILOTO, obterConfiguracoesPilotoGemini, type RegistroPiloto } from "../src/services/pilotoModelosEstampaService";

test("retomada conjunta reaproveita OpenAI e acrescenta somente Gemini mantendo limites por provider", async () => {
  const imagens = [{ id: "1", preview_url: "x" }];
  const salvos: RegistroPiloto[] = [];
  const chamadas: string[] = [];
  const deps = {
    carregar: async () => ({ buffer: Buffer.from([1]), sizeBytes: 1, mimeType: "image/png" as const, sourceUrl: "x", filename: null }),
    criarProvider: (model: string): ImageAnalysisProvider => ({ name: "teste", model, async analyzeImage() { chamadas.push(model); throw new Error("falha registrada"); } }),
  };
  await executarPilotoModelosEstampa(imagens, async r => { salvos.push(r); }, deps);
  const reutilizados: RegistroPiloto[] = [];
  const novos: RegistroPiloto[] = [];
  const conjunto = { ...deps, configuracoes: [...CONFIGURACOES_PILOTO, ...obterConfiguracoesPilotoGemini()], maxOutputTokensPorProvider: { gemini: 4096 } };
  await executarPilotoModelosEstampa(imagens, async r => { novos.push(r); }, { ...conjunto, anteriores: salvos.map(r => ({ ...r, ok: true })), reutilizar: async r => { reutilizados.push(r); } });
  assert.equal(reutilizados.length, 3);
  assert.deepEqual(chamadas.slice(3), ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  assert.ok(novos.every(r => r.maxOutputTokens === 4096));
  assert.deepEqual(reutilizados.map(r => r.maxOutputTokens), salvos.map(r => r.maxOutputTokens));
  await executarPilotoModelosEstampa(imagens, async () => assert.fail("Não repetir"), { ...conjunto, anteriores: [...salvos, ...novos].map(r => ({ ...r, ok: true })) });
  assert.equal(chamadas.length, 5);
});
import type { ImageAnalysisProvider } from "../src/services/image-analysis/ImageAnalysisProvider";
import { ImageAnalysisProviderError } from "../src/services/image-analysis/ImageAnalysisProviderError";

test("piloto salva diagnóstico seguro e custo de resposta rejeitada sem repetir chamadas", async () => {
  const registros: RegistroPiloto[] = [];
  await executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }], async item => { registros.push(item); }, {
    carregar: async () => ({ buffer: Buffer.from([1]), sizeBytes: 1, mimeType: "image/png", sourceUrl: "x", filename: null }),
    criarProvider: model => ({ name: "teste", model, async analyzeImage() {
      throw new ImageAnalysisProviderError("segredo", { code: "INVALID_STRUCTURED_OUTPUT", provider: "openai", retriable: true, details: {
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 0 },
        validationIssues: [{ code: "custom", path: ["linguagemVisual"], message: "segredo" }, { code: "invalid_type", path: ["chavePrivada"] }],
        error: { message: "segredo" }, response: "segredo",
      } });
    } }),
  });
  assert.equal(registros.length, 3);
  assert.equal(registros[0].custoEstimadoUsd, 0.000045);
  assert.deepEqual(registros[0].diagnostico?.validationIssues, [{ code: "custom", path: ["linguagemVisual"] }, { code: "invalid_type", path: ["campoNaoReconhecido"] }]);
  assert.doesNotMatch(JSON.stringify(registros), /segredo|chavePrivada/);
});

test("piloto carrega cada imagem uma vez, mantém bytes e contratos e gira a ordem", async () => {
  let cargas = 0;
  const chamadas: string[] = [];
  const hashes: string[] = [];
  const registros: RegistroPiloto[] = [];
  await executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }, { id: "2", preview_url: "y" }], async item => { registros.push(item); }, {
    carregar: async () => { cargas++; return { buffer: Buffer.from([cargas]), sizeBytes: 1, mimeType: "image/png", sourceUrl: "omitida", filename: null }; },
    criarProvider: (model, detail): ImageAnalysisProvider => ({ name: "teste", model,
      async analyzeImage(input) {
        chamadas.push(`${model}:${detail}`);
        hashes.push(input.image.buffer.toString("hex"));
        assert.ok(input.promptVersion.includes("v8"));
        assert.ok(input.output.jsonSchema.required);
        throw new ImageAnalysisProviderError("Mensagem com segredo não deve entrar no relatório", { code: "INVALID_STRUCTURED_OUTPUT", provider: "teste" });
      },
    }),
  });
  assert.equal(cargas, 2);
  assert.equal(chamadas.length, 6);
  assert.deepEqual(hashes, ["01", "01", "01", "02", "02", "02"]);
  assert.notEqual(chamadas[0], chamadas[3]);
  assert.equal(new Set(registros.map(item => item.promptHash)).size, 1);
  assert.equal(new Set(registros.map(item => item.schemaHash)).size, 1);
  assert.ok(registros.every(item => item.custoEstimadoUsd === null && item.erro === "INVALID_STRUCTURED_OUTPUT"));
  assert.ok(!JSON.stringify(registros).includes("segredo"));
});

test("piloto rejeita amostra duplicada e interrompe se não puder registrar", async () => {
  await assert.rejects(executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }, { id: "1", preview_url: "y" }], async () => {}));
  let chamadas = 0;
  await assert.rejects(executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }], async () => { throw new Error("Disco cheio"); }, {
    carregar: async () => ({ buffer: Buffer.from([1]), sizeBytes: 1, mimeType: "image/png", sourceUrl: "x", filename: null }),
    criarProvider: model => ({ name: "teste", model, async analyzeImage() { chamadas++; throw new Error("Provider falhou"); } }),
  }), /Disco cheio/u);
  assert.equal(chamadas, 1);
});

test("retomada preserva sucessos, retenta falhas e executa pendências", async () => {
  const imagens = [{ id: "1", preview_url: "x" }];
  const salvos: RegistroPiloto[] = [];
  let chamadas = 0;
  let byte = 1;
  const deps = {
    carregar: async () => ({ buffer: Buffer.from([byte]), sizeBytes: 1, mimeType: "image/png" as const, sourceUrl: "x", filename: null }),
    criarProvider: (model: string): ImageAnalysisProvider => ({ name: "teste", model, async analyzeImage() { chamadas++; throw new Error("falha salva"); } }),
  };
  await executarPilotoModelosEstampa(imagens, async item => { salvos.push(item); }, deps);
  assert.equal(chamadas, 3);
  const sucesso = salvos.map(r => ({ ...r, ok: true }));
  const reutilizados: RegistroPiloto[] = [];
  await executarPilotoModelosEstampa(imagens, async () => { assert.fail("Não deveria executar novamente"); }, { ...deps, anteriores: sucesso, reutilizar: async item => { reutilizados.push(item); } });
  assert.equal(chamadas, 3);
  assert.equal(reutilizados.length, 3);
  await executarPilotoModelosEstampa(imagens, async () => {}, { ...deps, anteriores: sucesso.slice(0, 2) });
  assert.equal(chamadas, 4);
  byte = 2;
  await executarPilotoModelosEstampa(imagens, async () => {}, { ...deps, anteriores: sucesso });
  assert.equal(chamadas, 7);
  byte = 1;
  await executarPilotoModelosEstampa(imagens, async () => {}, { ...deps, anteriores: sucesso.map(item => ({ ...item, schemaHash: "schema-antigo", maxOutputTokens: 9999 })) });
  assert.equal(chamadas, 7);
  await executarPilotoModelosEstampa(imagens, async () => {}, { ...deps, anteriores: [sucesso[0], salvos[1]] });
  assert.equal(chamadas, 9);
});

test("acesso negado suspende somente aquele provider e mantém pendências para retomada", async () => {
  const chamadas: string[] = [];
  const suspensos: string[] = [];
  const registros: RegistroPiloto[] = [];
  await executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }, { id: "2", preview_url: "x" }], async r => { registros.push(r); }, {
    configuracoes: [{ provider: "gemini", model: "gemini-3.5-flash-lite", detail: "high" }, { provider: "gemini", model: "gemini-3.8-flash", detail: "high" }, { provider: "openai", model: "gpt-4o-mini", detail: "low" }],
    carregar: async () => ({ buffer: Buffer.from([1]), sizeBytes: 1, mimeType: "image/png", sourceUrl: "x", filename: null }),
    providerIndisponivel: p => { suspensos.push(p); },
    criarProvider: (model, _, config) => ({ name: config.provider!, model, async analyzeImage() {
      chamadas.push(model);
      throw new ImageAnalysisProviderError("Falha", { code: config.provider === "gemini" ? "AUTHENTICATION_ERROR" : "INVALID_JSON", provider: config.provider! });
    } }),
  });
  assert.deepEqual(suspensos, ["gemini"]);
  assert.equal(chamadas.filter(m => m.startsWith("gemini")).length, 1);
  assert.equal(chamadas.filter(m => m.startsWith("gpt")).length, 2);
  assert.equal(registros.length, 3);
});
