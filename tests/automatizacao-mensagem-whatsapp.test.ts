import assert from "node:assert/strict";
import { test } from "node:test";
import { mensagemWhatsappAutomatizacao } from "@/lib/automatizacao/mensagem-whatsapp";

const data = new Date("2026-11-11T01:15:00Z");

test("mensagem usa nome humano e horário de São Paulo sem identificadores", () => {
  const mensagem = mensagemWhatsappAutomatizacao("responder-avaliacoes-marketplaces", true, "segredo", data);
  assert.equal(mensagem.titulo, "✅ Rotina concluída");
  assert.match(mensagem.mensagem, /Respostas às avaliações dos marketplaces/);
  assert.match(mensagem.mensagem, /10\/11/);
  assert.match(mensagem.mensagem, /22:15/);
  assert.doesNotMatch(mensagem.mensagem, /segredo|responder-avaliacoes-marketplaces/);
});

test("falha explica aprovação e indica próximo passo sem copiar dados do executor", () => {
  const mensagem = mensagemWhatsappAutomatizacao("minha-rotina", false,
    "A ferramenta exige aprovação. token=privado cliente@example.com", data);
  assert.match(mensagem.mensagem, /acesso necessário.*não foi autorizado/);
  assert.match(mensagem.mensagem, /Confira os detalhes no Histórico da automatização\./);
  assert.doesNotMatch(mensagem.mensagem, /privado|cliente@example.com/);
  assert.match(mensagem.titulo, /precisa de atenção/);
});

test("códigos técnicos e UUIDs não são enviados", () => {
  for (const [codigo, humano] of [
    ["AUTHENTICATION_ERROR", /verificar o login/], ["RESERVA_EXPIRADA", /interrompida/],
    ["RATE_LIMIT", /limite de uso/], ["CONFIGURATION_ERROR", /configuração necessária/],
    ["CAPTCHA", /verificação de segurança/], ["SAIDA_INVALIDA", /Não foi possível confirmar/],
  ] as const) {
    const { mensagem } = mensagemWhatsappAutomatizacao("Rotina 00000000-0000-0000-0000-000000000001", false, codigo, data);
    assert.match(mensagem, humano);
    assert.ok(!mensagem.includes(codigo));
    assert.doesNotMatch(mensagem, /00000000/);
  }
});
