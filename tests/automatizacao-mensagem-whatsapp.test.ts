import assert from "node:assert/strict";
import { test } from "node:test";
import { mensagemWhatsappAutomatizacao } from "@/lib/automatizacao/mensagem-whatsapp";



test("mensagem identifica rotina, início em Brasília e status de conclusão", () => {
  const mensagem = mensagemWhatsappAutomatizacao("responder-avaliacoes-marketplaces", true, "segredo", new Date("2026-11-11T01:15:00Z"));
  assert.equal(mensagem.titulo, "✅ responder-avaliacoes-marketplaces");
  assert.equal(mensagem.mensagem, "Rotina: responder-avaliacoes-marketplaces\nExecução: 10/11/2026, 22:15 (Brasília)\nStatus: ✅ Concluída.");
  assert.doesNotMatch(mensagem.mensagem, /segredo/);
});

test("falha explica aprovação em uma frase sem copiar dados do executor", () => {
  const mensagem = mensagemWhatsappAutomatizacao("minha-rotina", false,
    "A ferramenta exige aprovação. token=privado cliente@example.com");
  assert.match(mensagem.mensagem, /Status: ❌ Falha final\.\nMotivo: Acesso não autorizado\./);
  assert.doesNotMatch(mensagem.mensagem, /privado|cliente@example.com/);
  assert.match(mensagem.titulo, /❌ minha-rotina/);
});

test("códigos técnicos e UUIDs não são enviados", () => {
  for (const [codigo, humano] of [
    ["AUTHENTICATION_ERROR", /Login necessário/], ["RESERVA_EXPIRADA", /interrompida/],
    ["RATE_LIMIT", /Limite de uso/], ["CONFIGURATION_ERROR", /Ferramenta indisponível/],
    ["CAPTCHA", /Verificação de segurança/], ["SAIDA_INVALIDA", /Não foi possível concluir/],
  ] as const) {
    const { mensagem } = mensagemWhatsappAutomatizacao("Rotina 00000000-0000-0000-0000-000000000001", false, codigo);
    assert.match(mensagem, humano);
    assert.ok(!mensagem.includes(codigo));
    assert.doesNotMatch(mensagem, /00000000/);
  }
});


test("nome da rotina é sanitizado e limitado sem interpretar marcação", () => {
  const mensagem = mensagemWhatsappAutomatizacao("*Rotina*\n_Exemplo_ " + "x".repeat(200), true, "");
  assert.ok(mensagem.titulo.length <= 123);
  assert.doesNotMatch(mensagem.titulo, /[\r\n*_]/);
  assert.ok(mensagem.mensagem.startsWith("Rotina: Rotina Exemplo "));
});
