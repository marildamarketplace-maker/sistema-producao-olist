import assert from "node:assert/strict";
import { test } from "node:test";
import { detalharFalhaExecucaoWorker } from "@/lib/automatizacao/falha-execucao-worker";
import { eventoWorker } from "@/lib/automatizacao/log-worker";
import { mensagemWhatsappAutomatizacao } from "@/lib/automatizacao/mensagem-whatsapp";
import { diagnosticarSaidaCodex } from "@/services/image-analysis/diagnosticoCodexCli";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

test("reconhece falhas técnicas sem levar a saída privada ao diagnóstico", () => {
  for (const [saida, motivo] of [
    ["MCP client for browser failed to start: connection refused", "MCP_INDISPONIVEL"],
    ["mcp startup: failed: browser", "MCP_INDISPONIVEL"],
    ["invalid_json_schema: invalid schema for response_format", "ESQUEMA_REJEITADO"],
    ["error: dns error EAI_AGAIN", "DNS_INDISPONIVEL"],
    ["error: invalid peer certificate", "CERTIFICADO_RECUSADO"],
    ["error: connection refused", "CONEXAO_RECUSADA"],
    ["stream disconnected before completion", "CONEXAO_INTERROMPIDA"],
    ["unexpected status 503", "SERVICO_INDISPONIVEL"],
    ["unknown error", "CAUSA_NAO_CLASSIFICADA"],
  ]) {
    const detalhe = diagnosticarSaidaCodex(`${saida}\nBearer SECRET_TEST cliente@example.com /home/privado https://privado.test`);
    assert.deepEqual(detalhe, { motivo });
  }
});

test("histórico e log retêm motivo e saída; WhatsApp recebe apenas mensagem legível", () => {
  const error = new ImageAnalysisProviderError("Bearer SECRET_TEST", {
    provider: "codex-local", code: "PROVIDER_TEMPORARY_ERROR", retriable: true,
    details: { motivo: "MCP_INDISPONIVEL", codigoSaida: 1, stderr: "SECRET_TEST" },
  });
  const falha = detalharFalhaExecucaoWorker(error);
  assert.match(falha.resultado, /PROVIDER_TEMPORARY_ERROR\nMCP_INDISPONIVEL:/);
  assert.match(falha.resultado, /Processo: saída 1/);
  const log = eventoWorker("FALHA_EXECUTOR", "Rotina", Date.now(), "FALHA", falha);
  assert.equal(JSON.parse(log).codigoSaida, 1);
  const aviso = mensagemWhatsappAutomatizacao("Rotina", false, falha.resultado, new Date(), false, falha.resumoWhatsapp);
  assert.match(aviso.mensagem, /ferramenta de navegação MCP/);
  assert.doesNotMatch(aviso.mensagem, /PROVIDER_TEMPORARY_ERROR|MCP_INDISPONIVEL/);
  assert.doesNotMatch(JSON.stringify({ falha, log, aviso }), /SECRET_TEST|Bearer|stderr/);
  assert.ok(falha.resumoWhatsapp.length <= 360);
});

test("descarta detalhes desconhecidos e mensagens livres, preservando código conhecido", () => {
  for (const error of [
    new Error("SECRET_TEST"),
    new ImageAnalysisProviderError("SECRET_TEST", { provider: "codex-local", code: "PROVIDER_TEMPORARY_ERROR", details: { motivo: "SECRET_TEST" } }),
  ]) {
    const falha = detalharFalhaExecucaoWorker(error);
    assert.equal(falha.diagnostico, undefined);
    assert.doesNotMatch(JSON.stringify(falha), /SECRET_TEST/);
  }
  const falha = detalharFalhaExecucaoWorker(new ImageAnalysisProviderError("SECRET_TEST", {
    provider: "codex-local", code: "AUTHENTICATION_ERROR",
    details: { motivo: "CAUSA_NAO_CLASSIFICADA", codigoSaida: 1 },
  }));
  assert.match(falha.resultado, /login do Codex/);
  assert.doesNotMatch(falha.resumoWhatsapp, /causa reconhecida|SECRET_TEST/);
});
